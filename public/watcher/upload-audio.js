import { createAudioClassifier, mapScores } from "./audio.js";
import { PARAMETERS } from "./evidence-config.js";
/** Decode the browser normalizer's mono PCM16 WAV without another AudioContext. */
export function pcmFromWav(bytes) {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let valid = false,
    pcm = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const length = view.getUint32(at + 4, true),
      end = at + 8 + length;
    if (end > bytes.length) return null;
    if (tag(at) === "fmt " && length >= 16)
      valid =
        view.getUint16(at + 8, true) === 1 &&
        view.getUint16(at + 10, true) === 1 &&
        view.getUint32(at + 12, true) === 16000 &&
        view.getUint16(at + 22, true) === 16;
    if (tag(at) === "data" && length % 2 === 0)
      pcm = Float32Array.from(
        { length: length / 2 },
        (_, i) => view.getInt16(at + 8 + i * 2, true) / 32768,
      );
    at = end + (length % 2);
  }
  return valid ? pcm : null;
}
export async function classifyUploadedPcm(
  classifier,
  pcm,
  config = PARAMETERS,
) {
  const peaks = new Map();
  // Same 0.975-second windows and half-window hop as the watcher (C41/C43).
  for (let start = 0; start < pcm.length; start += 7800) {
    const window = new Float32Array(15600);
    window.set(pcm.subarray(start, start + 15600));
    const categories = classifier
      .classify(window, 16000)
      .flatMap((r) => r.classifications.flatMap((c) => c.categories));
    for (const category of categories)
      peaks.set(
        category.categoryName,
        Math.max(peaks.get(category.categoryName) || 0, category.score),
      );
    // Release the UI regularly when a file has many inference windows.
    if (start % (7800 * 4) === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const categories = [...peaks]
    .map(([categoryName, score]) => ({ categoryName, score }))
    .sort((a, b) => b.score - a.score);
  return {
    trigger: "upload",
    prev_state: null,
    new_state: "audio_observation",
    time_in_prev_state_s: 0,
    yamnet: categories
      .slice(0, 5)
      .map((c) => ({ label: c.categoryName, score: c.score })),
    sound_scores: mapScores(categories, config),
    motion: 0,
    centroid_shift: 0,
    bbox: null,
    dog_present: null,
    detector: "mediapipe",
  };
}
/** Model/CDN failures never prevent an upload or consume a Meta request. */
export async function uploadWatcher(media, config = PARAMETERS) {
  const audio = media.find((m) => m.kind === "audio" && m.mime === "audio/wav");
  if (!audio) return undefined;
  let classifier,
    timer,
    abandoned = false;
  const loading = createAudioClassifier();
  loading
    .then((loaded) => {
      if (abandoned) loaded.close();
    })
    .catch(() => {});
  try {
    const pcm = pcmFromWav(
      Uint8Array.from(atob(audio.data_b64), (c) => c.charCodeAt(0)),
    );
    if (!pcm?.length) return undefined;
    classifier = await Promise.race([
      loading,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Audio classifier timeout")),
          10000,
        );
      }),
    ]);
    clearTimeout(timer);
    return await classifyUploadedPcm(classifier, pcm, config);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    abandoned = true;
    classifier?.close();
  }
}
