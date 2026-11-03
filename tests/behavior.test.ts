import { describe, expect, it } from "vitest";
import { behaviorSummary } from "../public/evidence-utils.js";
const d = (values: string[]) => ({ seen: "yes", values, evidence: "x" });
describe("behaviorSummary", () => {
  it("describes observable actions and sound, never an emotion", () => {
    const r = {
      observations: {
        vocalization: { seen: "yes", type: "bark" },
        behavior: d(["lying_down", "eyes_closed"]),
        tail: d(["wagging"]),
        interaction: d(["person"]),
      },
    };
    expect(behaviorSummary(r, "es")).toBe(
      "Ladra · Tumbado · Ojos cerrados · Mueve la cola",
    );
    expect(behaviorSummary(r, "en")).not.toMatch(/happy|sad|tired|hungry/i);
  });
  it("falls back to activity and ignores unseen descriptors", () => {
    const r = {
      observations: {
        vocalization: { seen: "unclear", type: "whine" },
        behavior: { seen: "unclear", values: ["eating"], evidence: "" },
        activity: d(["still"]),
      },
    };
    expect(behaviorSummary(r, "es")).toBe("Quieto");
    expect(behaviorSummary({}, "es")).toBe("");
  });
});
