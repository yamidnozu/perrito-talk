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
  class:
    | "silence"
    | "music_or_noise"
    | "howl"
    | "whine_whimper"
    | "bark"
    | "unclear";
  confidence: number;
  metrics: {
    active: number;
    tonal: number;
    longest_tonal_s: number;
    pitch_hz: number;
    bursts: number;
  };
};
export type AnalyzeInput = {
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
    v.media.length > 5
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
        "unclear",
      ].includes(h.class) ||
      !Number.isFinite(h.confidence) ||
      h.confidence < 0 ||
      h.confidence > 1 ||
      !h.metrics ||
      Object.keys(h).some(
        (k) => !["class", "confidence", "metrics"].includes(k),
      ) ||
      Object.keys(h.metrics).some(
        (k) =>
          ![
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
        return !Number.isFinite(n) || n < 0 || n > max;
      }) ||
      !Number.isInteger(h.metrics.bursts)
    )
      throw new ValidationError("Invalid acoustic hints.");
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
  if (schema.type === "number")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= schema.minimum &&
      value <= schema.maximum
    );
  return typeof value === schema.type;
}

/** Apply deterministic safeguards after schema validation without mutating the reading. */
export function calibrateReading<
  T extends {
    primary: { label: string; confidence: number };
    signals: { vocalization: { present: boolean; type: string } };
    low_confidence: boolean;
    consistency_warnings: string[];
    dog_says: string;
  },
>(reading: T, lang: "en" | "es", hints?: AcousticHints): T {
  const result = structuredClone(reading);
  const voice = result.signals.vocalization;
  if (
    ((voice.present && ["whine", "cry", "howl"].includes(voice.type)) ||
      (hints &&
        hints.confidence >= 0.5 &&
        ["howl", "whine_whimper"].includes(hints.class))) &&
    ["happy", "tired", "relaxed"].includes(result.primary.label)
  ) {
    result.primary.confidence = Math.min(result.primary.confidence, 0.39);
    result.consistency_warnings.push(
      lang === "es"
        ? "La vocalización contradice la interpretación de felicidad o descanso."
        : "The vocalization conflicts with the happy or resting interpretation.",
    );
  }
  if (result.primary.confidence < 0.4) {
    result.low_confidence = true;
    result.primary.label = "other";
    const sounds: Record<string, [string, string]> = {
      bark: ["Estoy ladrando. ", "I'm barking. "],
      howl: ["Estoy aullando. ", "I'm howling. "],
      whine: ["Estoy gimiendo. ", "I'm whimpering. "],
      cry: ["Estoy llorando o dando quejidos. ", "I'm crying or yelping. "],
      growl: ["Estoy gruñendo. ", "I'm growling. "],
      pant: ["Estoy jadeando. ", "I'm panting. "],
    };
    const sound = voice.present
      ? sounds[voice.type]?.[lang === "es" ? 0 : 1] || ""
      : "";
    result.dog_says =
      sound +
      (lang === "es"
        ? "No estoy seguro… quizá necesito que observes mis señales un poco más."
        : "I'm not sure… perhaps I need you to watch my signals a little longer.");
  }
  return result;
}
