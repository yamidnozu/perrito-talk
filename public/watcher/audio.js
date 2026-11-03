import { PARAMETERS } from "./evidence-config.js";
import { analyzeAcoustics } from "../acoustics.js";
import { rms } from "../live-logic.js";
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.2.0";
// C43: YAMNet expects 15,600 samples (0.975 s); avoid a padded second result.
const WINDOW_SAMPLES = 15600;
// C41 YAMNet uses overlapping patches; half-window hops avoid boundary misses.
const HOP_SAMPLES = WINDOW_SAMPLES / 2;
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
/** Same pinned model/options for continuous watching and uploaded WAVs. */
export async function createAudioClassifier() {
  const { FilesetResolver, AudioClassifier } = await import(
    `${CDN}/audio_bundle.mjs`
  );
  const files = await FilesetResolver.forAudioTasks(`${CDN}/wasm`);
  return AudioClassifier.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL },
    maxResults: 10,
  });
}
export function mapScores(categories, config = PARAMETERS) {
  const scores = { dog: 0, bark: 0, howl: 0, whine: 0, growl: 0, yip: 0 };
  for (const c of categories) {
    const key = config.audioSet[c.categoryName];
    // Class-specific engineering gates; training label quality is not accuracy.
    if (key && c.score >= (config.classThresholds[c.categoryName] ?? 1))
      scores[key] = Math.max(scores[key], c.score);
  }
  // C42: Yip alone is not dependable evidence of dog vocalization.
  scores.yip = scores.bark ? Math.min(scores.yip, scores.bark) : 0;
  return scores;
}
// Persistent fractional position avoids drift across capture block boundaries.
export function createResampler(rate) {
  let pending = new Float32Array(),
    position = 0;
  return (input) => {
    const data = new Float32Array(pending.length + input.length);
    data.set(pending);
    data.set(input, pending.length);
    const out = [],
      step = rate / 16000;
    while (position + 1 < data.length) {
      const i = Math.floor(position),
        f = position - i;
      out.push(data[i] * (1 - f) + data[i + 1] * f);
      position += step;
    }
    const consumed = Math.min(Math.floor(position), data.length);
    pending = data.slice(consumed);
    position -= consumed;
    return Float32Array.from(out);
  };
}
export async function startAudio({
  context,
  stream,
  onPCM,
  onFeatures,
  config = PARAMETERS,
}) {
  let classifier,
    stopped = false,
    status = "fallback",
    chunks = [],
    length = 0,
    history = new Float32Array(),
    count = 0,
    hints;
  const held = {};
  // Use sample-clock timestamps so delayed main-thread delivery cannot overlap PCM.
  const contextEpoch = performance.now() - context.currentTime * 1000;
  let envelopeOn = false,
    lastEnvelopeEnd = -Infinity,
    envelopeCount = 0,
    envelopeBursts = 0;
  // Loading never blocks capture; a stopped session closes a late model too.
  const ready = (async () => {
    try {
      const loaded = await createAudioClassifier();
      if (stopped) loaded.close();
      else {
        classifier = loaded;
        status = "yamnet";
      }
    } catch {
      status = "fallback";
    }
  })();
  const resample = createResampler(context.sampleRate);
  const consume = (input, blockEnd = performance.now()) => {
    if (stopped) return;
    const pcm = resample(input);
    onPCM(pcm, blockEnd);
    // RMS envelope pulses/IBI are engineering measurements, not bark identities.
    for (let i = 0; i < pcm.length; i += 160) {
      const at = blockEnd - (pcm.length - i) / 16;
      const on = rms(pcm.subarray(i, i + 160)) >= config.dsp.rmsFloor;
      if (on && !envelopeOn) {
        envelopeCount++;
        if (at - lastEnvelopeEnd >= config.burstIntervalMs) envelopeBursts++;
      }
      if (on) lastEnvelopeEnd = at;
      envelopeOn = on;
    }
    chunks.push(pcm);
    length += pcm.length;
    if (length < WINDOW_SAMPLES) return;
    const combined = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    chunks = [combined.slice(HOP_SAMPLES)];
    length = combined.length - HOP_SAMPLES;
    const window = combined.slice(0, WINDOW_SAMPLES);
    const fresh = history.length ? window.subarray(HOP_SAMPLES) : window;
    const joined = new Float32Array(history.length + fresh.length);
    joined.set(history);
    joined.set(fresh, history.length);
    history = joined.slice(-48000);
    // Cross-check with the exact same PCM, approximately every two seconds.
    if (!hints || ++count % 4 === 0) hints = analyzeAcoustics(history, config);
    let top = [],
      scores;
    try {
      if (classifier) {
        const result = classifier.classify(window, 16000);
        const categories = result.flatMap((r) =>
          r.classifications.flatMap((c) => c.categories),
        );
        scores = mapScores(categories, (config = PARAMETERS));
        top = categories
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((c) => ({ label: c.categoryName, score: c.score }));
      }
    } catch {
      classifier?.close();
      classifier = null;
      status = "fallback";
    }
    if (!scores) {
      scores = mapScores([], config);
      const key = config.acousticSignals[hints.class];
      if (key) scores[key] = hints.confidence;
    }
    const now = performance.now();
    for (const [key, score] of Object.entries(scores)) {
      if (score > 0) held[key] = { score, t: now };
      else if (held[key] && now - held[key].t <= config.audioScoreHoldMs)
        scores[key] = held[key].score;
    }
    analyser.getFloatFrequencyData(spectrum);
    let peak = 0;
    for (let i = 1; i < spectrum.length; i++)
      if (spectrum[i] > spectrum[peak]) peak = i;
    onFeatures({
      peakHz: (peak * context.sampleRate) / analyser.fftSize,
      envelopeCount,
      envelopeBursts,
      scores,
      yamnet: top,
      rms: rms(window),
      acousticHints: hints,
      audioStatus: status,
    });
  };
  const source = context.createMediaStreamSource(stream),
    mute = context.createGain(),
    analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  source.connect(analyser);
  analyser.connect(mute);
  mute.gain.value = 0;
  mute.connect(context.destination);
  let capture;
  try {
    if (!context.audioWorklet) throw new Error("AudioWorklet unavailable");
    await context.audioWorklet.addModule(
      new URL("./capture-worklet.js", import.meta.url),
    );
    capture = new AudioWorkletNode(context, "watcher-capture");
    capture.port.onmessage = (e) =>
      consume(
        e.data.pcm,
        contextEpoch + (e.data.endFrame * 1000) / context.sampleRate,
      );
  } catch {
    capture = context.createScriptProcessor(4096, 1, 1);
    capture.onaudioprocess = (e) =>
      consume(
        e.inputBuffer.getChannelData(0),
        contextEpoch + e.playbackTime * 1000,
      );
  }
  source.connect(capture);
  capture.connect(mute);
  return {
    ready,
    stop() {
      stopped = true;
      source.disconnect();
      analyser.disconnect();
      capture.disconnect();
      mute.disconnect();
      classifier?.close();
    },
  };
}
