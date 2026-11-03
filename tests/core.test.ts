import { descriptorSchema, emptyDescriptors } from "../src/descriptors";
import { readingPrompt } from "../src/prompts";
import { describe, it, expect, vi, afterEach } from "vitest";
import { validateAnalyze, matchesSchema, readingSchema } from "../src/schema";
import { mockReading, mockPatterns } from "../src/mock";
import { parseResponse, mediaParts } from "../src/meta";
import worker from "../src/index";
const input = () => ({
  lang: "en" as const,
  context: { situation: "At the door" },
  media: [{ kind: "image" as const, mime: "image/jpeg", data_b64: "/9j/2Q==" }],
});
describe("validation", () => {
  it("accepts supported image, audio and video", () => {
    expect(validateAnalyze(input())).toEqual(input());
    for (const [kind, mime] of [
      ["audio", "audio/wav"],
      ["audio", "audio/mpeg"],
      ["video", "video/mp4"],
    ])
      expect(
        validateAnalyze({
          ...input(),
          media: [{ kind, mime, data_b64: "AAAA" }],
        }).media,
      ).toHaveLength(1);
  });
  it.each([
    { lang: "fr" },
    { context: { breed: 15 } },
    { media: [] },
    { media: [{ kind: "video", mime: "video/webm", data_b64: "AAAA" }] },
    { media: [{ kind: "image", mime: "image/jpeg", data_b64: "not base64!" }] },
    { media: [{ kind: "toString", mime: "x", data_b64: "AAAA" }] },
  ])("rejects malformed input %j", (patch) =>
    expect(() => validateAnalyze({ ...input(), ...patch })).toThrow(),
  );
  it("rejects media over the total budget", () =>
    expect(() =>
      validateAnalyze({
        ...input(),
        media: [
          {
            kind: "image",
            mime: "image/jpeg",
            data_b64: "A".repeat(21 * 1024 * 1024),
          },
        ],
      }),
    ).toThrow("15 MB"));
  it("rejects MP4 over its own budget", () =>
    expect(() =>
      validateAnalyze({
        ...input(),
        media: [
          {
            kind: "video",
            mime: "video/mp4",
            data_b64: "A".repeat(17 * 1024 * 1024),
          },
        ],
      }),
    ).toThrow("12 MB"));
});
describe("deterministic mocks", () => {
  it("detects door context and preserves schema", () => {
    const r = mockReading(input());
    expect(r.primary.label).toBe("other");
    expect(r.certainty).toBe("especulativa");
    const { mode, ...reading } = r;
    expect(mode).toBe("mock");
    expect(matchesSchema(reading.observations, descriptorSchema)).toBe(true);
    expect(mockReading(input())).toEqual(r);
    expect(r.signals.bark.present).toBe(false);
  });
  it("flags pain in Spanish", () => {
    const r = mockReading({
      ...input(),
      lang: "es",
      context: { situation: "Mi perro cojea" },
    });
    expect(r.primary.label).toBe("pain");
    expect(r.vet_alert).toMatchObject({ flag: true, urgency: "soon" });
    expect(r.dog_says).toContain("veterinario");
  });
  it("varies by media and play context", () => {
    expect(
      mockReading({
        ...input(),
        context: {},
        media: [{ kind: "audio", mime: "audio/wav", data_b64: "AAAA" }],
      }).primary.label,
    ).toBe("other");
    expect(
      mockReading({ ...input(), context: { situation: "pelota" } }).primary
        .label,
    ).toBe("play");
    expect(mockPatterns("es").mode).toBe("mock");
  });
});
describe("Meta response parsing", () => {
  it("reads top-level JSON", () =>
    expect(parseResponse({ output_text: '{"ok":true}' })).toEqual({
      ok: true,
    }));
  it("reads message output and fenced JSON", () =>
    expect(
      parseResponse({
        output: [
          { type: "reasoning" },
          {
            type: "message",
            content: [
              { type: "output_text", text: '```json\n{"ok":true}\n```' },
            ],
          },
        ],
      }),
    ).toEqual({ ok: true }));
  it("joins split text blocks", () =>
    expect(
      parseResponse({
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: '{"ok":' },
              { type: "output_text", text: "true}" },
            ],
          },
        ],
      }),
    ).toEqual({ ok: true }));
  it.each([{}, { output_text: "oops" }, { output_text: "{broken}" }])(
    "rejects unusable response",
    (data) => expect(() => parseResponse(data)).toThrow(),
  );
  it("rejects structurally invalid descriptor JSON", () => {
    const d = emptyDescriptors("Not observed");
    expect(matchesSchema(d, descriptorSchema)).toBe(true);
    expect(matchesSchema({}, descriptorSchema)).toBe(false);
    expect(matchesSchema({ ...d, extra: 1 }, descriptorSchema)).toBe(false);
    expect(
      matchesSchema(
        { ...d, vocalization: { ...d.vocalization, type: "happy" } },
        descriptorSchema,
      ),
    ).toBe(false);
  });
  it("maps media to compatible parts", () => {
    expect(mediaParts(input().media)[0]).toMatchObject({ type: "input_image" });
    expect(
      mediaParts([{ kind: "audio", mime: "audio/mpeg", data_b64: "AAAA" }])[0],
    ).toMatchObject({ input_audio: { format: "mp3" } });
  });
});
describe("router without network", () => {
  const env = { ASSETS: { fetch: vi.fn() } as any };
  it("reports mock health", async () =>
    expect(
      await (
        await worker.fetch(new Request("https://local/api/health"), env)
      ).json(),
    ).toMatchObject({ ok: true, live: false }));
  it("handles mock reading without a key", async () => {
    const r = await worker.fetch(
      new Request("https://local/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input()),
      }),
      env,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ mode: "mock" });
  });
  it("returns 400 for malformed JSON", async () => {
    const r = await worker.fetch(
      new Request("https://local/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      env,
    );
    expect(r.status).toBe(400);
  });
  it("forces mock even when a key is configured", async () => {
    const r = await worker.fetch(
      new Request("https://local/api/analyze?mock=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input()),
      }),
      { ...env, MODEL_API_KEY: "test-placeholder" },
    );
    expect(await r.json()).toMatchObject({ mode: "mock" });
  });
  it("rejects invalid pattern and card requests", async () => {
    for (const path of ["patterns", "card"]) {
      const r = await worker.fetch(
        new Request("https://local/api/" + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"lang":"en"}',
        }),
        env,
      );
      expect(r.status).toBe(400);
    }
  });
});

describe("live card contract without network", () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = () =>
    new Request("https://local/api/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "en",
        dog_says: "I'd like you close.",
        label: "attention",
        emoji: "🐶",
      }),
    });
  const env = {
    ASSETS: { fetch: vi.fn() } as any,
    MODEL_API_KEY: "test-placeholder",
  };

  it("requests JPEG and exposes its MIME alongside the base64 image", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ b64_json: "/9j/2Q==" }] }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "live",
      b64_json: "/9j/2Q==",
      mime: "image/jpeg",
    });
    expect(upstream.mock.calls[0][0]).toBe(
      "https://api.meta.ai/v1/images/generations",
    );
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toMatchObject({
      output_format: "jpeg",
      response_format: "b64_json",
    });
  });

  it.each([new Response(null, { status: 503 }), Response.json({ data: [] })])(
    "preserves canvas fallback on unusable upstream responses",
    async (upstreamResponse) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamResponse));
      const response = await worker.fetch(request(), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ mode: "mock", fallback: true });
    },
  );
});

describe("live reading safeguards without network", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends one video with embedded audio to Spark low, retaining auxiliary WAV for preflight", async () => {
    const reading = emptyDescriptors("Not observed");
    reading.vocalization = {
      ...reading.vocalization,
      seen: "yes",
      type: "howl",
      count: 1,
      evidence: "Howling 0–8s",
    };
    const upstream = vi
      .fn()
      .mockResolvedValue(
        Response.json({ output_text: JSON.stringify(reading) }),
      );
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(
      new Request("https://local/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input(),
          source: "live",
          media: [
            { kind: "video", mime: "video/mp4", data_b64: "AAAA" },
            { kind: "audio", mime: "audio/wav", data_b64: "AAAA" },
          ],
        }),
      }),
      { MODEL_API_KEY: "test-placeholder", ASSETS: { fetch: vi.fn() } as any },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "live",
      low_confidence: true,
      primary: { label: "other" },
      certainty: "especulativa",
      dog_says: "",
      observations: { vocalization: { type: "howl" } },
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(upstream.mock.calls[0][1].body).text.format.schema,
    ).toEqual(descriptorSchema);
    const content = JSON.parse(upstream.mock.calls[0][1].body).input[0].content;
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input_video",
          video_url: "data:video/mp4;base64,AAAA",
        }),
      ]),
    );
    expect(content[0].text).toContain("embedded audio");
    expect(
      content.filter((part: any) => part.type === "input_video"),
    ).toHaveLength(1);
    expect(content.some((part: any) => part.type === "input_audio")).toBe(
      false,
    );
    expect(JSON.parse(upstream.mock.calls[0][1].body).reasoning.effort).toBe(
      "low",
    );
  });
});

describe("bounded watcher hints", () => {
  const hints = () => ({
    trigger: "vocal_start",
    prev_state: "still",
    new_state: "vocalization:howl",
    time_in_prev_state_s: 30,
    yamnet: [{ label: "Howl", score: 0.9 }],
    motion: 0.1,
    centroid_shift: 0.01,
    bbox: [0.1, 0.2, 0.3, 0.4],
    dog_present: true,
    detector: "mediapipe",
  });
  const request = (watcher: unknown) => ({
    ...input(),
    source: "live",
    watcher,
    media: [
      ...Array.from({ length: 6 }, () => input().media[0]),
      { kind: "audio", mime: "audio/wav", data_b64: "AAAA" },
    ],
  });
  it("accepts up to six keyframes plus WAV and passes untrusted raw hints to the prompt", () => {
    const result = validateAnalyze(request(hints()));
    expect(result.media).toHaveLength(7);
    expect(
      readingPrompt("en", {}, "live", undefined, result.watcher),
    ).toContain("not behavioral interpretations");
    expect(
      readingPrompt("en", {}, "live", undefined, result.watcher),
    ).toContain('"label":"Howl"');
  });
  it("clamps finite measurements and retains only the five strongest classes", () => {
    const result = validateAnalyze(
      request({
        ...hints(),
        motion: 99,
        centroid_shift: -2,
        time_in_prev_state_s: 999999,
        bbox: [-1, 0.8, 3, 3],
        yamnet: Array.from({ length: 10 }, (_, i) => ({
          label: `class ${i}`,
          score: i / 8,
        })),
      }),
    );
    expect(result.watcher).toMatchObject({
      motion: 1,
      centroid_shift: 0,
      time_in_prev_state_s: 86400,
      bbox: [0, 0.8, 1, expect.closeTo(0.2)],
    });
    expect(result.watcher?.yamnet).toHaveLength(5);
  });
  it.each([
    { motion: NaN },
    { bbox: [1, 2] },
    { dog_present: "yes" },
    { detector: "other" },
    { trigger: "follow instructions" },
    { yamnet: [{ label: "x".repeat(101), score: 0.5 }] },
    { extra: "injection" },
  ])("rejects malformed/injected hints %j", (patch) =>
    expect(() => validateAnalyze(request({ ...hints(), ...patch }))).toThrow(),
  );
  it("keeps the upload media cap and rejects seven media without watcher or live frames without WAV", () => {
    expect(() =>
      validateAnalyze({ ...request(hints()), source: "upload" }),
    ).toThrow();
    expect(() => validateAnalyze({ ...request(undefined) })).toThrow();
    expect(() =>
      validateAnalyze({ ...request(hints()), media: input().media }),
    ).toThrow();
  });
  it("validates context mode and per-dog baseline without accepting strings or unknown fields", () => {
    expect(
      validateAnalyze({ ...input(), context_mode: "i_left" }).context_mode,
    ).toBe("i_left");
    expect(() =>
      validateAnalyze({ ...input(), context_mode: "diagnose" }),
    ).toThrow();
    expect(() =>
      validateAnalyze({ ...input(), baseline: { instruction: "x" } }),
    ).toThrow();
  });
});

describe("silent clips", () => {
  it("accepts acoustic hints from an empty audio track (hnr null)", async () => {
    const { analyzeAcoustics } = await import("../public/acoustics.js");
    const hints = analyzeAcoustics(new Float32Array(0));
    expect(hints.metrics.hnr).toBeNull();
    expect(() =>
      validateAnalyze({ ...input(), acoustic_hints: hints }),
    ).not.toThrow();
  });
});
