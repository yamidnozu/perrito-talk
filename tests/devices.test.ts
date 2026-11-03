import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { audioConstraints, videoConstraints } from "../public/devices.js";

describe("device constraints", () => {
  it("uses exact deviceId and 720p for a picked camera", () => {
    expect(videoConstraints("abc")).toEqual({
      deviceId: { exact: "abc" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
  });
  it("maps mobile quick options to facingMode", () => {
    expect(videoConstraints("facing:environment").facingMode).toEqual({
      ideal: "environment",
    });
    expect(videoConstraints("", "environment").facingMode).toBe("environment");
  });
  it("keeps the microphone raw, with or without a device", () => {
    const raw = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    expect(audioConstraints("")).toEqual(raw);
    expect(audioConstraints("mic1")).toEqual({
      ...raw,
      deviceId: { exact: "mic1" },
    });
  });
});
