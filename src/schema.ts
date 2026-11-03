// Shared strict model schema and request validation for Worker endpoints.
export const labels = [
  "hungry",
  "play",
  "anxious",
  "pain",
  "alert",
  "wants_out",
  "attention",
  "happy",
  "tired",
  "fear",
  "aggressive_warning",
  "other",
] as const;
export const str = { type: "string" };
const confidence = { type: "number", minimum: 0, maximum: 1 };
const list = { type: "array", items: str };
export const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const readingSchema = object({
  primary: object({
    label: { type: "string", enum: labels },
    emoji: str,
    confidence,
    evidence: { type: "array", items: str, minItems: 1, maxItems: 4 },
  }),
  secondary: {
    type: "array",
    items: object({ label: { type: "string", enum: labels }, confidence }),
  },
  signals: object({
    vocalization: object({
      type: {
        type: "string",
        enum: [
          "none",
          "bark",
          "howl",
          "whine",
          "cry",
          "growl",
          "pant",
          "human_voice_music_noise_only",
        ],
      },
      present: { type: "boolean" },
      description: str,
    }),
    bark: object({ present: { type: "boolean" }, description: str }),
    tail: str,
    ears: str,
    posture: str,
    face: str,
    body_other: str,
  }),
  low_confidence: { type: "boolean" },
  consistency_warnings: list,
  dog_says: str,
  explanation: str,
  what_to_do: list,
  vet_alert: object({
    flag: { type: "boolean" },
    urgency: { type: "string", enum: ["none", "monitor", "soon", "emergency"] },
    reasons: list,
  }),
  media_observed: str,
  disclaimer: str,
});
export const patternSchema = object({
  summary: str,
  patterns: list,
  tips: list,
  vet_note: str,
});
export type AcousticHints = {
  certainty?: "alta" | "moderada" | "baja" | "especulativa";
  source?: "engineering_provisional";
  class:
    | "silence"
    | "music_or_noise"
    | "howl"
    | "whine_whimper"
    | "bark"
    | "growl"
    | "unclear";
  confidence: number;
  metrics: {
    hnr?: number | null;
    active: number;
    tonal: number;
    longest_tonal_s: number;
    pitch_hz: number;
    bursts: number;
  };
};
export type WatcherHints = {
  trigger_types?: string[];
  sound_scores?: Record<string, number>;
  observations?: {
    vocal_type: string;
    bursts: number;
    sustained_s: number;
    activity: string;
  };
  trigger:
    | "state_change"
    | "vocal_start"
    | "vocal_sustained"
    | "dog_enter"
    | "dog_exit"
    | "motion_spike"
    | "heartbeat"
    | "first_look"
    | "checkin"
    | "manual"
    | "upload";
  prev_state: string | null;
  new_state: string;
  time_in_prev_state_s: number;
  yamnet: { label: string; score: number }[];
  motion: number;
  centroid_shift: number;
  bbox: [number, number, number, number] | null;
  dog_present: boolean | null;
  detector: "mediapipe" | "fallback";
};

/** Reject malformed hints; clamp finite measurements and bound payload sizes. */
export function validateWatcher(value: unknown): WatcherHints {
  const w = value as WatcherHints;
  const keys = [
    "trigger",
    "prev_state",
    "new_state",
    "time_in_prev_state_s",
    "yamnet",
    "motion",
    "centroid_shift",
    "bbox",
    "dog_present",
    "detector",
  ];
  const state = (v: unknown) =>
    typeof v === "string" && /^[a-z_]+(?::[a-z_]+)?$/.test(v) && v.length <= 60;
  if (
    !w ||
    typeof w !== "object" ||
    Array.isArray(w) ||
    Object.keys(w).filter(
      (k) => !["observations", "trigger_types", "sound_scores"].includes(k),
    ).length !== keys.length ||
    Object.keys(w).some(
      (k) =>
        !keys.includes(k) &&
        !["observations", "trigger_types", "sound_scores"].includes(k),
    ) ||
    ![
      "state_change",
      "vocal_start",
      "vocal_sustained",
      "dog_enter",
      "dog_exit",
      "motion_spike",
      "heartbeat",
      "first_look",
      "checkin",
      "manual",
      "upload",
    ].includes(w.trigger) ||
    !(w.prev_state === null || state(w.prev_state)) ||
    !state(w.new_state) ||
    !["mediapipe", "fallback"].includes(w.detector) ||
    !(w.dog_present === null || typeof w.dog_present === "boolean") ||
    !Array.isArray(w.yamnet) ||
    w.yamnet.length > 20 ||
    !(w.bbox === null || (Array.isArray(w.bbox) && w.bbox.length === 4))
  )
    throw new ValidationError("Invalid watcher hints.");
  const clamp = (n: number, max = 1) => {
    if (typeof n !== "number" || !Number.isFinite(n))
      throw new ValidationError("Invalid watcher measurement.");
    return Math.max(0, Math.min(max, n));
  };
  let observations: WatcherHints["observations"];
  if (w.observations !== undefined) {
    const o = w.observations;
    if (
      !o ||
      typeof o !== "object" ||
      Array.isArray(o) ||
      Object.keys(o).sort().join() !==
        "activity,bursts,sustained_s,vocal_type" ||
      !["bark", "howl", "whine", "growl", "yip", "none", "unclear"].includes(
        o.vocal_type,
      ) ||
      ![
        "still",
        "active",
        "restless",
        "absent",
        "at_zone",
        "vocalization",
        "unknown",
      ].includes(o.activity) ||
      !Number.isInteger(o.bursts)
    )
      throw new ValidationError("Invalid watcher observations.");
    observations = {
      vocal_type: o.vocal_type,
      bursts: clamp(o.bursts, 100000),
      sustained_s: clamp(o.sustained_s, 86400),
      activity: o.activity,
    };
  }
  if (
    w.trigger_types !== undefined &&
    (!Array.isArray(w.trigger_types) ||
      w.trigger_types.length > 7 ||
      w.trigger_types.some(
        (type) =>
          ![
            "state_change",
            "vocal_start",
            "vocal_sustained",
            "dog_enter",
            "dog_exit",
            "motion_spike",
            "heartbeat",
            "first_look",
            "checkin",
            "manual",
          ].includes(type),
      ))
  )
    throw new ValidationError("Invalid watcher trigger reasons.");
  if (
    w.sound_scores !== undefined &&
    (!w.sound_scores ||
      typeof w.sound_scores !== "object" ||
      Array.isArray(w.sound_scores) ||
      Object.keys(w.sound_scores).some(
        (key) =>
          !["dog", "bark", "howl", "whine", "growl", "yip"].includes(key),
      ))
  )
    throw new ValidationError("Invalid watcher sound scores.");
  const sound_scores = w.sound_scores
    ? Object.fromEntries(
        Object.entries(w.sound_scores).map(([key, score]) => [
          key,
          clamp(score),
        ]),
      )
    : undefined;
  const yamnet = w.yamnet
    .map((c) => {
      if (
        !c ||
        typeof c !== "object" ||
        Array.isArray(c) ||
        Object.keys(c).length !== 2 ||
        !Object.hasOwn(c, "label") ||
        !Object.hasOwn(c, "score") ||
        typeof c.label !== "string" ||
        !c.label.length ||
        c.label.length > 100
      )
        throw new ValidationError("Invalid watcher YAMNet scores.");
      return { label: c.label, score: clamp(c.score) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const bbox = w.bbox?.map((n) => clamp(n)) as WatcherHints["bbox"];
  if (bbox) {
    bbox[2] = Math.min(bbox[2], 1 - bbox[0]);
    bbox[3] = Math.min(bbox[3], 1 - bbox[1]);
  }
  return {
    ...(observations ? { observations } : {}),
    ...(w.trigger_types
      ? { trigger_types: [...new Set(w.trigger_types)] }
      : {}),
    ...(sound_scores ? { sound_scores } : {}),
    trigger: w.trigger,
    prev_state: w.prev_state,
    new_state: w.new_state,
    time_in_prev_state_s: clamp(w.time_in_prev_state_s, 86400),
    yamnet,
    motion: clamp(w.motion),
    centroid_shift: clamp(w.centroid_shift),
    bbox: bbox || null,
    dog_present: w.dog_present,
    detector: w.detector,
  };
}

export type AnalyzeInput = {
  deep?: boolean;
  watcher?: WatcherHints;
  context_mode?: "at_home" | "i_left" | "visitor" | "playing";
  baseline?: {
    pitch_hz: number;
    peak_hz: number;
    hnr: number;
    bark_rate: number;
    motion_p25: number;
    motion_p75: number;
    samples: number;
  };
  acoustic_hints?: AcousticHints;
  source?: "upload" | "camera" | "live";
  lang: "en" | "es";
  context: { breed?: string; age?: string; situation?: string };
  media: {
    kind: "image" | "video" | "audio";
    mime: string;
    data_b64: string;
  }[];
};
export class ValidationError extends Error {}

export function validateAnalyze(value: unknown): AnalyzeInput {
  const v = value as AnalyzeInput;
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    v.context === undefined
  )
    v.context = {};
  if (
    !v ||
    !["en", "es"].includes(v.lang) ||
    !v.context ||
    typeof v.context !== "object" ||
    Array.isArray(v.context) ||
    !Array.isArray(v.media) ||
    v.media.length < 1 ||
    v.media.length > (v.watcher !== undefined && v.source === "live" ? 8 : 5)
  )
    throw new ValidationError("Invalid language, context or media.");
  for (const [key, val] of Object.entries(v.context))
    if (
      !["breed", "age", "situation"].includes(key) ||
      typeof val !== "string" ||
      val.length > 1000
    )
      throw new ValidationError("Invalid context.");
  if (
    v.source !== undefined &&
    v.source !== "upload" &&
    v.source !== "camera" &&
    v.source !== "live"
  )
    throw new ValidationError("Invalid source.");
  if (v.deep !== undefined && typeof v.deep !== "boolean")
    throw new ValidationError("Invalid deep analysis option.");
  if (v.source === "live" && v.deep)
    throw new ValidationError("Live uses a single descriptor call.");
  if (
    v.context_mode !== undefined &&
    !["at_home", "i_left", "visitor", "playing"].includes(v.context_mode)
  )
    throw new ValidationError("Invalid context mode.");
  if (v.baseline !== undefined) {
    const keys = [
      "pitch_hz",
      "peak_hz",
      "hnr",
      "bark_rate",
      "motion_p25",
      "motion_p75",
      "samples",
    ];
    if (
      !v.baseline ||
      typeof v.baseline !== "object" ||
      Array.isArray(v.baseline) ||
      Object.keys(v.baseline).length !== keys.length ||
      Object.entries(v.baseline).some(
        ([k, n]) =>
          !keys.includes(k) ||
          typeof n !== "number" ||
          !Number.isFinite(n) ||
          n < (k === "hnr" ? -60 : 0) ||
          n > (k === "hnr" ? 60 : 10000000),
      )
    )
      throw new ValidationError("Invalid per-dog baseline.");
  }
  if (v.acoustic_hints !== undefined) {
    const h = v.acoustic_hints;
    if (
      !h ||
      ![
        "silence",
        "music_or_noise",
        "howl",
        "whine_whimper",
        "bark",
        "growl",
        "unclear",
      ].includes(h.class) ||
      !Number.isFinite(h.confidence) ||
      h.confidence < 0 ||
      h.confidence > 1 ||
      (h.certainty !== undefined &&
        !["alta", "moderada", "baja", "especulativa"].includes(h.certainty)) ||
      (h.source !== undefined && h.source !== "engineering_provisional") ||
      !h.metrics ||
      Object.keys(h).some(
        (k) =>
          !["class", "confidence", "metrics", "certainty", "source"].includes(
            k,
          ),
      ) ||
      Object.keys(h.metrics).some(
        (k) =>
          ![
            "hnr",
            "active",
            "tonal",
            "longest_tonal_s",
            "pitch_hz",
            "bursts",
          ].includes(k),
      ) ||
      Object.entries({
        active: 1,
        tonal: 1,
        longest_tonal_s: 3600,
        pitch_hz: 2000,
        bursts: 240000,
      }).some(([k, max]) => {
        const n = h.metrics[k as keyof AcousticHints["metrics"]];
        return !Number.isFinite(n) || (n as number) < 0 || (n as number) > max;
      }) ||
      (h.metrics.hnr !== undefined &&
        h.metrics.hnr !== null &&
        (!Number.isFinite(h.metrics.hnr) ||
          h.metrics.hnr < -60 ||
          h.metrics.hnr > 60)) ||
      !Number.isInteger(h.metrics.bursts)
    )
      throw new ValidationError("Invalid acoustic hints.");
  }
  if (v.watcher !== undefined) {
    v.watcher = validateWatcher(v.watcher);
    if (
      v.source === "live" &&
      (v.media.some(
        (m) => !m || !["image", "audio", "video"].includes(m.kind),
      ) ||
        v.media.filter((m) => m.kind === "image").length > 6 ||
        v.media.filter((m) => m.kind === "video").length > 1 ||
        v.media.filter((m) => m.kind === "audio").length !== 1)
    )
      throw new ValidationError(
        "Live watcher requires up to six frames, one video and one audio input.",
      );
  }
  let bytes = 0;
  for (const m of v.media) {
    const allowed = {
      image: ["image/jpeg", "image/png", "image/webp"],
      video: ["video/mp4"],
      audio: ["audio/wav", "audio/mpeg", "audio/mp3"],
    };
    if (
      !m ||
      !Object.hasOwn(allowed, m.kind) ||
      !allowed[m.kind]?.includes(m.mime) ||
      typeof m.data_b64 !== "string" ||
      !m.data_b64.length ||
      m.data_b64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(m.data_b64)
    )
      throw new ValidationError("Unsupported media or invalid base64.");
    const size =
      (m.data_b64.length * 3) / 4 -
      (m.data_b64.endsWith("==") ? 2 : m.data_b64.endsWith("=") ? 1 : 0);
    bytes += size;
    if (m.kind === "video" && size > 12 * 1024 * 1024)
      throw new ValidationError("MP4 exceeds 12 MB.");
  }
  if (bytes > 15 * 1024 * 1024)
    throw new ValidationError("Media exceeds 15 MB.");
  return v;
}

export function matchesSchema(value: unknown, schema: any): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object")
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      schema.required.every((k: string) => Object.hasOwn(value, k)) &&
      Object.keys(value).every(
        (k) =>
          schema.properties[k] &&
          matchesSchema((value as any)[k], schema.properties[k]),
      )
    );
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      (schema.minItems === undefined || value.length >= schema.minItems) &&
      (schema.maxItems === undefined || value.length <= schema.maxItems) &&
      value.every((v) => matchesSchema(v, schema.items))
    );
  if (schema.type === "number" || schema.type === "integer")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (schema.type !== "integer" || Number.isInteger(value)) &&
      value >= schema.minimum &&
      value <= schema.maximum
    );
  return typeof value === schema.type;
}
