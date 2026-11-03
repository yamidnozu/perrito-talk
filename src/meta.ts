import { descriptorSchema, type Descriptors } from "./descriptors";
import { matchesSchema } from "./schema";
import { vote } from "./vote";
export { vote } from "./vote";
// Meta API adapters; credentials stay in the Worker.
import { SYSTEM } from "./prompts";
import type { AnalyzeInput } from "./schema";
export const MODEL = "muse-spark-1.3";

export function parseResponse(data: any): unknown {
  const text =
    data.output_text ??
    data.output
      ?.filter((o: any) => o.type === "message")
      .flatMap((o: any) => o.content ?? [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("");
  if (typeof text !== "string") throw new Error("Missing response text");
  try {
    return JSON.parse(text);
  } catch {
    // Some responses wrap the JSON in a Markdown fence.
    const start = text.indexOf("{"),
      end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("Invalid JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
}

export function mediaParts(media: AnalyzeInput["media"]) {
  return media.map((m) =>
    m.kind === "image"
      ? {
          type: "input_image",
          image_url: `data:${m.mime};base64,${m.data_b64}`,
        }
      : m.kind === "video"
        ? {
            type: "input_video",
            video_url: `data:video/mp4;base64,${m.data_b64}`,
          }
        : {
            type: "input_audio",
            input_audio: {
              data: m.data_b64,
              format: m.mime === "audio/wav" ? "wav" : "mp3",
            },
          },
  );
}

/** Only explicitly supported summary models; descriptors always use Spark. */
export function summaryModel(value?: string) {
  return value === "muse-wonder-1.0" ? value : MODEL;
}
export async function structured(
  key: string,
  prompt: string,
  schema: unknown,
  parts: unknown[] = [],
  model = MODEL,
  timeoutMs = 90000,
) {
  const audioNote = parts.some((p: any) => p.type === "input_video")
    ? "A video with its original embedded audio is attached. Listen to that track before choosing a label; report unavailable audio explicitly."
    : parts.some((p: any) => p.type === "input_audio")
      ? "An audio track is attached. Listen to it before choosing a label, including when accompanied by video frames."
      : "No audio track is attached; do not invent audible vocalizations.";
  const r = await fetch("https://api.meta.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: `${prompt}\n${audioNote}` },
            ...parts,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "dog_reading",
          strict: true,
          schema,
        },
      },
      reasoning: { effort: "low" },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error("Model unavailable");
  return parseResponse(await r.json());
}

/** Three descriptions in parallel, one retry each, followed by one code vote. */
export async function deepDescriptors(
  key: string,
  prompt: string,
  parts: unknown[],
  lang: "en" | "es",
) {
  let calls = 0;
  const descriptions = await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          calls++;
          const result = await structured(
            key,
            prompt,
            descriptorSchema,
            parts,
            MODEL,
            30000,
          );
          if (!matchesSchema(result, descriptorSchema))
            throw new Error("Invalid model descriptors");
          return result as Descriptors;
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
      throw new Error("Descriptor attempts exhausted");
    }),
  );
  return { descriptors: vote(descriptions, lang), calls };
}

export async function imageCard(key: string, prompt: string) {
  const r = await fetch("https://api.meta.ai/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "muse-image-1.0",
      prompt,
      size: "1024x1024",
      response_format: "b64_json",
      output_format: "jpeg",
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw new Error("Image unavailable");
  const data = (await r.json()) as any;
  if (typeof data.data?.[0]?.b64_json !== "string")
    throw new Error("Missing image");
  return { b64_json: data.data[0].b64_json as string, mime: "image/jpeg" };
}
