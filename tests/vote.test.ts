import { describe, it, expect, vi, afterEach } from "vitest";
import { vote, deepDescriptors } from "../src/meta";
import { emptyDescriptors } from "../src/descriptors";
import { interpret } from "../src/interpret";
import worker from "../src/index";
const empty = () => emptyDescriptors("Not observed");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("three-way per-field majority without a judge", () => {
  it("drops a singleton squinted-eye report and keeps a two-vote limp", () => {
    const ds = [empty(), empty(), empty()];
    ds[0].pain_signs = {
      seen: "yes",
      values: ["squinted_eyes", "limp"],
      evidence: "A unique squint and limp",
    };
    ds[1].pain_signs = { seen: "yes", values: ["limp"], evidence: "Limp" };
    const result = vote(ds);
    expect(result.pain_signs.values).toEqual(["limp"]);
    expect(result.pain_signs.evidence).not.toContain("squint");
    expect(interpret(result, { lang: "en" }).vet_alert.flag).toBe(true);
  });
  it("never promotes one play bow or conflicting non-shared values", () => {
    const ds = [empty(), empty(), empty()];
    ds[0].play_bow = {
      seen: "yes",
      values: ["forelimbs_lowered_rear_raised"],
      evidence: "Bow",
    };
    ds[0].posture = { seen: "yes", values: ["lowered"], evidence: "Low" };
    ds[1].posture = { seen: "yes", values: ["neutral"], evidence: "Neutral" };
    expect(vote(ds).play_bow.seen).toBe("unclear");
    expect(vote(ds).posture.values).toEqual([]);
    expect(vote(ds).posture.seen).toBe("unclear");
  });
  it("uses a vocal majority and abstains on three distinct types", () => {
    const ds = [empty(), empty(), empty()];
    for (const [i, type] of ["howl", "howl", "bark"].entries())
      ds[i].vocalization = {
        ...ds[i].vocalization,
        seen: "yes",
        type,
        count: i === 2 ? 3 : 1,
      };
    expect(vote(ds).vocalization).toMatchObject({
      type: "howl",
      seen: "yes",
      count: 1,
    });
    ds[1].vocalization.type = "whine";
    expect(vote(ds).vocalization.type).toBe("unclear");
  });
  it("does not invent certainty about counts or notes without two matching observations", () => {
    const ds = [empty(), empty(), empty()];
    ds.forEach((d, i) => {
      d.vocalization = {
        ...d.vocalization,
        seen: "yes",
        type: "bark",
        count: i + 1,
      };
      d.scene_notes = { seen: "yes", evidence: String(i) };
    });
    expect(vote(ds).vocalization.count).toBe(0);
    expect(vote(ds).scene_notes.seen).toBe("unclear");
  });
  it("preserves majority absence, localizes evidence and never mutates inputs", () => {
    const ds = [empty(), empty(), empty()];
    ds[0].tail = ds[1].tail = { seen: "no", values: [], evidence: "No tail" };
    ds[0].activity = ds[1].activity = {
      seen: "yes",
      values: ["still"],
      evidence: "Still",
    };
    const before = structuredClone(ds);
    expect(vote(ds, "es").activity.evidence).toBe("Quieto");
    expect(vote(ds).tail.seen).toBe("no");
    expect(ds).toEqual(before);
    expect(() => vote([])).toThrow("three");
  });
});
describe("optional parallel descriptor calls", () => {
  it("starts all three before awaiting, uses low effort and thirty-second timeouts, and retries once", async () => {
    const timers = vi.spyOn(AbortSignal, "timeout");
    let active = 0,
      calls = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, options) => {
        calls++;
        active++;
        expect(JSON.parse(options.body).reasoning.effort).toBe("low");
        if (active >= 3) release();
        await barrier;
        if (calls === 3 && active === 3) {
          active--;
          return new Response(null, { status: 503 });
        }
        return Response.json({ output_text: JSON.stringify(empty()) });
      }),
    );
    const result = await deepDescriptors(
      "test-only",
      "Descriptors only",
      [],
      "en",
    );
    expect(result.calls).toBe(4);
    expect(timers.mock.calls.every(([ms]) => ms === 30000)).toBe(true);
    expect(result.descriptors.pain_signs.values).toEqual([]);
  });
  it("stops a failed branch after one retry", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      deepDescriptors("test-only", "Observe", [], "en"),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(6);
  });
  it("supports deep mock and forbids deep mode in live sessions", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const body = {
      lang: "es",
      deep: true,
      context: {},
      media: [{ kind: "image", mime: "image/jpeg", data_b64: "AAAA" }],
    };
    const request = (value: unknown) =>
      new Request("https://local/api/analyze?mock=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    const env = {
      ASSETS: { fetch: vi.fn() } as any,
      MODEL_API_KEY: "test-only",
    };
    expect(await (await worker.fetch(request(body), env)).json()).toMatchObject(
      { mode: "mock", analysis_mode: "deep", descriptor_calls: 0 },
    );
    expect(
      (await worker.fetch(request({ ...body, source: "live" }), env)).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("deep API performs exactly three Spark descriptions and one consensus interpretation", async () => {
  const samples = [empty(), empty(), empty()];
  samples[0].pain_signs = {
    seen: "yes",
    values: ["squinted_eyes"],
    evidence: "Eyes closed",
  };
  let index = 0;
  const fetch = vi.fn().mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.reasoning.effort).toBe("low");
    return Response.json({ output_text: JSON.stringify(samples[index++]) });
  });
  vi.stubGlobal("fetch", fetch);
  const response = await worker.fetch(
    new Request("https://local/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "en",
        source: "upload",
        deep: true,
        context: {},
        media: [{ kind: "image", mime: "image/jpeg", data_b64: "AAAA" }],
      }),
    }),
    {
      MODEL_API_KEY: "test-only",
      USE_SAM: "off",
      USE_ASR: "off",
      ASSETS: { fetch: vi.fn() } as any,
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    analysis_mode: "deep",
    descriptor_calls: 3,
    vet_alert: { flag: false },
    observations: { pain_signs: { values: [] } },
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});
