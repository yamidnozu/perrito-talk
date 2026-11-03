// Minimal ISO BMFF fragment handling for native MediaRecorder MP4. No codec or
// behavior inference: retain init+mdat bytes and rebase tfdt decode timestamps.
export function mp4Boxes(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    out = [];
  for (let at = start; at < end;) {
    if (at + 8 > end) throw new Error("Incomplete MP4 box");
    let size = view.getUint32(at),
      header = 8;
    if (size === 1) {
      if (at + 16 > end) throw new Error("Incomplete MP4 size");
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    }
    if (size === 0) size = end - at;
    if (!Number.isSafeInteger(size) || size < header || at + size > end)
      throw new Error("Invalid MP4 box size");
    out.push({
      type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      start: at,
      payload: at + header,
      end: at + size,
    });
    at += size;
  }
  return out;
}
function* walk(bytes, start = 0, end = bytes.length) {
  for (const box of mp4Boxes(bytes, start, end)) {
    yield box;
    if (["moov", "trak", "mdia", "moof", "traf"].includes(box.type))
      yield* walk(bytes, box.payload, box.end);
  }
}
export function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
export function trackTimescales(init) {
  const view = new DataView(init.buffer, init.byteOffset, init.byteLength),
    scales = new Map();
  for (const track of walk(init))
    if (track.type === "trak") {
      const children = [...walk(init, track.payload, track.end)],
        tkhd = children.find((b) => b.type === "tkhd"),
        mdhd = children.find((b) => b.type === "mdhd");
      if (!tkhd || !mdhd) throw new Error("Missing MP4 track metadata");
      const id = view.getUint32(
        tkhd.payload + (init[tkhd.payload] === 1 ? 20 : 12),
      );
      const scale = view.getUint32(
        mdhd.payload + (init[mdhd.payload] === 1 ? 20 : 12),
      );
      if (!id || !scale) throw new Error("Invalid MP4 timescale");
      scales.set(id, scale);
    }
  if (!scales.size) throw new Error("No MP4 tracks");
  return scales;
}
export function fragmentTimes(fragment, scales) {
  const view = new DataView(
      fragment.buffer,
      fragment.byteOffset,
      fragment.byteLength,
    ),
    times = [];
  for (const traf of walk(fragment))
    if (traf.type === "traf") {
      const children = mp4Boxes(fragment, traf.payload, traf.end),
        tfhd = children.find((b) => b.type === "tfhd"),
        tfdt = children.find((b) => b.type === "tfdt");
      if (!tfhd || !tfdt) throw new Error("Missing MP4 fragment timing");
      // Absolute file offsets cannot be retained when old fragments are removed.
      if (view.getUint32(tfhd.payload) & 1)
        throw new Error("Absolute MP4 offsets unsupported");
      const scale = scales.get(view.getUint32(tfhd.payload + 4));
      if (!scale) throw new Error("Unknown MP4 track");
      const wide = fragment[tfdt.payload] === 1,
        at = tfdt.payload + 4;
      const ticks = wide ? view.getBigUint64(at) : BigInt(view.getUint32(at));
      times.push({ scale, ticks, at, wide, seconds: Number(ticks) / scale });
    }
  if (!times.length) throw new Error("No MP4 fragment timestamps");
  return times;
}
export function rebaseMp4(init, fragments) {
  const scales = trackTimescales(init),
    times = fragments.flatMap((fragment) => fragmentTimes(fragment, scales));
  const first = Math.min(...times.map((time) => time.seconds));
  if (!Number.isFinite(first)) throw new Error("No MP4 fragments");
  const rebased = fragments.map((fragment) => {
    const copy = fragment.slice(),
      view = new DataView(copy.buffer);
    for (const time of fragmentTimes(copy, scales)) {
      const shifted = time.ticks - BigInt(Math.floor(first * time.scale));
      const ticks = shifted < 0n ? 0n : shifted;
      if (time.wide) view.setBigUint64(time.at, ticks);
      else view.setUint32(time.at, Number(ticks));
    }
    return copy;
  });
  return new Blob([init, ...rebased], { type: "video/mp4" });
}
/** Bounded native MP4+audio ring. Unsupported encoders fail back to frames+WAV. */
export function createVideoRing(
  stream,
  { seconds = 12, now = () => performance.now() } = {},
) {
  if (
    typeof MediaRecorder !== "function" ||
    !MediaRecorder.isTypeSupported("video/mp4")
  )
    return null;
  const recorder = new MediaRecorder(stream, {
    mimeType: "video/mp4",
    videoBitsPerSecond: 800000,
    audioBitsPerSecond: 64000,
    videoKeyFrameIntervalDuration: 1000,
  });
  const anchor = now();
  let initParts = [],
    init,
    scales,
    fragments = [],
    moof,
    closed = false,
    failed = false,
    pending = Promise.resolve();
  recorder.ondataavailable = ({ data }) => {
    if (closed || !data.size) return;
    pending = pending
      .then(async () => {
        if (closed || failed) return;
        const bytes = new Uint8Array(await data.arrayBuffer());
        for (const box of mp4Boxes(bytes)) {
          const part = bytes.slice(box.start, box.end);
          if (["ftyp", "moov"].includes(box.type)) {
            initParts.push(part);
            if (box.type === "moov") {
              init = concatBytes(initParts);
              scales = trackTimescales(init);
            }
          }
          if (box.type === "moof") moof = part;
          if (box.type === "mdat" && moof && scales) {
            const fragment = concatBytes([moof, part]);
            moof = null;
            const at =
              anchor +
              Math.min(
                ...fragmentTimes(fragment, scales).map((time) => time.seconds),
              ) *
                1000;
            fragments.push({ at, bytes: fragment });
          }
        }
        fragments = fragments.filter(
          (fragment) => fragment.at >= now() - seconds * 1000 - 1000,
        );
      })
      .catch(() => {
        failed = true;
      });
  };
  recorder.onerror = () => {
    failed = true;
  };
  recorder.start(1000);
  return {
    async clip(triggerTime) {
      if (closed || failed) return null;
      // Encoders can deliver the last completed fragment after the wall-clock
      // post-roll timer. Wait briefly for its media timestamp, not just an event.
      const deadline = now() + 2000;
      do {
        await new Promise((resolve) => {
          let timer;
          const done = () => {
            clearTimeout(timer);
            recorder.removeEventListener("dataavailable", done);
            resolve();
          };
          recorder.addEventListener("dataavailable", done, { once: true });
          timer = setTimeout(done, 250);
          try {
            recorder.requestData();
          } catch {
            done();
          }
        });
        await pending;
        if (closed || failed) return null;
        if (fragments.some((fragment) => fragment.at >= triggerTime + 6000))
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (now() < deadline);
      if (closed || failed || !init) return null;
      const selected = fragments
        .filter(
          (fragment) =>
            fragment.at >= triggerTime - 4500 &&
            fragment.at <= triggerTime + 6000,
        )
        .map((fragment) => fragment.bytes);
      return selected.length ? rebaseMp4(init, selected) : null;
    },
    stop() {
      closed = true;
      if (recorder.state !== "inactive") recorder.stop();
      fragments = [];
      initParts = [];
      init = null;
    },
  };
}
