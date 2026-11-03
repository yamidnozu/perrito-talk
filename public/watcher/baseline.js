import { PARAMETERS } from "./evidence-config.js";
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
};
/** Per-dog measurements only; bounded local storage contains no audio or frames. */
export function createBaseline(profile = "default", config = PARAMETERS) {
  const key = `perrito-watcher-baseline:${profile.slice(0, 80)}`;
  let samples = [];
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(saved))
      samples = saved
        .filter((s) =>
          ["pitch", "peak", "hnr", "rate", "motion"].every((k) =>
            Number.isFinite(s[k]),
          ),
        )
        .slice(-128);
  } catch {}
  const ambient = [];
  return {
    ambient(rms, motion) {
      ambient.push({ rms, motion });
      if (ambient.length > config.calibration.seconds) ambient.shift();
    },
    gates() {
      const ready = ambient.length >= config.calibration.minimumSamples;
      return {
        ready,
        rms: ready
          ? percentile(
              ambient.map((s) => s.rms),
              0.5,
            ) * config.calibration.noiseMultiplier
          : 0,
        motion: ready
          ? percentile(
              ambient.map((s) => s.motion),
              0.5,
            ) * config.calibration.motionNoiseMultiplier
          : 0,
      };
    },
    add({ pitch, peak, hnr, rate, motion }) {
      if (![pitch, peak, hnr, rate, motion].every(Number.isFinite)) return;
      samples.push({ pitch, peak, hnr, rate, motion });
      samples = samples.slice(-128);
      try {
        localStorage.setItem(key, JSON.stringify(samples));
      } catch {}
    },
    summary() {
      if (samples.length < config.calibration.minimumSamples) return undefined;
      return {
        pitch_hz: percentile(
          samples.map((s) => s.pitch),
          0.5,
        ),
        peak_hz: percentile(
          samples.map((s) => s.peak),
          0.5,
        ),
        hnr: percentile(
          samples.map((s) => s.hnr),
          0.5,
        ),
        bark_rate: percentile(
          samples.map((s) => s.rate),
          0.5,
        ),
        motion_p25: percentile(
          samples.map((s) => s.motion),
          config.calibration.relativeLowerQuantile,
        ),
        motion_p75: percentile(
          samples.map((s) => s.motion),
          config.calibration.relativeUpperQuantile,
        ),
        samples: samples.length,
      };
    },
    relative(pitch) {
      if (samples.length < config.calibration.minimumSamples || !pitch)
        return "unknown";
      const values = samples.map((s) => s.pitch);
      return pitch <
        percentile(values, config.calibration.relativeLowerQuantile)
        ? "lower"
        : pitch > percentile(values, config.calibration.relativeUpperQuantile)
          ? "higher"
          : "usual";
    },
  };
}
