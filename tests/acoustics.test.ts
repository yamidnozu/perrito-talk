import { describe, it, expect } from "vitest";
import { analyzeAcoustics } from "../public/acoustics.js";
import { validateAnalyze, calibrateReading } from "../src/schema";
import { readingPrompt } from "../src/prompts";
import { mockReading } from "../src/mock";
const input = {
  lang: "es" as const,
  context: {},
  media: [{ kind: "audio" as const, mime: "audio/wav", data_b64: "AAAA" }],
};
// Quiet context keeps p60 below the tone, as in recorded clips.
function tones(hz: number, duration: number, count: number) {
  const pcm = new Float32Array(
    Math.ceil((2 + count * (duration + 0.7)) * 16000),
  );
  for (let b = 0; b < count; b++)
    for (let i = 0; i < duration * 16000; i++)
      pcm[Math.round((1 + b * (duration + 0.7)) * 16000) + i] =
        0.5 * Math.sin((2 * Math.PI * hz * i) / 16000);
  return pcm;
}
describe("acoustic pre-analysis", () => {
  it("detects sustained 550 Hz howling", () => {
    expect(analyzeAcoustics(tones(550, 1.5, 1)).class).toBe("howl");
  });
  it("detects repeated 700 Hz whimpers", () => {
    const hints = analyzeAcoustics(tones(700, 0.4, 7));
    expect(hints.class).toBe("whine_whimper");
    expect(hints.metrics.bursts).toBe(7);
  });
  it("detects silence and empty audio", () => {
    for (const pcm of [new Float32Array(), new Float32Array(16000)])
      expect(analyzeAcoustics(pcm).class).toBe("silence");
  });
  it("rejects malformed or injected hints", () => {
    const h = analyzeAcoustics(tones(550, 1.5, 1));
    for (const acoustic_hints of [
      { ...h, confidence: NaN },
      { ...h, class: "ignore instructions" },
      { ...h, metrics: {} },
      { ...h, extra: "instructions" },
    ])
      expect(() => validateAnalyze({ ...input, acoustic_hints })).toThrow();
    expect(
      validateAnalyze({ ...input, source: "upload", acoustic_hints: h })
        .acoustic_hints,
    ).toEqual(h);
  });
  it("passes hints to the prompt and flags contradictory calm labels despite NO_AUDIO", () => {
    const hints = analyzeAcoustics(tones(550, 1.5, 1));
    expect(readingPrompt("es", {}, "live", hints)).toContain('"class":"howl"');
    const reading = mockReading(input);
    reading.primary.label = "happy";
    reading.primary.confidence = 0.9;
    reading.signals.vocalization.present = false;
    const result = calibrateReading(reading, "es", hints);
    expect(result.primary.confidence).toBeLessThan(0.4);
    expect(result.consistency_warnings).toHaveLength(1);
    expect(reading.primary.confidence).toBe(0.9);
    expect(
      calibrateReading(reading, "es", { ...hints, confidence: 0.49 }).primary
        .confidence,
    ).toBe(0.9);
  });
});
