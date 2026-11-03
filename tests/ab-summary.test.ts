import { describe, it, expect } from "vitest";
import {
  estimateCost,
  auditSummary,
  loadReadings,
} from "../scripts/ab-summary.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import evidence from "../public/evidence.json";
describe("A/B metrics are lexical checks, not model accuracy", () => {
  it("estimates Standard token costs including discounted cached input", () => {
    const usage = {
      input_tokens: 1000000,
      output_tokens: 500000,
      input_tokens_details: { cached_tokens: 100000 },
    };
    expect(estimateCost("muse-spark-1.3", usage)).toBeCloseTo(3.265);
    expect(estimateCost("muse-wonder-1.0", usage)).toBeCloseTo(13.62);
    expect(estimateCost("muse-spark-1.3", {})).toBe(null);
  });
  it("counts evidence forbidden phrases, percentage claims and no-audio wording", () => {
    const metrics = auditSummary(
      "tail wag = happy. 82% certain. No audio. Model confidence in the sound: 20%.",
      evidence.forbidden_claims,
    );
    expect(metrics.forbidden_claims_phrase_count).toBe(1);
    expect(metrics.suspected_forbidden_assertions).toBe(1);
    expect(metrics.uncalibrated_percent_count).toBe(1);
    expect(metrics.claims_no_audio).toBe(true);
  });
  it("does not flag a negated suspected assertion as an affirmative claim", () =>
    expect(
      auditSummary(
        "Never assume a growl means aggression.",
        evidence.forbidden_claims,
      ).suspected_forbidden_assertions,
    ).toBe(0));
  it("loads exactly ten readings without copying media or inventing timestamps", async () => {
    const directory = await mkdtemp(join(tmpdir(), "perrito-ab-"));
    try {
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          writeFile(
            join(directory, `${String(index + 1).padStart(2, "0")}-clip.json`),
            JSON.stringify({
              primary: { label: "other" },
              media: [{ data_b64: "not-forwarded" }],
            }),
          ),
        ),
      );
      const readings = await loadReadings(directory);
      expect(readings).toHaveLength(10);
      expect(readings[0].ts).toBe(null);
      expect(JSON.stringify(readings)).not.toContain("not-forwarded");
      await rm(join(directory, "01-clip.json"));
      await expect(loadReadings(directory)).rejects.toThrow("ten");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
