// Run against a local or explicitly selected PerritoTalk endpoint; never logs payloads.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { execFileSync } from "node:child_process";
import { encodeWav } from "../public/media.js";
import { analyzeAcoustics } from "../public/acoustics.js";
const dir = process.argv[2];
if (!dir || !process.env.PERRITO_URL)
  throw new Error(
    "Usage: PERRITO_URL=http://localhost:8787 node scripts/eval-clips.mjs <dir>",
  );
// Results go to $OUT_DIR (default: ./results next to the clips).
const outDir = process.env.OUT_DIR || join(dir, "results");
await mkdir(outDir, { recursive: true });
for (const name of (await readdir(dir))
  .filter((n) => /\.mp4$/i.test(n))
  .sort()) {
  const file = join(dir, name);
  // Clips without an audio track make ffmpeg fail: treat them as silence.
  let raw;
  try {
    raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-t",
        "30",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "f32le",
        "-",
      ],
      { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    raw = Buffer.alloc(0);
  }
  const pcm = Float32Array.from({ length: raw.length / 4 }, (_, i) =>
    raw.readFloatLE(i * 4),
  );
  // Match browser uploads: MP4 plus two middle JPEGs and optional 16 kHz WAV.
  const media = [
    {
      kind: "video",
      mime: "video/mp4",
      data_b64: (await readFile(file)).toString("base64"),
    },
  ];
  const duration = Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim(),
  );
  if (Number.isFinite(duration) && duration > 0)
    for (const fraction of [0.35, 0.65]) {
      const jpeg = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(duration * fraction),
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:640:force_original_aspect_ratio=decrease",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "-",
        ],
        { maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
      );
      media.push({
        kind: "image",
        mime: "image/jpeg",
        data_b64: jpeg.toString("base64"),
      });
    }
  if (pcm.length)
    media.push({
      kind: "audio",
      mime: "audio/wav",
      data_b64: Buffer.from(await encodeWav(pcm).arrayBuffer()).toString(
        "base64",
      ),
    });
  const response = await fetch(
    new URL("/api/analyze", process.env.PERRITO_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "es",
        source: "upload",
        context_mode: process.env.CONTEXT_MODE || "at_home",
        media,
        acoustic_hints: analyzeAcoustics(pcm),
      }),
    },
  );
  const result = await response.json();
  await writeFile(
    join(outDir, `${parse(name).name}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  if (!response.ok) throw new Error(`Analysis failed: HTTP ${response.status}`);
  console.log(
    JSON.stringify({
      clip: name,
      observed_vocalization: result.observations?.vocalization,
      sam: result.sam
        ? { dogs: result.sam.dogs, confidence: result.sam.best_c }
        : null,
      human_speech: result.human_speech?.excerpt || "",
      top_state: result.interpretations?.[0]?.state,
      certainty: result.certainty,
      alerts: result.vet_alert,
      mode: result.mode,
    }),
  );
}
