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
const str = { type: "string" };
const confidence = { type: "number", minimum: 0, maximum: 1 };
const list = { type: "array", items: str };
const object = (properties: Record<string, unknown>) => ({
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
  }),
  secondary: {
    type: "array",
    items: object({ label: { type: "string", enum: labels }, confidence }),
  },
  signals: object({
    bark: object({ present: { type: "boolean" }, description: str }),
    tail: str,
    ears: str,
    posture: str,
    face: str,
    body_other: str,
  }),
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
export type AnalyzeInput = {
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
      Array.isArray(value) && value.every((v) => matchesSchema(v, schema.items))
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
