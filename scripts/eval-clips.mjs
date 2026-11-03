// Run against a local or explicitly selected PerritoTalk endpoint; never logs payloads.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { execFileSync } from "node:child_process";
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
  const response = await fetch(
    new URL("/api/analyze", process.env.PERRITO_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "es",
        source: "upload",
        media: [
          {
            kind: "video",
            mime: "video/mp4",
            data_b64: (await readFile(file)).toString("base64"),
          },
        ],
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
}
