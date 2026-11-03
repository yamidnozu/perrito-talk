import { createVideoRing } from "./mp4.js";
import { b64, encodeWav } from "../media.js";
import { analyzeAcoustics } from "../acoustics.js";
// Bounded in-memory buffers. No recordings or frames are persisted.
export function createPreroll({ seconds = 12, sampleRate = 16000 } = {}) {
  let frames = [],
    audio = [],
    closed = false,
    capturing = false,
    videoRing;
  const trim = (t) => {
    const cutoff = t - seconds * 1000;
    frames = frames.filter((f) => f.t >= cutoff);
    audio = audio.filter((a) => a.t >= cutoff);
  };
  const snapshot = (triggerTime) => {
    const from = triggerTime - 4000,
      to = triggerTime + 6000;
    const eligible = frames.filter((f) => f.t >= from && f.t <= to);
    // Uniformly sample up to six chronological keyframes, including endpoints.
    const count = Math.min(6, eligible.length);
    const chosen = Array.from(
      { length: count },
      (_, i) =>
        eligible[
          count === 1
            ? 0
            : Math.round((i * (eligible.length - 1)) / (count - 1))
        ],
    );
    const pcm = new Float32Array(Math.round(((to - from) * sampleRate) / 1000));
    for (const block of audio) {
      const start = block.t - (block.pcm.length * 1000) / sampleRate;
      const first = Math.max(
        0,
        Math.ceil(((from - start) * sampleRate) / 1000),
      );
      const last = Math.min(
        block.pcm.length,
        Math.floor(((to - start) * sampleRate) / 1000),
      );
      const offset = Math.max(
        0,
        Math.round(((start - from) * sampleRate) / 1000) + first,
      );
      if (last > first && offset < pcm.length)
        pcm.set(
          block.pcm.subarray(
            first,
            Math.min(last, first + pcm.length - offset),
          ),
          offset,
        );
    }
    return { chosen, pcm };
  };
  return {
    startVideo(stream) {
      videoRing?.stop();
      try {
        videoRing = createVideoRing(stream, { seconds });
      } catch {
        videoRing = null;
      }
    },
    pushPCM(pcm, t) {
      if (!closed) {
        audio.push({ pcm: pcm.slice(), t });
        trim(t);
      }
    },
    async capture(video, t) {
      if (closed || capturing || video.readyState < 2) return;
      capturing = true;
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(
          1,
          640 / Math.max(video.videoWidth, video.videoHeight),
        );
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas
          .getContext("2d")
          .drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.7),
        );
        if (blob && !closed) {
          frames.push({ t, blob });
          trim(t);
        }
      } finally {
        ((capturing = false), videoRing);
      }
    },
    snapshot,
    async build(triggerTime) {
      const { chosen, pcm } = snapshot(triggerTime);
      const media = await Promise.all(
        chosen.map(async ({ blob }) => ({
          kind: "image",
          mime: "image/jpeg",
          data_b64: await b64(blob),
        })),
      );
      media.push({
        kind: "audio",
        mime: "audio/wav",
        data_b64: await b64(encodeWav(pcm)),
      });
      const video = await videoRing?.clip(triggerTime).catch(() => null);
      if (video)
        media.push({
          kind: "video",
          mime: "video/mp4",
          data_b64: await b64(video),
        });
      return { media, acoustic_hints: analyzeAcoustics(pcm) };
    },
    resetFrames() {
      frames = [];
    },
    stop() {
      closed = true;
      videoRing?.stop();
      frames = [];
      audio = [];
    },
  };
}
