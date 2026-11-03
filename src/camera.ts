import { cameraHeuristics, mergeAlerts } from "../public/camera-heuristics.js";
export { cameraHeuristics, mergeAlerts };
import {
  labels,
  matchesSchema,
  object,
  str,
  ValidationError,
  readingSchema,
} from "./schema";

const alertTypes = [
  "separation_anxiety",
  "prolonged_barking",
  "distress_vocalization",
  "pain_signs",
  "destructive_behavior",
  "inactivity",
  "other",
];
export const cameraSummarySchema = object({
  overall: str,
  timeline: {
    type: "array",
    items: object({
      ts: str,
      label: { type: "string", enum: labels },
      emoji: str,
      dog_says: str,
      note: str,
    }),
  },
  alerts: {
    type: "array",
    items: object({
      type: { type: "string", enum: alertTypes },
      severity: { type: "string", enum: ["info", "warning", "urgent"] },
      evidence: str,
      advice: str,
    }),
  },
  recommendations: { type: "array", items: str },
});
export interface CameraClip {
  ts: string;
  label: (typeof labels)[number];
  confidence: number;
  dog_says: string;
  signals: {
    bark: { present: boolean; description: string };
    tail: string;
    ears: string;
    posture: string;
    face: string;
    body_other: string;
  };
  vet_alert: { flag: boolean; urgency: string; reasons: string[] };
  mode?: "live" | "mock";
}
export interface CameraInput {
  lang: "en" | "es";
  clips: CameraClip[];
}
export function validateCamera(value: unknown): CameraInput {
  const v = value as CameraInput;
  if (
    !v ||
    !["en", "es"].includes(v.lang) ||
    !Array.isArray(v.clips) ||
    v.clips.length < 1 ||
    v.clips.length > 8 ||
    JSON.stringify(v).length > 60000
  )
    throw new ValidationError("Provide 1–8 compact camera readings.");
  for (const c of v.clips) {
    if (
      !c ||
      typeof c.ts !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.ts) ||
      !Number.isFinite(Date.parse(c.ts)) ||
      !labels.includes(c.label) ||
      !Number.isFinite(c.confidence) ||
      c.confidence < 0 ||
      c.confidence > 1 ||
      typeof c.dog_says !== "string" ||
      c.dog_says.length > 1000 ||
      !matchesSchema(
        {
          vocalization: {
            type: "none",
            present: false,
            description: "Not provided by legacy client.",
          },
          ...c.signals,
        },
        readingSchema.properties.signals,
      ) ||
      !matchesSchema(c.vet_alert, readingSchema.properties.vet_alert) ||
      (c.mode !== undefined && !["live", "mock"].includes(c.mode))
    )
      throw new ValidationError("Invalid camera reading.");
  }
  return {
    lang: v.lang,
    clips: [...v.clips].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)),
  };
}
export function mockCameraSummary(input: CameraInput) {
  const es = input.lang === "es";
  return {
    overall: es
      ? "Resumen de demostración: los vídeos no se analizaron."
      : "Demo summary: videos were not analyzed.",
    timeline: input.clips.map((c) => ({
      ts: c.ts,
      label: c.label,
      emoji: "🐾",
      dog_says: c.dog_says,
      note: es
        ? "Lectura de demostración, no observación."
        : "Demo reading, not an observation.",
    })),
    alerts: cameraHeuristics(input),
    recommendations: [
      es
        ? "Comprueba personalmente cómo está tu perro. Interpretación, no diagnóstico."
        : "Check on your dog personally. Interpretation, not a diagnosis.",
    ],
    mode: "mock",
  };
}
export function validateCameraSummary(value: unknown, input: CameraInput) {
  if (!matchesSchema(value, cameraSummarySchema))
    throw new Error("Invalid camera summary");
  const result = value as ReturnType<typeof mockCameraSummary>;
  if (
    result.timeline.length !== input.clips.length ||
    result.timeline.some(
      (c, i) => c.ts !== input.clips[i].ts || c.label !== input.clips[i].label,
    )
  )
    throw new Error("Invalid camera timeline");
  return result;
}
