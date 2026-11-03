import type { AnalyzeInput, WatcherHints } from "./schema";
import { PARAMETERS } from "../public/watcher/evidence-config.js";
export type SamBox = [number, number, number, number];
export type SamObservation = {
  dogs: number;
  best_c: number;
  box: SamBox | null;
  frames_checked: number;
};
export const EMPTY_SAM: SamObservation = {
  dogs: 0,
  best_c: 0,
  box: null,
  frames_checked: 0,
};
// Engineering decision, not measured detector accuracy. Env can override the gate.
export const SAM_MIN_CONFIDENCE = 0.5;
export function parseSamBoxes(
  text: string,
): { confidence: number; box: SamBox }[] {
  if (!text.trim()) return [];
  const records = [...text.matchAll(/<\|box;([^|]+)\|>/g)];
  if (!records.length) throw new Error("Unrecognized SAM boxes");
  return records.map((record) => {
    const fields = Object.fromEntries(
      record[1].split(";").map((field) => field.split("=")),
    );
    const [x1, y1, x2, y2, w, h, c] = [
      "x1",
      "y1",
      "x2",
      "y2",
      "w",
      "h",
      "c",
    ].map((key) =>
      fields[key] === undefined || fields[key] === ""
        ? NaN
        : Number(fields[key]),
    );
    if (
      ![x1, y1, x2, y2, w, h, c].every(Number.isFinite) ||
      w <= 0 ||
      h <= 0 ||
      x2 <= x1 ||
      y2 <= y1 ||
      c < 0 ||
      c > 1 ||
      x1 < 0 ||
      y1 < 0 ||
      x2 > w ||
      y2 > h
    )
      throw new Error("Invalid SAM box");
    return {
      confidence: c,
      box: [x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h] as SamBox,
    };
  });
}
export function middleFrames(media: AnalyzeInput["media"]) {
  const images = media.filter((m) => m.kind === "image");
  return images.slice(
    Math.max(0, Math.floor((images.length - 2) / 2)),
    Math.max(0, Math.floor((images.length - 2) / 2)) + 2,
  );
}
export async function locateDogs(
  key: string,
  media: AnalyzeInput["media"],
  minimumConfidence = SAM_MIN_CONFIDENCE,
): Promise<SamObservation | null> {
  const frames = middleFrames(media);
  if (!frames.length) return null;
  // Any failed frame rejects the whole result: a partial negative must never gate Spark.
  const results = await Promise.all(
    frames.map(async (frame) => {
      const response = await fetch("https://api.meta.ai/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sam-3.1",
          input: [
            {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: "dog" },
                {
                  type: "input_image",
                  image_url: `data:${frame.mime};base64,${frame.data_b64}`,
                },
              ],
            },
          ],
          metadata: { include_confidence: "true", mask_encoding: "one_bit" },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("SAM unavailable");
      const data = (await response.json()) as {
        output_text?: string;
        output?: { content?: { text?: string }[] }[];
      };
      const texts =
        typeof data.output_text === "string"
          ? [data.output_text]
          : data.output
              ?.flatMap((o) => o.content || [])
              .filter((c) => typeof c.text === "string")
              .map((c) => c.text!);
      if (!texts?.length) throw new Error("Missing SAM result");
      return parseSamBoxes(texts.join("\n"));
    }),
  );
  const all = results.flat(),
    best = all.sort((a, b) => b.confidence - a.confidence)[0];
  return {
    dogs: Math.max(
      ...results.map(
        (boxes) =>
          boxes.filter((b) => b.confidence >= minimumConfidence).length,
      ),
    ),
    best_c: best?.confidence || 0,
    box: best?.box || null,
    frames_checked: frames.length,
  };
}
export function hasDogSound(watcher?: WatcherHints) {
  // Ignore Yip alone (C42); generic Dog/Canidae still establish an audio hint.
  if (
    watcher?.yamnet.some(
      ({ label, score }) =>
        label !== "Yip" &&
        Object.hasOwn(PARAMETERS.audioSet, label) &&
        score >=
          PARAMETERS.classThresholds[
            label as keyof typeof PARAMETERS.classThresholds
          ],
    )
  )
    return true;
  return Object.entries(watcher?.sound_scores || {}).some(
    ([signal, score]) =>
      signal !== "yip" &&
      score > 0 &&
      Object.entries(PARAMETERS.audioSet).some(
        ([label, mapped]) =>
          mapped === signal &&
          score >=
            PARAMETERS.classThresholds[
              label as keyof typeof PARAMETERS.classThresholds
            ],
      ),
  );
}
