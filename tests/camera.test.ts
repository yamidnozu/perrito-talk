import { describe, expect, it, vi, afterEach } from "vitest";
import {
  cameraHeuristics,
  validateCamera,
  mockCameraSummary,
  validateCameraSummary,
  cameraSummarySchema,
  mergeAlerts,
} from "../src/camera";
import { mockReading } from "../src/mock";
import { matchesSchema, validateAnalyze } from "../src/schema";
import worker from "../src/index";
const reading = mockReading({
  lang: "en",
  context: {},
  media: [{ kind: "video", mime: "video/mp4", data_b64: "AAAA" }],
});
const clip = (minute = 0, label = "anxious", bark = true) => ({
  ts: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  label,
  confidence: 0.6,
  dog_says: reading.dog_says,
  signals: {
    ...reading.signals,
    bark: { present: bark, description: "Bark reported" },
  },
  vet_alert: reading.vet_alert,
});
const input = () =>
  validateCamera({ lang: "en", clips: [clip(20), clip(0), clip(10)] });
const env = { ASSETS: { fetch: vi.fn() } } as any;
const request = (path: string, data: unknown) =>
  new Request(`https://local/api/camera/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
afterEach(() => vi.unstubAllGlobals());
describe("camera heuristics and validation", () => {
  const voiced = (minute: number, type: string) => ({
    ...clip(minute, "other", false),
    signals: {
      ...clip().signals,
      bark: { present: false, description: "" },
      vocalization: { present: type !== "none", type, description: type },
    },
  });
  it("never infers separation or prolonged barking from legacy labels or sparse voices", () => {
    const v = validateCamera({
      lang: "en",
      clips: ["whine", "howl", "bark"].map((v, i) => voiced(i, v)),
    });
    expect(cameraHeuristics(v)).toEqual([]);
  });
  it("gates a sourced separation pattern on declared absence", () => {
    const sourced = {
      ...clip(),
      interpretations: [
        {
          state: "compatible_with_separation_related_problem",
          certainty: "moderada",
          citations: ["C35", "C37"],
          conditional: false,
        },
      ],
    };
    expect(
      cameraHeuristics(validateCamera({ lang: "en", clips: [sourced] })),
    ).toEqual([]);
    const v = validateCamera({
      lang: "en",
      clips: [{ ...sourced, context_mode: "i_left" }],
    });
    expect(cameraHeuristics(v)[0]).toMatchObject({
      type: "separation_anxiety",
      severity: "warning",
    });
  });
  it("preserves chronological order and urgent vet alerts without relying on emotion labels", () => {
    const v = input();
    expect(v.clips[0].ts).toBe(clip(0).ts);
    v.clips[0].vet_alert = {
      flag: true,
      urgency: "emergency",
      reasons: ["Collapse"],
    };
    expect(cameraHeuristics(v)).toEqual([
      expect.objectContaining({
        type: "pain_signs",
        severity: "urgent",
        advice: expect.stringContaining("not a diagnosis"),
      }),
    ]);
  });
  it.each([
    [],
    Array(9).fill(clip()),
    [{ ...clip(), ts: "bad" }],
    [{ ...clip(), confidence: 2 }],
    [{ ...clip(), signals: {} }],
    [{ ...clip(), mode: "unknown" }],
  ])("rejects invalid clips", (clips) => {
    expect(() => validateCamera({ lang: "en", clips })).toThrow();
  });
  it("validates camera source without changing normal analysis", () => {
    const v = {
      lang: "en",
      context: {},
      media: [{ kind: "video", mime: "video/mp4", data_b64: "AAAA" }],
    };
    expect(validateAnalyze({ ...v, source: "camera" }).source).toBe("camera");
    expect(() => validateAnalyze({ ...v, source: "rtsp" })).toThrow();
  });
  it("merges duplicate types without lowering severity", () => {
    const a = {
      type: "pain_signs",
      severity: "urgent",
      evidence: "a",
      advice: "a",
    };
    expect(
      mergeAlerts([a], [{ ...a, severity: "warning", evidence: "b" }])[0],
    ).toMatchObject({ severity: "urgent", evidence: "a\nb" });
  });
  it.each(["en", "es"])(
    "creates explicit %s demos and validates strict output",
    (lang) => {
      const v = validateCamera({ lang, clips: [clip()] });
      const { mode, ...demo } = mockCameraSummary(v);
      expect(mode).toBe("mock");
      expect(matchesSchema(demo, cameraSummarySchema)).toBe(true);
      expect(validateCameraSummary(demo, v)).toEqual(demo);
      expect(() =>
        validateCameraSummary({ ...demo, extra: true }, v),
      ).toThrow();
      expect(() =>
        validateCameraSummary({ ...demo, timeline: [] }, v),
      ).toThrow();
      expect(() =>
        validateCameraSummary(
          { ...demo, timeline: [{ ...demo.timeline[0], ts: clip(1).ts }] },
          v,
        ),
      ).toThrow();
    },
  );
});
describe("camera routes", () => {
  it("returns mock summary without credentials and rejects malformed input", async () => {
    expect(
      (
        (await (
          await worker.fetch(request("summary", input()), env)
        ).json()) as any
      ).mode,
    ).toBe("mock");
    expect(
      (await worker.fetch(request("summary", { lang: "en", clips: [] }), env))
        .status,
    ).toBe(400);
  });
  it("keeps mock provenance even with a live key", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const v = input();
    v.clips[0].mode = "mock";
    const r = await worker.fetch(request("summary", v), {
      ...env,
      MODEL_API_KEY: "test-only",
    });
    expect(((await r.json()) as any).mode).toBe("mock");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses strict Muse schema and merges deterministic alerts", async () => {
    const v = input();
    const { mode, ...result } = mockCameraSummary(v);
    result.alerts = [];
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ output_text: JSON.stringify(result) }),
      );
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request("summary", v), {
      ...env,
      MODEL_API_KEY: "test-only",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.mode).toBe("live");
    expect(body.alerts).toHaveLength(0);
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.text.format.strict).toBe(true);
    expect(sent.text.format.schema).toEqual(cameraSummarySchema);
  });
  it("rejects invalid live summary and offers explicit mock fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ output_text: "{}" })),
    );
    expect(
      (
        await worker.fetch(request("summary", input()), {
          ...env,
          MODEL_API_KEY: "test-only",
        })
      ).status,
    ).toBe(502);
    const req = new Request(
      "https://local/api/camera/summary?mock=1",
      request("summary", input()),
    );
    expect(
      (
        (await (
          await worker.fetch(req, { ...env, MODEL_API_KEY: "test-only" })
        ).json()) as any
      ).mode,
    ).toBe("mock");
  });
  it("returns a prepared 501 stream plan without opening a connection", async () => {
    const r = await worker.fetch(
      new Request("https://local/api/camera/stream", { method: "POST" }),
      env,
    );
    expect(r.status).toBe(501);
    expect(await r.json()).toMatchObject({
      status: "not_implemented",
      plan: expect.stringContaining("RTSP"),
    });
  });
});
