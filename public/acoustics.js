// Heuristic features for mono 16 kHz PCM; no browser dependencies.
export function analyzeAcoustics(pcm) {
  const frames = [],
    window = Float64Array.from(
      { length: 480 },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 479),
    );
  for (let start = 0; start + 480 <= pcm.length; start += 240) {
    const w = Float64Array.from(window, (v, i) => v * pcm[start + i]);
    let ac0 = 0,
      peak = -Infinity,
      lag = 8;
    for (const v of w) ac0 += v * v;
    for (let k = 8; k < 64; k++) {
      let ac = 0;
      for (let i = 0; i < 480 - k; i++) ac += w[i] * w[i + k];
      if (ac > peak) {
        peak = ac;
        lag = k;
      }
    }
    frames.push({
      rms: Math.sqrt(ac0 / 480),
      voicing: peak / (ac0 + 1e-9),
      pitch: 16000 / lag,
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
    0.02,
    percentile(
      frames.map((f) => f.rms),
      0.6,
    ),
  );
  const active = frames.map((f) => f.rms > threshold),
    tonal = frames.map((f, i) => active[i] && f.voicing > 0.5);
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
    active: active.filter(Boolean).length / (frames.length || 1),
    tonal: tonal.filter(Boolean).length / (frames.length || 1),
    longest_tonal_s: Math.max(0, ...tonalRuns),
    pitch_hz: percentile(
      frames.filter((_, i) => tonal[i]).map((f) => f.pitch),
      0.5,
    ),
    bursts: tonalRuns.filter((n) => n > 0.1).length,
  };
  const {
    active: a,
    tonal: t,
    longest_tonal_s: l,
    pitch_hz: p,
    bursts: b,
  } = metrics;
  let classification = "unclear",
    confidence = 0.3;
  if (a < 0.02) {
    classification = "silence";
    confidence = 0.9;
  } else if (p >= 1800) {
    classification = "music_or_noise";
    confidence = 0.75;
  } else if (p >= 300 && p <= 900 && l >= 0.9) {
    classification = "howl";
    confidence = 0.8;
  } else if (
    p >= 400 &&
    p <= 1500 &&
    l >= 0.2 &&
    l <= 0.9 &&
    tonalRuns.filter((n) => n >= 0.2 && n <= 0.9).length >= 4
  ) {
    classification = "whine_whimper";
    confidence = 0.75;
  } else if (
    activeRuns.filter((n) => n < 0.25).length >= 2 &&
    t / (a || 1) < 0.3 &&
    p < 1000
  ) {
    classification = "bark";
    confidence = 0.6;
  }
  return { class: classification, confidence, metrics };
}
