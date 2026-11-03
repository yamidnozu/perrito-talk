const LIMIT = 30;
export const b64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
const blobOf = (canvas, type = "image/jpeg", quality = 0.82) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))),
      type,
      quality,
    ),
  );

export async function jpeg(source, max = 1024) {
  const canvas = document.createElement("canvas"),
    w = source.videoWidth || source.naturalWidth || source.width,
    h = source.videoHeight || source.naturalHeight || source.height;
  if (!w || !h) throw new Error("Unreadable image");
  const scale = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return blobOf(canvas);
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Cannot read image"));
    i.src = url;
  });
}

export async function wav(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("Audio conversion is unavailable in this browser");
  const ac = new AC();
  let decoded;
  try {
    decoded = await ac.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await ac.close();
  }
  const length = Math.min(
      decoded.length,
      Math.floor(decoded.sampleRate * LIMIT),
    ),
    outLength = Math.ceil((length * 16000) / decoded.sampleRate),
    offline = new OfflineAudioContext(1, outLength, 16000),
    mono = offline.createBuffer(1, length, decoded.sampleRate),
    mix = mono.getChannelData(0);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++)
      mix[i] += data[i] / decoded.numberOfChannels;
  }
  const source = offline.createBufferSource();
  source.buffer = mono;
  source.connect(offline.destination);
  source.start();
  const pcm = (await offline.startRendering()).getChannelData(0),
    buffer = new ArrayBuffer(44 + pcm.length * 2),
    view = new DataView(buffer);
  const text = (offset, s) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const n = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, n < 0 ? n * 32768 : n * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
const waitEvent = (el, event, timeout = 15000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clean();
      reject(new Error("Media timed out"));
    }, timeout);
    const ok = () => {
        clean();
        resolve();
      },
      bad = () => {
        clean();
        reject(new Error("Unsupported media codec"));
      },
      clean = () => {
        clearTimeout(timer);
        el.removeEventListener(event, ok);
        el.removeEventListener("error", bad);
      };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });

export async function normalize(file) {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("File is too large (100 MB maximum).");
  const url = URL.createObjectURL(file);
  let video;
  try {
    if (file.type.startsWith("image/")) {
      const image = await loadImage(url),
        full = await jpeg(image),
        thumb = await jpeg(image, 140);
      return {
        media: [
          { kind: "image", mime: "image/jpeg", data_b64: await b64(full) },
        ],
        thumbnail: `data:image/jpeg;base64,${await b64(thumb)}`,
        notice: "",
      };
    }
    if (file.type.startsWith("audio/")) {
      const audio = await wav(file);
      return {
        media: [
          { kind: "audio", mime: "audio/wav", data_b64: await b64(audio) },
        ],
        thumbnail: "/sample.svg",
        notice: "audio30",
      };
    }
    if (
      !file.type.startsWith("video/") &&
      !/\.(mov|mp4|webm)$/i.test(file.name || "")
    )
      throw new Error("Choose a photo, video or audio file.");
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const ready = waitEvent(video, "loadeddata");
    video.src = url;
    await ready;
    const thumbnail = `data:image/jpeg;base64,${await b64(await jpeg(video, 140))}`;
    if (
      (file.type === "video/mp4" || /\.mp4$/i.test(file.name || "")) &&
      file.size <= 12 * 1024 * 1024
    )
      return {
        media: [
          { kind: "video", mime: "video/mp4", data_b64: await b64(file) },
        ],
        thumbnail,
        notice: "",
      };
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Video duration is unavailable. Try uploading an MP4.");
    const media = [];
    for (const fraction of [0.05, 0.35, 0.65, 0.95]) {
      const seek = waitEvent(video, "seeked");
      video.currentTime = Math.min(duration - 0.01, duration * fraction);
      await seek;
      media.push({
        kind: "image",
        mime: "image/jpeg",
        data_b64: await b64(await jpeg(video, 768)),
      });
    }
    let notice = "framesOnly";
    try {
      const audio = await wav(file);
      media.push({
        kind: "audio",
        mime: "audio/wav",
        data_b64: await b64(audio),
      });
      notice = "framesAudio";
    } catch {
      /* Some browsers cannot decode audio inside video containers. Tell the user. */
    }
    return { media, thumbnail, notice };
  } finally {
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
    URL.revokeObjectURL(url);
  }
}
