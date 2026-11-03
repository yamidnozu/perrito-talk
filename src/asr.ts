import type { AnalyzeInput } from "./schema";
export type SpeechTurn = {
  startMs: number;
  endMs: number;
  transcript: string;
  speaker: string;
};
export type HumanSpeech = {
  present: boolean;
  turns: SpeechTurn[];
  speakers: string[];
  excerpt: string;
};
export const EMPTY_SPEECH: HumanSpeech = {
  present: false,
  turns: [],
  speakers: [],
  excerpt: "",
};
// Engineering filters for spurious very short turns; configurable via env.
export const ASR_FILTER = { minimumTurnMs: 400, minimumWords: 2 };
export function filterSpeech(
  value: unknown,
  options = ASR_FILTER,
): HumanSpeech {
  const data = value as { turns?: unknown[] };
  if (!data || !Array.isArray(data.turns))
    throw new Error("Invalid ASR response");
  const turns: SpeechTurn[] = [];
  for (const raw of data.turns.slice(0, 500)) {
    const turn = raw as SpeechTurn;
    if (
      !turn ||
      !Number.isFinite(turn.startMs) ||
      !Number.isFinite(turn.endMs) ||
      turn.startMs < 0 ||
      turn.endMs - turn.startMs < options.minimumTurnMs ||
      typeof turn.transcript !== "string"
    )
      continue;
    const transcript = turn.transcript.trim().slice(0, 2000);
    if (
      (transcript.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || []).length <
      options.minimumWords
    )
      continue;
    if (typeof turn.speaker !== "string" && typeof turn.speaker !== "number")
      continue;
    turns.push({
      startMs: turn.startMs,
      endMs: turn.endMs,
      transcript,
      speaker: String(turn.speaker).slice(0, 80),
    });
  }
  turns.sort((a, b) => a.startMs - b.startMs);
  return {
    present: turns.length > 0,
    turns,
    speakers: [...new Set(turns.map((t) => t.speaker))],
    excerpt: turns
      .map((t) => t.transcript)
      .join(" ")
      .slice(0, 160),
  };
}
/** Validate the container before forwarding it; no server-side codec dependency. */
export function wavBytes(base64: string): Uint8Array | null {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer),
    tag = (offset: number) =>
      String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (
    tag(0) !== "RIFF" ||
    tag(8) !== "WAVE" ||
    view.getUint32(4, true) + 8 > bytes.length
  )
    return null;
  let format = false,
    audio = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4, true),
      end = offset + 8 + length;
    if (end > bytes.length) return null;
    if (tag(offset) === "fmt " && length >= 16)
      format =
        view.getUint16(offset + 8, true) === 1 &&
        view.getUint16(offset + 10, true) === 1 &&
        view.getUint16(offset + 22, true) === 16 &&
        view.getUint32(offset + 12, true) >= 8000;
    if (tag(offset) === "data") audio = length > 0 && length % 2 === 0;
    offset = end + (length % 2);
  }
  return format && audio ? bytes : null;
}
export async function transcribeSpeech(
  key: string,
  media: AnalyzeInput["media"],
  options = ASR_FILTER,
): Promise<HumanSpeech | null> {
  const audio = media.find((m) => m.kind === "audio" && m.mime === "audio/wav");
  if (!audio) return null;
  const bytes = wavBytes(audio.data_b64);
  if (!bytes) return null;
  const form = new FormData();
  form.append(
    "request",
    new Blob(
      [
        JSON.stringify({
          model: "muse-voice-transcribe-1.0",
          audioEncoding: "WAV",
          mode: "DIARIZATION",
        }),
      ],
      { type: "application/json" },
    ),
  );
  form.append(
    "audio",
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" }),
    "clip.wav",
  );
  const response = await fetch("https://api.meta.ai/v1/asr/transcribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("ASR unavailable");
  return filterSpeech(await response.json(), options);
}
