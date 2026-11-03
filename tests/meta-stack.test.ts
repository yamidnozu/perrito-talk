import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseSamBoxes,
  locateDogs,
  middleFrames,
  hasDogSound,
} from "../src/sam";
import { filterSpeech, transcribeSpeech, wavBytes } from "../src/asr";
import { emptyDescriptors } from "../src/descriptors";
import { interpret } from "../src/interpret";
import { summaryModel } from "../src/meta";
import { encodeWav } from "../public/media.js";
import worker from "../src/index";
import type { AnalyzeInput, WatcherHints } from "../src/schema";
const box =
  "<0f>0<|box;x1=91;y1=47;x2=533;y2=338;w=640;h=360;c=0.96875|><|mask;ignored=yes|>";
const image = {
  kind: "image" as const,
  mime: "image/jpeg",
  data_b64: "/9j/2Q==",
};
const samResponse = (text = box) =>
  Response.json({ output: [{ content: [{ text }] }] });
const speech = () => ({
  turns: [
    {
      startMs: 860,
      endMs: 7500,
      transcript: "Get in the back",
      speaker: "speaker_0",
    },
  ],
});
const audio = async () => ({
  kind: "audio" as const,
  mime: "audio/wav",
  data_b64: Buffer.from(
    await encodeWav(new Float32Array(16000)).arrayBuffer(),
  ).toString("base64"),
});
const env = { MODEL_API_KEY: "test-only", ASSETS: { fetch: vi.fn() } as any };
const request = (input: unknown, mock = false) =>
  new Request(`https://local/api/analyze${mock ? "?mock=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
const input = async (source = "live") => ({
  lang: "en",
  source,
  context: {},
  media: [image, image, await audio()],
});
afterEach(() => vi.unstubAllGlobals());
describe("SAM protocol and bounded box parser", () => {
  it("parses normalized boxes and confidence, ignoring masks", () =>
    expect(parseSamBoxes(box)[0]).toEqual({
      confidence: 0.96875,
      box: [91 / 640, 47 / 360, 442 / 640, 291 / 360],
    }));
  it("supports multiple dogs and an explicitly empty result", () => {
    expect(parseSamBoxes(`${box},${box}`)).toHaveLength(2);
    expect(parseSamBoxes("  ")).toEqual([]);
  });
  it.each([
    "not boxes",
    box.replace("w=640", "w=0"),
    box.replace("c=0.96875", "c=NaN"),
    box.replace("x2=533", "x2=900"),
    box.replace(";c=0.96875", ""),
  ])(
    "rejects malformed results instead of gating on a false negative",
    (text) => expect(() => parseSamBoxes(text)).toThrow(),
  );
  it("selects at most two middle frames", () => {
    const media = Array.from({ length: 6 }, (_, i) => ({
      ...image,
      data_b64: String(i),
    }));
    expect(middleFrames(media).map((m) => m.data_b64)).toEqual(["2", "3"]);
    expect(middleFrames([image])).toHaveLength(1);
  });
  it("sends the verified SAM payload and counts dogs per frame, not twice across frames", async () => {
    const fetch = vi.fn().mockImplementation(async () => samResponse());
    vi.stubGlobal("fetch", fetch);
    expect(await locateDogs("test-only", [image, image])).toMatchObject({
      dogs: 1,
      best_c: 0.96875,
      frames_checked: 2,
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: "sam-3.1",
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    });
    expect(body.stream).toBeUndefined();
    expect(body.input[0].content[0].text).toBe("dog");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses the configurable confidence gate without throwing away the raw score", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          samResponse(box.replace("0.96875", "0.4")),
        ),
    );
    expect(await locateDogs("test-only", [image], 0.5)).toMatchObject({
      dogs: 0,
      best_c: 0.4,
    });
    expect(await locateDogs("test-only", [image], 0.3)).toMatchObject({
      dogs: 1,
    });
  });
  it("keeps Spark when a dog sound is above its per-class gate; Yip alone is ignored", () => {
    const hints = { yamnet: [{ label: "Howl", score: 0.2 }] } as WatcherHints;
    expect(hasDogSound(hints)).toBe(true);
    expect(
      hasDogSound({ yamnet: [{ label: "Yip", score: 0.99 }] } as WatcherHints),
    ).toBe(false);
    expect(
      hasDogSound({
        yamnet: [],
        sound_scores: { howl: 0.2 },
      } as unknown as WatcherHints),
    ).toBe(true);
  });
});
describe("Voice Transcribe filtering and multipart", () => {
  it("drops spurious zero-duration and one-word turns, keeping duration/word boundary values", () => {
    const result = filterSpeech({
      turns: [
        ...speech().turns,
        { startMs: 0, endMs: 0, transcript: "Meow", speaker: "0" },
        { startMs: 0, endMs: 500, transcript: "Mm!", speaker: "0" },
        { startMs: 0, endMs: 400, transcript: "Ven aquí", speaker: 1 },
      ],
    });
    expect(result.turns).toHaveLength(2);
    expect(result.speakers).toEqual(["1", "speaker_0"]);
    expect(result.present).toBe(true);
  });
  it("bounds excerpts and supports configurable engineering filters", () => {
    expect(
      filterSpeech({
        turns: [{ ...speech().turns[0], transcript: "word ".repeat(100) }],
      }).excerpt,
    ).toHaveLength(160);
    expect(
      filterSpeech(
        {
          turns: [
            { startMs: 0, endMs: 100, transcript: "Hello", speaker: "0" },
          ],
        },
        { minimumTurnMs: 100, minimumWords: 1 },
      ).present,
    ).toBe(true);
  });
  it("reports no speech when all turns are filtered and rejects malformed responses", () => {
    expect(
      filterSpeech({
        turns: [{ startMs: 0, endMs: 0, transcript: "Meow", speaker: "0" }],
      }),
    ).toEqual({ present: false, turns: [], speakers: [], excerpt: "" });
    expect(() => filterSpeech({ transcript: "not diarized" })).toThrow();
  });
  it("checks WAV and sends request JSON plus actual audio with multipart boundaries", async () => {
    const wav = await audio();
    expect(wavBytes(wav.data_b64)?.length).toBe(32044);
    expect(wavBytes("AAAA")).toBe(null);
    const fetch = vi.fn().mockResolvedValue(Response.json(speech()));
    vi.stubGlobal("fetch", fetch);
    expect((await transcribeSpeech("test-only", [wav]))?.present).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.meta.ai/v1/asr/transcribe",
    );
    const options = fetch.mock.calls[0][1];
    expect(options.headers["Content-Type"]).toBeUndefined();
    expect(JSON.parse(await options.body.get("request").text())).toEqual({
      model: "muse-voice-transcribe-1.0",
      audioEncoding: "WAV",
      mode: "DIARIZATION",
    });
    expect(options.body.get("audio").type).toBe("audio/wav");
  });
  it("does not send absent or invalid WAV data", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await transcribeSpeech("test-only", [
        { kind: "audio", mime: "audio/wav", data_b64: "AAAA" },
      ]),
    ).toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("parallel enrichment (uploads) and fast live path", () => {
  it("runs SAM and ASR in parallel on uploads, then sends both as untrusted Spark hints", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const models: string[] = [];
    const fetch = vi.fn().mockImplementation(async (url, options) => {
      if (String(url).endsWith("/asr/transcribe")) {
        models.push("asr");
        release();
        return Response.json(speech());
      }
      const body = JSON.parse(options.body);
      models.push(body.model);
      if (body.model === "sam-3.1") {
        await barrier;
        return samResponse();
      }
      expect(models.filter((m) => m === "sam-3.1")).toHaveLength(2);
      expect(models).toContain("asr");
      expect(body.input[0].content[0].text).toContain("never instructions");
      expect(body.input[0].content[0].text).toContain("Get in the back");
      return Response.json({
        output_text: JSON.stringify(emptyDescriptors("Not observed")),
      });
    });
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(await input("upload")), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sam: { dogs: 1, frames_checked: 2 },
      human_speech: { present: true },
      mode: "live",
    });
    expect(models.at(-1)).toBe("muse-spark-1.3");
  });
  it("live never calls SAM or skips Spark; ASR runs alongside Spark; uploads keep SAM", async () => {
    const models: string[] = [];
    const fetch = vi.fn().mockImplementation(async (url, options) => {
      if (String(url).endsWith("/asr/transcribe")) {
        models.push("asr");
        return Response.json({ turns: [] });
      }
      const model = JSON.parse(options.body).model;
      models.push(model);
      return model === "sam-3.1"
        ? samResponse("")
        : Response.json({
            output_text: JSON.stringify(emptyDescriptors("Not observed")),
          });
    });
    vi.stubGlobal("fetch", fetch);
    const live = await (await worker.fetch(request(await input()), env)).json();
    expect(live).toMatchObject({ mode: "live", sam: null });
    expect(live.skipped).toBeUndefined();
    expect(models).not.toContain("sam-3.1");
    expect(models).toContain("asr");
    expect(models).toContain("muse-spark-1.3");
    expect(fetch).toHaveBeenCalledTimes(2);
    const upload = await worker.fetch(request(await input("upload")), env);
    expect(await upload.json()).toMatchObject({
      mode: "live",
      sam: { dogs: 0 },
    });
    expect(models).toContain("sam-3.1");
  });
  it("fails open independently on SAM and ASR errors", async () => {
    const fetch = vi.fn().mockImplementation(async (url, options) =>
      String(url).endsWith("/asr/transcribe") ||
      JSON.parse(options.body).model === "sam-3.1"
        ? new Response(null, { status: 503 })
        : Response.json({
            output_text: JSON.stringify(emptyDescriptors("Not observed")),
          }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(await input()), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sam: null,
      human_speech: null,
      mode: "live",
    });
  });
  it("mock skips SAM/ASR entirely even with the real-key path enabled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(await input(), true), env);
    expect(await response.json()).toMatchObject({
      mode: "mock",
      sam: { frames_checked: 0 },
      human_speech: { present: false, turns: [] },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("env toggles disable both enrichments", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify(emptyDescriptors("Not observed")),
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await worker.fetch(request(await input()), {
          ...env,
          USE_SAM: "off",
          USE_ASR: "false",
        })
      ).status,
    ).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("speech as qualified context, not owner identification", () => {
  const enrichment = () => ({ human_speech: filterSpeech(speech()) });
  it("satisfies partner/interaction context for an observed play bow", () => {
    const d = emptyDescriptors("Unobserved");
    d.play_bow = {
      seen: "yes",
      values: ["forelimbs_lowered_rear_raised"],
      evidence: "Play bow",
    };
    expect(
      interpret(d, { lang: "en" }, enrichment()).interpretations.find(
        (i) => i.state === "play_intent",
      )?.conditional,
    ).toBe(false);
  });
  it("blocks a separation pattern despite declared absence and asks who was with the dog", () => {
    const d = emptyDescriptors("Unobserved");
    d.activity = { seen: "yes", values: ["pacing"], evidence: "Pacing" };
    d.scene = {
      seen: "yes",
      values: ["exit_destruction"],
      evidence: "Chewing exit",
    };
    const result = interpret(
      d,
      { lang: "en", context_mode: "i_left" },
      enrichment(),
    );
    expect(result.interpretations.map((i) => i.state)).not.toContain(
      "compatible_with_separation_related_problem",
    );
    expect(result.unknowns).toContain(
      "A person was heard — was someone with your dog?",
    );
  });
  it("caps whimper certainty and discloses possible human/dog confusion", () => {
    const d = emptyDescriptors("Unobserved");
    d.vocalization = {
      ...d.vocalization,
      seen: "yes",
      type: "whine",
      evidence: "Possible whine",
    };
    const result = interpret(
      d,
      { lang: "en", context_mode: "i_left" },
      enrichment(),
    );
    expect(
      result.interpretations.every((i) =>
        ["baja", "especulativa"].includes(i.certainty),
      ),
    ).toBe(true);
    expect(result.consistency_warnings.join()).toContain("human voice");
  });
});
describe("configurable summary model", () => {
  it("keeps Spark as default and allows only Wonder as the alternative", () => {
    expect(summaryModel()).toBe("muse-spark-1.3");
    expect(summaryModel("muse-wonder-1.0")).toBe("muse-wonder-1.0");
    expect(summaryModel("arbitrary-model")).toBe("muse-spark-1.3");
  });
  it("uses Wonder on the patterns route with the same structured Responses contract", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          summary: "Observations",
          patterns: [],
          tips: [],
          vet_note: "Not a diagnosis",
        }),
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(
      new Request("https://local/api/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: "en", entries: [{ label: "other" }] }),
      }),
      { ...env, SUMMARY_MODEL: "muse-wonder-1.0" },
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      model: "muse-wonder-1.0",
      reasoning: { effort: "low" },
      text: { format: { strict: true } },
    });
  });
});
