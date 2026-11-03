import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calibrateReading,
  validateAnalyze,
  matchesSchema,
  readingSchema,
} from "../src/schema";
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
    expect(r.primary.label).toBe("wants_out");
    const { mode, ...reading } = r;
    expect(mode).toBe("mock");
    expect(matchesSchema(reading, readingSchema)).toBe(true);
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
    expect(r.dog_says).toContain("molesta");
  });
  it("varies by media and play context", () => {
    expect(
      mockReading({
        ...input(),
        context: {},
        media: [{ kind: "audio", mime: "audio/wav", data_b64: "AAAA" }],
      }).primary.label,
    ).toBe("attention");
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
  it("rejects structurally invalid model JSON", () => {
    expect(matchesSchema({}, readingSchema)).toBe(false);
    const { mode, ...reading } = mockReading(input());
    expect(matchesSchema({ ...reading, extra: 1 }, readingSchema)).toBe(false);
    expect(
      matchesSchema(
        { ...reading, primary: { ...reading.primary, confidence: 2 } },
        readingSchema,
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

describe("reading calibration", () => {
  it.each(["whine", "cry", "howl"])(
    "downgrades conflicting %s and preserves original and vet alert",
    (type) => {
      const reading = mockReading(input());
      reading.primary.label = "happy";
      reading.signals.vocalization = {
        type,
        present: true,
        description: "0–8s",
      };
      const checked = calibrateReading(reading, "en");
      expect(checked.primary).toMatchObject({
        label: "other",
        confidence: 0.39,
      });
      expect(checked.low_confidence).toBe(true);
      expect(checked.consistency_warnings).toHaveLength(1);
      expect(checked.dog_says).toContain("I'm not sure");
      expect(checked.vet_alert).toEqual(reading.vet_alert);
      expect(reading.primary.confidence).toBe(0.68);
    },
  );
  it("forces a hedged Spanish phrase below threshold, but leaves 0.4 unchanged", () => {
    const reading = mockReading(input());
    reading.primary.confidence = 0.1;
    expect(calibrateReading(reading, "es")).toMatchObject({
      low_confidence: true,
      primary: { label: "other" },
      dog_says: expect.stringContaining("No estoy seguro"),
    });
    reading.primary.confidence = 0.4;
    expect(calibrateReading(reading, "en")).toEqual(reading);
  });
  it("rejects missing or excessive evidence", () => {
    const { mode, ...reading } = mockReading(input());
    for (const evidence of [[], ["a", "b", "c", "d", "e"]])
      expect(
        matchesSchema(
          { ...reading, primary: { ...reading.primary, evidence } },
          readingSchema,
        ),
      ).toBe(false);
  });
});

describe("live reading safeguards without network", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends embedded video plus separate WAV intact and calibrates before returning", async () => {
    const { mode, ...reading } = mockReading(input());
    reading.primary.label = "tired";
    reading.signals.vocalization = {
      type: "howl",
      present: true,
      description: "Howling 0–8s",
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
      primary: { label: "other", confidence: 0.39 },
      dog_says: expect.stringContaining("howling"),
    });
    const content = JSON.parse(upstream.mock.calls[0][1].body).input[0].content;
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input_video",
          video_url: "data:video/mp4;base64,AAAA",
        }),
        expect.objectContaining({
          type: "input_audio",
          input_audio: { data: "AAAA", format: "wav" },
        }),
      ]),
    );
    expect(content[0].text).toContain("embedded audio");
  });
});
