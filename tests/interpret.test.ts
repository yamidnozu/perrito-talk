import { describe, it, expect } from "vitest";
import evidence, { citationUrl } from "../src/evidence";
import clientEvidence from "../public/evidence.json";
import { interpret } from "../src/interpret";
import { emptyDescriptors, descriptorSchema } from "../src/descriptors";
import { matchesSchema } from "../src/schema";
const input = (mode = "at_home") => ({
  lang: "en" as const,
  context_mode: mode as "at_home" | "i_left",
});
const descriptors = () => emptyDescriptors("Unobserved");
describe("single evidence source and links", () => {
  it("imports the same JSON client and server without a generated copy", () =>
    expect(evidence).toEqual(clientEvidence));
  it("links DOI including parentheses intact", () =>
    expect(citationUrl("C18")).toBe(
      "https://doi.org/10.1016/S0168-1591(97)00145-7",
    ));
  it("links PMID", () =>
    expect(citationUrl("C21")).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/23045798/",
    ));
  it("falls back to the source URL", () =>
    expect(citationUrl("C34")).toContain("https://www.aaha.org/"));
  it("does not invent missing URLs", () =>
    expect(citationUrl("missing")).toBe(null));
});
describe("descriptors → cited evidence interpretations", () => {
  it("schema accepts descriptors only and rejects emotion/confidence fields", () => {
    const d = descriptors();
    expect(matchesSchema(d, descriptorSchema)).toBe(true);
    expect(matchesSchema({ ...d, emotion: "happy" }, descriptorSchema)).toBe(
      false,
    );
    expect(
      matchesSchema(
        { ...d, vocalization: { ...d.vocalization, count: 1.5 } },
        descriptorSchema,
      ),
    ).toBe(false);
  });
  it("does not assign sadness or generate a dog line from a howl", () => {
    const d = descriptors();
    d.vocalization = {
      ...d.vocalization,
      seen: "yes",
      type: "howl",
      count: 1,
      evidence: "Howled",
    };
    const r = interpret(d, input());
    expect(r.certainty).toBe("especulativa");
    expect(r.dog_line).toBe("");
    expect(r.interpretations[0].citations).toEqual(["C42"]);
  });
  it("keeps at least two C08 alternatives for a single ambiguous growl", () => {
    const d = descriptors();
    d.vocalization = {
      ...d.vocalization,
      seen: "yes",
      type: "growl",
      count: 1,
      evidence: "Growled",
    };
    const r = interpret(d, input());
    expect(r.interpretations.map((i) => i.state)).toEqual(
      expect.arrayContaining(["threat_or_guarding", "play"]),
    );
    expect(
      r.interpretations.every(
        (i) => i.certainty === "baja" && i.citations.includes("C08"),
      ),
    ).toBe(true);
    expect(r.dog_line).toMatch(/\?$/);
  });
  it("keeps greeting and appeasement alternatives and asks about interaction", () => {
    const d = descriptors();
    d.mouth = { seen: "yes", values: ["lip_lick"], evidence: "Licked lips" };
    d.gaze = { seen: "yes", values: ["averted"], evidence: "Looked away" };
    const r = interpret(d, input());
    expect(r.interpretations.map((i) => i.state)).toContain("greeting");
    expect(r.interpretations.map((i) => i.state)).toContain(
      "appeasement_mild_conflict",
    );
    expect(r.unknowns.join()).toContain("interacting");
  });
  it("never equates a wagging tail with happiness", () => {
    const d = descriptors();
    d.tail = { seen: "yes", values: ["wagging"], evidence: "Tail moving" };
    expect(interpret(d, input()).interpretations.map((i) => i.state)).toEqual([
      "arousal_not_valence",
    ]);
  });
  it("requires social context for play bow and caps unvalidated visual detection at moderate", () => {
    const d = descriptors();
    d.play_bow = {
      seen: "yes",
      values: ["forelimbs_lowered_rear_raised"],
      evidence: "Forelegs low, rear raised",
    };
    expect(interpret(d, input()).interpretations[0].conditional).toBe(true);
    d.interaction = {
      seen: "yes",
      values: ["person", "interacting"],
      evidence: "Person interacting",
    };
    const r = interpret(d, input());
    expect(
      r.interpretations.find((i) => i.state === "play_intent"),
    ).toMatchObject({
      conditional: false,
      certainty: "moderada",
      citations: expect.arrayContaining(["C14"]),
    });
  });
  it("never accepts an absolute pitch classification without this dog's baseline", () => {
    const d = descriptors();
    d.vocalization = {
      ...d.vocalization,
      seen: "yes",
      type: "bark",
      pitch_relative: "lower",
      harshness: "harsh",
      repetition: "rapid",
    };
    expect(
      interpret(d, input()).interpretations.map((i) => i.state),
    ).not.toContain("alert_disturbance");
  });
  it("requires both the evidence min_signs and declared absence for separation", () => {
    const d = descriptors();
    d.activity = { seen: "yes", values: ["pacing"], evidence: "Pacing" };
    expect(
      interpret(d, input("i_left")).interpretations.map((i) => i.state),
    ).not.toContain("compatible_with_separation_related_problem");
    d.scene = {
      seen: "yes",
      values: ["exit_destruction"],
      evidence: "Chewing at exit",
    };
    expect(
      interpret(d, input()).interpretations.map((i) => i.state),
    ).not.toContain("compatible_with_separation_related_problem");
    expect(
      interpret(d, input("i_left")).interpretations.find(
        (i) => i.state === "compatible_with_separation_related_problem",
      ),
    ).toMatchObject({
      certainty: "moderada",
      conditional: false,
      citations: ["C35", "C37", "C45"],
    });
  });
  it("one nonspecific stress sign does not satisfy the combination", () => {
    const d = descriptors();
    d.mouth = { seen: "yes", values: ["yawn"], evidence: "Yawned" };
    d.interaction = {
      seen: "yes",
      values: ["person", "interacting"],
      evidence: "Person interacting",
    };
    expect(
      interpret(d, input()).interpretations.map((i) => i.state),
    ).not.toContain("moderate_acute_stress");
    d.body_shake = {
      seen: "yes",
      values: ["shake_off"],
      evidence: "Shook body",
    };
    expect(interpret(d, input()).interpretations.map((i) => i.state)).toContain(
      "moderate_acute_stress",
    );
  });
  it("caps whimper quality at low and warns of human confusion", () => {
    const d = descriptors();
    d.vocalization = {
      ...d.vocalization,
      seen: "yes",
      type: "whine",
      evidence: "Possible whine",
    };
    const r = interpret(d, input("i_left"));
    expect(r.certainty).toBe("baja");
    expect(r.consistency_warnings.join()).toContain("human whimper");
  });
  it.each(["en", "es"] as const)(
    "pain routes to C34 with exact %s banner and neutral dog line",
    (lang) => {
      const d = descriptors();
      d.pain_signs = {
        seen: "yes",
        values: ["limp"],
        evidence: lang === "es" ? "Cojera" : "Limp",
      };
      const r = interpret(d, { lang });
      expect(r.vet_alert.flag).toBe(true);
      expect(r.vet_alert.citations).toEqual(["C34"]);
      expect(r.vet_alert.reasons[0]).toBe(
        lang === "es"
          ? "Esto no es un diagnóstico. Si es nuevo o persiste, consulta a tu veterinario; un video corto le ayuda"
          : "This is not a diagnosis. If it is new or persists, consult your veterinarian; a short video helps them",
      );
      expect(r.dog_line).toContain(
        lang === "es" ? "veterinario" : "veterinarian",
      );
    },
  );
  it("very low posture after sudden stimulus raises the fixed vet banner", () => {
    const d = descriptors();
    d.posture = {
      seen: "yes",
      values: ["very_low"],
      evidence: "Very low posture",
    };
    d.scene = {
      seen: "yes",
      values: ["sudden_stimulus"],
      evidence: "Sudden noise",
    };
    expect(interpret(d, input()).vet_alert.flag).toBe(true);
  });
});

describe("cached reading localization without another model call", () => {
  it("renders the same observable enum values in the newly selected language", async () => {
    const { observedTexts } = await import("../public/evidence-utils.js");
    const d = descriptors();
    d.pain_signs = {
      seen: "yes",
      values: ["limp"],
      evidence: "Limping on the right",
    };
    const r = interpret(d, input());
    expect(observedTexts(r, "es")).toEqual(["Cojera"]);
    expect(observedTexts(r, "en")).toEqual(["Limping on the right"]);
  });
  it("localizes a neutral vet line and required-context questions", async () => {
    const { dogLineFor, contextQuestions } =
      await import("../public/evidence-utils.js");
    expect(dogLineFor({ vet_alert: { flag: true } }, "es")).toContain(
      "veterinario",
    );
    expect(contextQuestions(["owner absent"], "es")).toEqual([
      "¿Saliste y quedó separado de ti?",
    ]);
  });
  it("never creates a dog line for a speculative interpretation", async () => {
    const { dogLineFor } = await import("../public/evidence-utils.js");
    expect(
      dogLineFor(
        {
          interpretations: [
            { state: "unspecified", certainty: "especulativa" },
          ],
        },
        "es",
      ),
    ).toBe("");
  });
});

describe("C34 pain requires a movement/posture sign", () => {
  it.each(["sleeping", "still", "yawning", "howling"])(
    "keeps squint during %s as observation without a vet or pain interpretation",
    (caseName) => {
      const d = descriptors();
      d.pain_signs = {
        seen: "yes",
        values: ["squinted_eyes"],
        evidence: "Eyes partly closed",
      };
      d.activity = { seen: "yes", values: ["still"], evidence: caseName };
      if (caseName === "yawning")
        d.mouth = {
          seen: "yes",
          values: ["yawn", "jaw_drop"],
          evidence: "Yawning",
        };
      if (caseName === "howling") {
        d.vocalization = {
          ...d.vocalization,
          seen: "yes",
          type: "howl",
          evidence: "Howling",
        };
        d.mouth = {
          seen: "yes",
          values: ["jaw_drop"],
          evidence: "Mouth open during howl",
        };
      }
      const r = interpret(d, input());
      expect(r.observations.pain_signs.values).toContain("squinted_eyes");
      expect(r.vet_alert.flag).toBe(false);
      expect(r.interpretations.every((i) => !i.state.includes("pain"))).toBe(
        true,
      );
    },
  );
  it.each(["limp", "stiffness", "reluctance_to_move", "lick_area"])(
    "squint plus %s retains the C34 flag",
    (sign) => {
      const d = descriptors();
      d.pain_signs = {
        seen: "yes",
        values: ["squinted_eyes", sign],
        evidence: `Eyes partly closed; ${sign}`,
      };
      expect(interpret(d, input()).vet_alert.flag).toBe(true);
    },
  );
});
