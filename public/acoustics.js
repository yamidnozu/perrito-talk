import { PARAMETERS } from "./watcher/evidence-config.js";
// Heuristic features for mono 16 kHz PCM; no browser dependencies.
export function analyzeAcoustics(pcm, config = PARAMETERS) {
  const frames = [],
    window = Float64Array.from(
      { length: 480 },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 479),
    );
  for (let start = 0; start + 480 <= pcm.length; start += 240) {
    const w = Float64Array.from(window, (v, i) => v * pcm[start + i]);
    let ac0 = 0,
      peak = 0,
      lag = 0;
    for (const v of w) ac0 += v * v;
    const correlations = [];
    for (let k = config.dsp.minimumLag - 1; k <= config.dsp.maximumLag; k++) {
      let ac = 0;
      for (let i = 0; i < w.length - k; i++) ac += w[i] * w[i + k];
      correlations[k] = ac / (ac0 + 1e-9);
    }
    // Standard autocorrelation peak picking avoids treating a rising boundary
    // sample as the fundamental of a low-frequency sound.
    for (let k = config.dsp.minimumLag; k < config.dsp.maximumLag; k++) {
      if (
        correlations[k] >= correlations[k - 1] &&
        correlations[k] > correlations[k + 1] &&
        correlations[k] > peak
      ) {
        peak = correlations[k];
        lag = k;
      }
    }
    frames.push({
      rms: Math.sqrt(ac0 / 480),
      voicing: peak,
      pitch: lag ? 16000 / lag : 0,
    });
  }
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b),
      pos = (sorted.length - 1) * p,
      lo = Math.floor(pos);
    return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
  };
  const threshold = Math.max(
    config.dsp.rmsFloor,
    percentile(
      frames.map((f) => f.rms),
      config.acoustic.noiseQuantile,
    ) * config.acoustic.noiseFactor,
  );
  const active = frames.map((f) => f.rms > threshold),
    tonal = frames.map(
      (f, i) => active[i] && f.voicing > config.dsp.periodicityGate,
    );
  const runs = (mask) => {
    const out = [];
    let n = 0;
    for (const on of [...mask, false]) {
      if (on) n++;
      else if (n) {
        out.push(n * 0.015);
        n = 0;
      }
    }
    return out;
  };
  const tonalRuns = runs(tonal),
    activeRuns = runs(active);
  const metrics = {
    hnr: 0,
    active: active.filter(Boolean).length / (frames.length || 1),
    tonal: tonal.filter(Boolean).length / (frames.length || 1),
    longest_tonal_s: Math.max(0, ...tonalRuns),
    pitch_hz: percentile(
      frames
        .filter(
          (f, i) =>
            active[i] && f.voicing >= config.acoustic.minimumPeriodicity,
        )
        .map((f) => f.pitch),
      0.5,
    ),
    bursts: tonalRuns.filter((n) => n > config.dsp.minimumBurstMs / 1000)
      .length,
  };
  // Raw autocorrelation HNR proxy, not a validated stress detector (C06/C39).
  const periodicity = percentile(
    frames.map((f) => Math.max(0.0001, Math.min(0.9999, f.voicing))),
    0.5,
  );
  const hnr = 10 * Math.log10(periodicity / (1 - periodicity));
  // No voiced frames (e.g. a silent or missing track): report "unknown", not -Infinity.
  metrics.hnr = Number.isFinite(hnr) ? hnr : null;
  const rules = config.acoustic;
  const tonalRatio = metrics.tonal / (metrics.active || 1);
  const whines = tonalRuns.filter(
    (seconds) =>
      seconds >= rules.whineMinimumSeconds &&
      seconds <= rules.whineMaximumSeconds,
  ).length;
  const barks = activeRuns.filter(
    (seconds) => seconds <= rules.barkMaximumSeconds,
  ).length;
  const longestActive = Math.max(0, ...activeRuns);
  // TODO(evidence): these morphology gates are provisional; synthetic tests check
  // discrimination mechanics, not accuracy on real dogs or emotions (C42).
  let classification = "unclear";
  if (metrics.active < rules.silenceActiveFraction) classification = "silence";
  else if (
    whines >= rules.whineMinimumBursts &&
    tonalRatio >= rules.minimumTonalRatio
  )
    classification = "whine_whimper";
  else if (
    barks >= rules.barkMinimumBursts &&
    tonalRatio <= rules.barkMaximumTonalRatio
  )
    classification = "bark";
  else if (
    metrics.pitch_hz > 0 &&
    metrics.pitch_hz <= rules.growlMaximumPitchHz &&
    longestActive >= rules.growlMinimumSeconds
  )
    classification = "growl";
  else if (
    metrics.longest_tonal_s >= rules.howlMinimumSeconds &&
    tonalRatio >= rules.minimumTonalRatio
  )
    classification = "howl";
  if (classification === "bark") metrics.bursts = barks;
  return {
    class: classification,
    certainty: classification === "unclear" ? "especulativa" : rules.certainty,
    source: rules.source,
    // Compatibility ordinal only; never display this as a probability.
    confidence: classification === "unclear" ? 0 : rules.ordinalConfidence,
    metrics,
  };
}
