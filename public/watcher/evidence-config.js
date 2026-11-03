/**
 * Scientific signal meanings come exclusively from /evidence.json. Numeric gates
 * below are configurable engineering decisions, not validated behavioral cutoffs.
 * loadEvidence validates the scientific JSON and optional engineering overrides.
 */
// TODO(evidence): independently validate per-dog engineering gates; no app accuracy is established.
export const PARAMETERS = {
  source: "provisional",
  citations: {},
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  states: [
    {
      name: "vocalization",
      feature: "vocalScore",
      enter: 0.1,
      exit: 0.06,
      below: false,
      scaled: true,
      subtype: true,
    },
    {
      name: "absent",
      feature: "presence",
      enter: 0.5,
      exit: 0.5,
      below: true,
      scaled: false,
      subtype: false,
    },
    {
      name: "at_zone",
      feature: "inZone",
      enter: 1,
      exit: 1,
      below: false,
      scaled: false,
      subtype: false,
    },
    {
      name: "restless",
      debounceMs: 2500,
      feature: "motion",
      enter: 0.4,
      exit: 0.25,
      below: false,
      scaled: true,
      subtype: false,
    },
    {
      name: "active",
      debounceMs: 2500,
      feature: "motion",
      enter: 0.1,
      exit: 0.06,
      below: false,
      scaled: true,
      subtype: false,
    },
  ],
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  defaultState: "still",
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  debounceMs: 2500,
  // Engineering decision: bridge duplicate/missing vision samples, not physical rest.
  motionHoldMs: 1000,
  // Engineering decision: do not interpret a single detector miss as an exit (C43).
  presenceHoldMs: 1500,
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  sensitivity: { low: 1.4, medium: 1, high: 0.7 },
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  audioSet: {
    Dog: "dog",
    Bark: "bark",
    Howl: "howl",
    "Bow-wow": "bark",
    Growling: "growl",
    "Whimper (dog)": "whine",
    Yip: "yip",
    "Canidae, dogs, wolves": "dog",
  },
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  vocalSignals: ["bark", "howl", "whine", "growl", "yip"],
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  acousticSignals: {
    bark: "bark",
    howl: "howl",
    whine_whimper: "whine",
    growl: "growl",
  },
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  // Engineering decision (measured, not evidence): EfficientDet-Lite0 (COCO) often labels
  // real dogs as cow/horse/bear/cat on our clips (scores 0.45-0.68), so presence accepts
  // any of these quadruped classes at a permissive 0.25 score. See README "Watcher".
  presence: {
    motionThreshold: 0.025,
    detectorScore: 0.25,
    delegate: "CPU",
    animalClasses: [
      "dog",
      "cat",
      "cow",
      "horse",
      "sheep",
      "bear",
      "teddy bear",
    ],
  },
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  baseline: { minimumSamples: 20, weight: 0.02 },
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  spike: { factor: 3, floor: 0.025, debounceMs: 6000 },
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  sustainedVocalMs: 120000,
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  cooldowns: {
    state_change: 20000,
    vocal_start: 30000,
    vocal_sustained: 60000,
    dog_enter: 30000,
    dog_exit: 30000,
    motion_spike: 45000,
    heartbeat: 60000,
  },
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  triggerPriority: [
    "vocal_start",
    "vocal_sustained",
    "dog_enter",
    "dog_exit",
    "state_change",
    "motion_spike",
    "heartbeat",
  ],
  // Engineering decision: configurable; evidence provides no validated numeric cutoff.
  transitions: { vocalState: "vocalization", absentState: "absent" },
  // Operational accounting defaults, not interpretations of behavior.
  globalGapMs: 8000,
  evaluationWindowMs: 12000,
  heartbeatMinutes: 0,
  // Engineering decision: per-class gates; label quality is loaded separately from C42.
  classThresholds: {
    Dog: 0.35,
    Bark: 0.35,
    Howl: 0.1,
    Growling: 0.35,
    "Bow-wow": 0.5,
    "Whimper (dog)": 0.6,
    Yip: 0.75,
    Whimper: 0.6,
    "Canidae, dogs, wolves": 0.35,
  },
  // Engineering decisions: short class-score persistence bridges inference-window gaps.
  audioScoreHoldMs: 2500,
  burstIntervalMs: 500,
  // TODO(evidence): validate acoustic morphology gates and cite the measured values.
  // These sound-class guesses are engineering heuristics, never emotion evidence.
  acoustic: {
    source: "engineering_provisional",
    certainty: "baja",
    ordinalConfidence: 0.3,
    noiseQuantile: 0.2,
    noiseFactor: 0.5,
    minimumPeriodicity: 0.15,
    silenceActiveFraction: 0.02,
    minimumTonalRatio: 0.6,
    howlMinimumSeconds: 0.9,
    whineMinimumSeconds: 0.2,
    whineMaximumSeconds: 0.9,
    whineMinimumBursts: 3,
    barkMaximumSeconds: 0.25,
    barkMinimumBursts: 2,
    barkMaximumTonalRatio: 0.35,
    growlMinimumSeconds: 0.6,
    growlMaximumPitchHz: 250,
  },
  dsp: {
    rmsFloor: 0.02,
    noiseQuantile: 0.6,
    periodicityGate: 0.5,
    frameMs: 30,
    hopMs: 15,
    minimumBurstMs: 100,
    minimumLag: 8,
    maximumLag: 256,
  },
  calibration: {
    seconds: 10,
    // Engineering cap: allow calibration first, but do not wait forever on vocal input.
    initialWaitMs: 10000,
    minimumSamples: 10,
    noiseMultiplier: 3,
    // Engineering decision: motion energy and RMS use separate noise scales.
    motionNoiseMultiplier: 1.25,
    relativeLowerQuantile: 0.25,
    relativeUpperQuantile: 0.75,
  },
  templates: {
    alta: {
      en: "My signals fit {state}.",
      es: "Mis señales encajan con {state}.",
    },
    moderada: {
      en: "Perhaps my signals fit {state}.",
      es: "Quizá mis señales encajen con {state}.",
    },
    baja: {
      en: "Could my signals fit {state}?",
      es: "¿Podrían mis señales encajar con {state}?",
    },
    play_intent: { en: "Let's play again!", es: "¡Juguemos otra vez!" },
    neutral: {
      en: "Something does not feel right; a veterinarian should check on me.",
      es: "Algo no se siente bien; que me revise el veterinario.",
    },
  },
};

/** Expected /evidence.json: {version,certainty_scale,citations,signals,combinations,
 * yamnet_dog_classes,ml_ceiling,forbidden_claims,not_verified,weight_note}.
 * Optional engineering overrides live in a separate argument, never in evidence.
 * Returns a fresh config; malformed evidence/overrides cannot change defaults.
 */
export function loadEvidence(json, overrides = {}) {
  if (
    !json ||
    typeof json !== "object" ||
    Array.isArray(json) ||
    typeof json.version !== "string" ||
    !json.citations ||
    !Object.keys(json.citations).length ||
    Object.entries(json.citations).some(
      ([id, ref]) =>
        !/^C\d+$/.test(id) ||
        typeof ref !== "string" ||
        !ref ||
        ref.length > 2000,
    ) ||
    !Array.isArray(json.signals) ||
    !Array.isArray(json.combinations) ||
    !Array.isArray(json.yamnet_dog_classes) ||
    !json.certainty_scale
  )
    throw new Error("Invalid evidence document");
  const checkRule = (rule) =>
    rule &&
    typeof rule.id === "string" &&
    Array.isArray(rule.citations) &&
    rule.citations.every((id) => Object.hasOwn(json.citations, id));
  if (
    !json.signals.every(
      (s) =>
        checkRule(s) &&
        Array.isArray(s.supports) &&
        s.supports.every(
          (x) =>
            typeof x.state === "string" &&
            Object.hasOwn(json.certainty_scale, x.certainty),
        ) &&
        Array.isArray(s.required_context),
    ) ||
    !json.combinations.every(
      (c) => checkRule(c) && Object.hasOwn(json.certainty_scale, c.certainty),
    ) ||
    !json.yamnet_dog_classes.every(
      (c) =>
        typeof c.name === "string" &&
        typeof c.label_quality === "string" &&
        Number.isInteger(c.idx),
    )
  )
    throw new Error("Invalid evidence rules");
  const config = structuredClone(PARAMETERS);
  const merge = (target, patch) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw new Error("Invalid engineering overrides");
    for (const [key, value] of Object.entries(patch)) {
      if (
        !Object.hasOwn(target, key) ||
        [
          "source",
          "citations",
          "states",
          "audioSet",
          "vocalSignals",
          "transitions",
          "triggerPriority",
          "templates",
        ].includes(key)
      )
        throw new Error(`Unknown engineering parameter: ${key}`);
      if (typeof target[key] === "object") merge(target[key], value);
      else if (
        typeof target[key] !== "number" ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 3600000
      )
        throw new Error(`Invalid engineering parameter: ${key}`);
      else target[key] = value;
    }
  };
  merge(config, overrides);
  if (
    !config.evaluationWindowMs ||
    !config.debounceMs ||
    config.baseline.weight <= 0 ||
    config.baseline.weight > 1 ||
    config.spike.factor <= 1 ||
    !Number.isInteger(config.baseline.minimumSamples) ||
    Object.values(config.sensitivity).some((v) => v <= 0 || v > 10) ||
    Object.values(config.classThresholds).some((v) => v > 1) ||
    config.sustainedVocalMs < 120000 ||
    config.sustainedVocalMs > 300000
  )
    throw new Error("Invalid engineering ranges");
  if (
    config.dsp.rmsFloor > 1 ||
    config.dsp.noiseQuantile > 1 ||
    config.dsp.periodicityGate > 1 ||
    !Number.isInteger(config.dsp.minimumLag) ||
    !Number.isInteger(config.dsp.maximumLag) ||
    config.dsp.minimumLag < 1 ||
    config.dsp.maximumLag <= config.dsp.minimumLag ||
    config.dsp.maximumLag >= 480 ||
    config.calibration.relativeLowerQuantile >
      config.calibration.relativeUpperQuantile ||
    config.calibration.relativeUpperQuantile > 1 ||
    config.calibration.noiseMultiplier <= 0 ||
    config.audioScoreHoldMs > 30000
  )
    throw new Error("Invalid DSP/calibration ranges");
  config.source = "evidence";
  config.citations = { ...json.citations };
  config.labelQuality = Object.fromEntries(
    json.yamnet_dog_classes.map((c) => [c.name, c.label_quality]),
  );
  return config;
}
