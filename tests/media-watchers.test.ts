import { describe, it, expect, vi } from "vitest";
import { encodeWav } from "../public/media.js";
import {
  pcmFromWav,
  classifyUploadedPcm,
} from "../public/watcher/upload-audio.js";
import {
  mp4Boxes,
  concatBytes,
  trackTimescales,
  fragmentTimes,
  rebaseMp4,
} from "../public/watcher/mp4.js";
import { validateAnalyze } from "../src/schema";
const box = (type: string, payload: Uint8Array) => {
  const bytes = new Uint8Array(8 + payload.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(payload, 8);
  return bytes;
};
function init() {
  const tkhd = new Uint8Array(16),
    mdhd = new Uint8Array(16);
  new DataView(tkhd.buffer).setUint32(12, 1);
  new DataView(mdhd.buffer).setUint32(12, 1000);
  return concatBytes([
    box("ftyp", new Uint8Array(8)),
    box(
      "moov",
      box(
        "trak",
        concatBytes([box("tkhd", tkhd), box("mdia", box("mdhd", mdhd))]),
      ),
    ),
  ]);
}
function fragment(ticks: number, wide = false, absolute = false) {
  const tfhd = new Uint8Array(8),
    tfdt = new Uint8Array(wide ? 12 : 8);
  new DataView(tfhd.buffer).setUint32(0, absolute ? 1 : 0x020000);
  new DataView(tfhd.buffer).setUint32(4, 1);
  if (wide) {
    tfdt[0] = 1;
    new DataView(tfdt.buffer).setBigUint64(4, BigInt(ticks));
  } else new DataView(tfdt.buffer).setUint32(4, ticks);
  return concatBytes([
    box(
      "moof",
      box("traf", concatBytes([box("tfhd", tfhd), box("tfdt", tfdt)])),
    ),
    box("mdat", new Uint8Array([3, 7, 9])),
  ]);
}
describe("native fragmented MP4 ring", () => {
  it("rebases a selected time range and preserves audio/video payload bytes", async () => {
    const header = init(),
      first = fragment(5000),
      second = fragment(6000);
    const blob = rebaseMp4(header, [first, second]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(blob.type).toBe("video/mp4");
    expect(trackTimescales(header).get(1)).toBe(1000);
    expect(
      fragmentTimes(bytes, trackTimescales(header)).map((t) => t.seconds),
    ).toEqual([0, 1]);
    for (const data of mp4Boxes(bytes).filter((b) => b.type === "mdat"))
      expect([...bytes.subarray(data.payload, data.end)]).toEqual([3, 7, 9]);
    expect(fragmentTimes(first, trackTimescales(header))[0].ticks).toBe(5000n);
  });
  it("supports 64-bit decode timestamps without retaining the full session", async () => {
    const header = init(),
      bytes = new Uint8Array(
        await rebaseMp4(header, [fragment(5000000000, true)]).arrayBuffer(),
      );
    expect(fragmentTimes(bytes, trackTimescales(header))[0].ticks).toBe(0n);
  });
  it("rejects incomplete containers and absolute offsets for safe frames+WAV fallback", () => {
    expect(() => mp4Boxes(new Uint8Array(7))).toThrow();
    expect(() => mp4Boxes(new Uint8Array([0, 0, 0, 2, 1, 2, 3, 4]))).toThrow();
    expect(() => rebaseMp4(init(), [fragment(5000, false, true)])).toThrow(
      "Absolute",
    );
  });
});
describe("browser upload YAMNet uses the live model protocol", () => {
  it("decodes the normalized mono PCM16 WAV", async () => {
    const bytes = new Uint8Array(
      await encodeWav(new Float32Array([-0.5, 0, 0.5])).arrayBuffer(),
    );
    const pcm = pcmFromWav(bytes);
    expect(pcm?.[0]).toBeCloseTo(-0.5);
    expect(pcm?.[2]).toBeCloseTo(0.5);
    expect(pcmFromWav(new Uint8Array(2))).toBe(null);
  });
  it("aggregates class peaks over uploaded audio and sends bounded watcher-shaped raw hints", async () => {
    const classify = vi.fn().mockImplementation((window, rate) => {
      expect(window.length).toBe(15600);
      expect(rate).toBe(16000);
      return [
        {
          classifications: [
            {
              categories: [
                { categoryName: "Howl", score: 0.8 },
                { categoryName: "Whimper (dog)", score: 0.2 },
              ],
            },
          ],
        },
      ];
    });
    const watcher = await classifyUploadedPcm(
      { classify },
      new Float32Array(20000),
    );
    expect(classify).toHaveBeenCalledTimes(3);
    expect(watcher).toMatchObject({
      trigger: "upload",
      detector: "mediapipe",
      sound_scores: { howl: 0.8, whine: 0 },
      dog_present: null,
    });
    expect(
      validateAnalyze({
        source: "upload",
        lang: "en",
        context: {},
        watcher,
        media: [{ kind: "audio", mime: "audio/wav", data_b64: "AAAA" }],
      }).watcher?.yamnet,
    ).toEqual([
      { label: "Howl", score: 0.8 },
      { label: "Whimper (dog)", score: 0.2 },
    ]);
  });
});
