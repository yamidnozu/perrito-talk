import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require(process.env.PUPPETEER_CORE || "puppeteer-core");
} catch {
  puppeteer = require("/tmp/lt/node_modules/puppeteer-core");
}
const y4m = process.env.Y4M || "/tmp/lt/seq0807.y4m",
  wav = process.env.WAV || "/tmp/lt/seq0807.wav";
await Promise.all([access(y4m), access(wav)]);
const url = new URL(
  process.env.PERRITO_URL || "http://localhost:8787/?watcher-dry=1",
);
url.searchParams.set("watcher-dry", "1");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${y4m}`,
    `--use-file-for-fake-audio-capture=${wav}`,
  ],
});
try {
  const page = await browser.newPage(),
    errors = [],
    calls = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/analyze") {
      assert.equal(new URL(r.url()).searchParams.get("mock"), "1");
      const data = JSON.parse(r.postData());
      // Optional fake-fixture artifact for independent container/codec checks.
      const video = data.media.find((m) => m.kind === "video");
      if (process.env.PERRITO_E2E_VIDEO && video)
        writeFileSync(
          process.env.PERRITO_E2E_VIDEO,
          Buffer.from(video.data_b64, "base64"),
        );
      calls.push({
        source: data.source,
        trigger: data.watcher?.trigger,
        types: data.watcher?.trigger_types,
        media: data.media.map((m) => ({
          kind: m.kind,
          mime: m.mime,
          bytes: Buffer.from(m.data_b64, "base64").length,
          ...(m.mime === "audio/wav"
            ? {
                duration_s:
                  Buffer.from(m.data_b64, "base64").readUInt32LE(40) / 32000,
              }
            : {}),
        })),
      });
    }
  });
  await page.goto(url.href, { waitUntil: "networkidle0" });
  await page.click("#liveTab");
  await page.click("#liveStart");
  await page.waitForFunction(
    () =>
      document.querySelector("#liveStatus").textContent.includes("Watching") ||
      document.querySelector("#liveStatus").textContent.includes("Vigilando"),
    { timeout: 15000 },
  );
  await new Promise((resolve) =>
    setTimeout(resolve, Number(process.env.WATCHER_WAIT_MS || 45000)),
  );
  const data = await page.evaluate(() => window.__watcher);
  const first = data.triggers[0];
  const summary = {
    mechanics_only: true,
    state: data.state,
    first_trigger_s: first ? +(first.t / 1000).toFixed(2) : null,
    first_trigger_type: first?.type || null,
    howl_s:
      data.triggers.find(
        (trigger) =>
          trigger.type === "vocal_start" && trigger.next?.includes("howl"),
      )?.t / 1000 || null,
    triggers: data.triggers,
    events: data.events,
    ai_calls: data.aiCalls,
    saved: data.saved,
    requests: calls,
    errors,
    detectors: data.features.at(-1),
    ...(process.env.WATCHER_LOG_FEATURES === "1"
      ? {
          feature_windows: data.features,
        }
      : {}),
  };
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(errors.length, 0, "Browser errors");
  assert.ok(first, "No trigger observed");
  // A present dog gets a quick first look; scene-change triggers wait for the scripted change.
  assert.equal(first.type, "first_look", "First trigger is not first_look");
  assert.ok(first.t <= 8000, "first_look later than 8 seconds");
  // Calibrated thresholds are deliberately sensitive (small dogs), so the REM
  // twitches in the first segment may also produce scene triggers; the scripted
  // change must still be caught.
  const scene = data.triggers.filter(
    (t) => !["first_look", "checkin"].includes(t.type),
  );
  assert.ok(
    scene.some((t) => t.t >= 30000 && t.t <= 37000),
    "No scene trigger in 30–37 seconds",
  );
  assert.ok(data.readings > 0, "No reading rendered");
  const card = await page.$eval("#liveResult", (el) => ({
    hidden: el.hidden,
    text: el.textContent.trim().length,
  }));
  assert.ok(!card.hidden && card.text > 20, "Result card not visible");
  const howl = data.triggers.find(
    (trigger) =>
      (trigger.type === "vocal_start" ||
        trigger.types?.includes("vocal_start")) &&
      trigger.next?.includes("howl") &&
      trigger.t <= 42000,
  );
  assert.ok(howl, "No howl vocal_start observed or merged by 42 seconds");
  assert.ok(
    data.aiCalls > 0 && data.aiCalls <= 3,
    "AI call count outside budget",
  );
  assert.equal(data.aiCalls, calls.length);
  assert.ok(data.saved >= 0, "Savings counter missing");
  assert.ok(
    calls.every(
      (c) =>
        c.source === "live" &&
        c.media.some((m) => m.mime === "audio/wav" && m.duration_s === 10) &&
        c.media.some(
          (m) => m.kind === "video" && m.mime === "video/mp4" && m.bytes > 1000,
        ) &&
        // A first look right after start only has a few seconds of history.
        c.media.filter((m) => m.kind === "image").length >=
          (c.trigger === "first_look" ? 3 : 6),
    ),
    "Malformed pre-roll clip",
  );
  await page.click("#liveStop");
  if (await page.evaluate(() => document.documentElement.lang !== "es"))
    await page.click("#language");
  assert.equal(
    await page.$eval("#liveTitle", (e) => e.textContent),
    "Vigilante",
  );
  assert.equal(await page.$eval("#liveStart", (e) => e.textContent), "Iniciar");
  console.log("Watcher mechanics E2E: PASS (not an accuracy evaluation)");
} finally {
  await browser.close();
}
