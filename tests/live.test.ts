import { describe, it, expect } from "vitest";
import {
  frameDifference,
  rms,
  shouldAnalyze,
  reserveAnalysis,
  newAlerts,
  MOTION_THRESHOLD,
  RMS_THRESHOLD,
} from "../public/live-logic.js";
import { validateAnalyze } from "../src/schema";
import { readingPrompt } from "../src/prompts";

describe("live activity gating", () => {
  it("skips only when both motion and audio are quiet", () => {
    expect(shouldAnalyze(0, 0)).toBe(false);
    expect(shouldAnalyze(MOTION_THRESHOLD, 0)).toBe(true);
    expect(shouldAnalyze(0, RMS_THRESHOLD)).toBe(true);
    expect(shouldAnalyze(MOTION_THRESHOLD / 2, RMS_THRESHOLD / 2)).toBe(false);
  });
  it("measures normalized RGB difference, ignores alpha and keeps first frame", () => {
    expect(frameDifference(null, new Uint8Array([0, 0, 0, 255]))).toBe(1);
    expect(
      frameDifference(
        new Uint8Array([0, 0, 0, 0]),
        new Uint8Array([0, 0, 0, 255]),
      ),
    ).toBe(0);
    expect(
      frameDifference(
        new Uint8Array([0, 0, 0, 255]),
        new Uint8Array([255, 255, 255, 255]),
      ),
    ).toBe(1);
    expect(rms(new Float32Array([-0.5, 0.5]))).toBe(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });
});
describe("session reservations and notifications", () => {
  it("reserves before requests, drops overlapping work and counts failed attempts", () => {
    const s = { used: 0, max: 2, inFlight: false };
    expect(reserveAnalysis(s)).toBe(true);
    expect(reserveAnalysis(s)).toBe(false);
    expect(s.used).toBe(1);
    s.inFlight = false;
    expect(reserveAnalysis(s)).toBe(true);
    s.inFlight = false;
    expect(reserveAnalysis(s)).toBe(false);
    expect(s.used).toBe(2);
  });
  it("notifies once per type/severity, permits escalation and resets per session", () => {
    const seen = new Map();
    const warning = { type: "pain_signs", severity: "warning" };
    expect(newAlerts([warning, warning], seen)).toEqual([warning]);
    expect(newAlerts([{ ...warning, severity: "info" }], seen)).toEqual([]);
    const urgent = { ...warning, severity: "urgent" };
    expect(newAlerts([urgent], seen)).toEqual([urgent]);
    expect(newAlerts([warning], seen)).toEqual([]);
    expect(newAlerts([warning], new Map())).toEqual([warning]);
  });
});
it("accepts live source and describes phone/PC evidence without replacing audio instructions", () => {
  expect(
    validateAnalyze({
      source: "live",
      lang: "en",
      context: {},
      media: [{ kind: "video", mime: "video/mp4", data_b64: "AAAA" }],
    }).source,
  ).toBe("live");
  const prompt = readingPrompt("es", {}, "live");
  expect(prompt).toContain("live phone/PC camera view");
  expect(prompt).toContain("listen to it");
  expect(prompt).not.toContain("fixed wide-angle security camera");
});
