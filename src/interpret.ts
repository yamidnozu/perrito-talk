import type { SamObservation } from "./sam";
import type { HumanSpeech } from "./asr";
import evidence from "./evidence";
import type { AnalyzeInput } from "./schema";
import type { Descriptors } from "./descriptors";
import { PARAMETERS } from "../public/watcher/evidence-config.js";
export type Certainty = "alta" | "moderada" | "baja" | "especulativa";
const levels: Certainty[] = ["especulativa", "baja", "moderada", "alta"];
const cap = (...values: Certainty[]) =>
  levels[Math.min(...values.map((v) => levels.indexOf(v)))];
import {
  stateLabel,
  VET_TEXT,
  contextQuestions,
  dogLineFor,
} from "../public/evidence-utils.js";
export { VET_TEXT };
export { stateLabel };

/** Pure descriptor → evidence signal → evidence combination mapping.
 * No model-written emotion or user instruction enters the decision logic.
 */
export function interpret(
  d: Descriptors,
  input: Pick<AnalyzeInput, "lang" | "context_mode" | "watcher" | "baseline">,
  enrichment: {
    sam?: SamObservation | null;
    human_speech?: HumanSpeech | null;
  } = {},
) {
  const es = input.lang === "es",
    mode = input.context_mode || "at_home";
  const has = (key: keyof Descriptors, value: string) => {
    const part = d[key];
    return (
      part.seen === "yes" && "values" in part && part.values.includes(value)
    );
  };
  const v = d.vocalization,
    audible = v.seen === "yes" && !["none", "unclear"].includes(v.type);
  const humanPresent = enrichment.human_speech?.present === true;
  const partner =
    humanPresent ||
    has("interaction", "person") ||
    has("interaction", "other_dog");
  const social =
    humanPresent ||
    (partner && has("interaction", "interacting")) ||
    has("scene", "handling");
  const signs = new Set<string>();
  const add = (id: string, condition: boolean) => {
    if (condition) signs.add(id);
  };
  // Direct encodings of evidence.json observable_features; no absolute pitch cutoff.
  add("howl", audible && v.type === "howl");
  add("growl_bout", audible && v.type === "growl" && v.count > 1);
  add(
    "bark_low_harsh_rapid",
    audible &&
      v.type === "bark" &&
      !!input.baseline &&
      v.pitch_relative === "lower" &&
      v.harshness === "harsh" &&
      v.repetition === "rapid",
  );
  add(
    "bark_high_tonal_modulated",
    audible &&
      v.type === "bark" &&
      !!input.baseline &&
      v.pitch_relative === "higher" &&
      v.harshness === "tonal" &&
      v.modulation === "modulated",
  );
  add(
    "bark_single_long_intervals",
    audible && v.type === "bark" && v.repetition === "long_intervals",
  );
  add(
    "bark_high_long_intervals",
    audible &&
      v.type === "bark" &&
      !!input.baseline &&
      v.pitch_relative === "higher" &&
      v.repetition === "long_intervals",
  );
  add(
    "bark_high_tonal",
    audible &&
      v.type === "bark" &&
      !!input.baseline &&
      v.pitch_relative === "higher" &&
      v.harshness === "tonal",
  );
  add(
    "whine_without_bark_when_alone",
    audible && v.type === "whine" && mode === "i_left" && !humanPresent,
  );
  add(
    "bark_plus_door_scratch_when_alone",
    audible &&
      v.type === "bark" &&
      has("scene", "exit_scratching") &&
      mode === "i_left" &&
      !humanPresent,
  );
  // TODO(evidence): nonlinear whines need a validated NLP detector; HNR alone is insufficient.
  // Nonlinear whines are experimental and deliberately not inferred from HNR alone (C39).
  add("vocalize_on_touch", audible && has("interaction", "vocalize_on_touch"));
  add("play_bow", has("play_bow", "forelimbs_lowered_rear_raised"));
  add("tail_wag_any", has("tail", "wagging"));
  add(
    "very_low_posture_after_sudden_stimulus",
    has("posture", "very_low") && has("scene", "sudden_stimulus"),
  );
  add("lip_lick_look_away", has("mouth", "lip_lick") && has("gaze", "averted"));
  add(
    "whale_eye_ears_back_gaze_avert",
    has("gaze", "whale_eye") &&
      has("ears", "pinned_back") &&
      has("gaze", "averted"),
  );
  add("ears_adductor", has("ears", "adductor"));
  add(
    "ears_flattener_blink_nose_lick",
    has("ears", "flattener") &&
      has("gaze", "blink") &&
      has("mouth", "nose_lick") &&
      has("mouth", "lips_part") &&
      has("mouth", "jaw_drop"),
  );
  add(
    "pain_behaviour_signs",
    (d.pain_signs.seen === "yes" &&
      d.pain_signs.values.some((value) =>
        [
          "limp",
          "stiffness",
          "reluctance_to_move",
          "lick_area",
          "hunched",
        ].includes(value),
      )) ||
      has("posture", "hunched"),
  );
  const contextSatisfied = (text: string): boolean => {
    if (/owner.absent|alone|separat/.test(text))
      return mode === "i_left" && !humanPresent;
    if (/partner/.test(text))
      return humanPresent || (partner && has("interaction", "interacting"));
    if (
      /interaction|human interacting|social or handling|social\/handling/.test(
        text,
      )
    )
      return social;
    if (/external stimulus/.test(text))
      return has("scene", "external_stimulus");
    if (/sudden/.test(text)) return has("scene", "sudden_stimulus");
    if (/reward.*withheld/.test(text)) return has("scene", "reward_withheld");
    if (/reward/.test(text)) return has("scene", "reward_visible");
    if (/stressful/.test(text))
      return has("scene", "handling") || has("scene", "sudden_stimulus");
    // Deviation/persistence cannot be verified in a short clip; pain still routes to vet.
    return false;
  };
  const interpretations: {
    state: string;
    label: string;
    certainty: Certainty;
    citations: string[];
    required_context: string[];
    conditional: boolean;
  }[] = [];
  const missing = new Set<string>();
  // Muse has no canine validation: visual detector quality is capped at moderate.
  const confusableWhimper =
    (audible && v.type === "whine") ||
    (humanPresent &&
      !!input.watcher?.yamnet.some(
        ({ label, score }) =>
          ["Whimper", "Whimper (dog)"].includes(label) &&
          score >=
            PARAMETERS.classThresholds[
              label as keyof typeof PARAMETERS.classThresholds
            ],
      ));
  const detectorCap: Certainty = confusableWhimper ? "baja" : "moderada";
  const push = (
    state: string,
    certainty: string,
    citations: string[],
    contexts: string[] = [],
  ) => {
    const unresolved = contexts.filter((c) => !contextSatisfied(c));
    unresolved.forEach((c) => missing.add(c));
    const candidate = {
      state,
      label: stateLabel(state, input.lang),
      certainty: cap(
        certainty as Certainty,
        detectorCap,
        unresolved.length ? "baja" : "alta",
      ),
      citations,
      required_context: contexts,
      conditional: unresolved.length > 0,
    };
    const old = interpretations.find((x) => x.state === state);
    if (!old) interpretations.push(candidate);
    else {
      old.citations = [...new Set([...old.citations, ...citations])];
      if (levels.indexOf(candidate.certainty) > levels.indexOf(old.certainty))
        Object.assign(old, candidate);
    }
  };
  for (const signal of evidence.signals) {
    if (!signs.has(signal.id)) continue;
    for (const support of signal.supports)
      push(
        support.state,
        support.certainty,
        signal.citations,
        signal.required_context,
      );
  }
  const combinationSigns = new Set(signs);
  const aliases: [string, boolean][] = [
    ["lip_lick", has("mouth", "lip_lick")],
    ["yawn", has("mouth", "yawn")],
    ["body_shake", has("body_shake", "shake_off")],
    ["moderately_lowered_posture", has("posture", "lowered")],
    ["restlessness", has("activity", "restless") || has("activity", "pacing")],
    [
      "restlessness/pacing",
      has("activity", "restless") || has("activity", "pacing"),
    ],
    ["trembling", has("scene", "trembling")],
    ["destruction near exits", has("scene", "exit_destruction")],
    ["inappropriate elimination", has("scene", "elimination")],
    ["hypersalivation", has("scene", "hypersalivation")],
    // Engineering preference: sustained duration is configurable, not a scientific threshold.
    [
      "sustained vocalization (bark/whine/howl)",
      audible &&
        ["bark", "whine", "howl"].includes(v.type) &&
        Math.max(
          v.sustained_seconds,
          input.watcher?.observations?.vocal_type === v.type
            ? input.watcher.observations.sustained_s
            : 0,
        ) *
          1000 >=
          PARAMETERS.sustainedVocalMs,
    ],
    ["high_long_interval_barks", signs.has("bark_high_long_intervals")],
  ];
  for (const [key, condition] of aliases)
    if (condition) combinationSigns.add(key);
  for (const combination of evidence.combinations) {
    if (!("output_state" in combination) || !combination.output_state) continue;
    const contexts = combination.requires_context || [];
    const all = combination.all_of || [],
      any = combination.any_of || [];
    const matched =
      all.every((s) => combinationSigns.has(s)) &&
      (!any.length ||
        any.filter((s) => combinationSigns.has(s)).length >=
          (combination.min_signs || 1));
    if (!matched) continue;
    if (!contexts.every(contextSatisfied)) {
      contexts
        .filter((c) => !contextSatisfied(c))
        .forEach((c) => missing.add(c));
      continue;
    }
    push(
      combination.output_state,
      combination.certainty,
      combination.citations,
      contexts,
    );
  }
  // A single growl remains ambiguous; alternatives are explicitly present in C08.
  if (audible && v.type === "growl" && !signs.has("growl_bout")) {
    const rule = evidence.signals.find((s) => s.id === "growl_bout")!;
    for (const s of rule.supports)
      push(s.state, "baja", rule.citations, rule.required_context);
  }
  const vet =
    signs.has("pain_behaviour_signs") ||
    signs.has("vocalize_on_touch") ||
    signs.has("very_low_posture_after_sudden_stimulus");
  interpretations.sort(
    (a, b) =>
      Number(b.state.includes("pain")) - Number(a.state.includes("pain")) ||
      Number(a.conditional) - Number(b.conditional) ||
      levels.indexOf(b.certainty) - levels.indexOf(a.certainty),
  );
  if (!interpretations.length) push("unspecified", "especulativa", []);
  const top = interpretations[0];
  // Questions are selected from the actual matched rule's required_context.
  const unknowns = contextQuestions([...missing], input.lang);
  if (humanPresent && mode === "i_left")
    unknowns.unshift(
      es
        ? "Se oyó a una persona: ¿había alguien con tu perro?"
        : "A person was heard — was someone with your dog?",
    );
  const dogLine = dogLineFor(
    { interpretations: [top], vet_alert: { flag: vet } },
    input.lang,
  );
  const observed = Object.values(d)
    .filter((part) => part.seen === "yes")
    .map((part) => part.evidence)
    .filter(Boolean);
  const legacyLabel = vet
    ? "pain"
    : ["play", "play_intent"].includes(top.state) && !top.conditional
      ? "play"
      : top.state === "alert_disturbance" && !top.conditional
        ? "alert"
        : "other";
  const description =
    observed.join(" · ") ||
    (es ? "No hay observaciones verificables." : "No verifiable observations.");
  return {
    lang: input.lang,
    observations: d,
    sam: enrichment.sam ?? null,
    human_speech: enrichment.human_speech ?? null,
    interpretations,
    unknowns,
    required_context: [...missing],
    certainty: top.certainty,
    dog_line: dogLine,
    // Compatibility only: the zero is NOT a probability and is never displayed.
    primary: {
      label: legacyLabel,
      emoji: vet ? "🩹" : "🐶",
      confidence: 0,
      evidence: observed.slice(0, 4).length
        ? observed.slice(0, 4)
        : [description],
    },
    secondary: [],
    low_confidence: ["baja", "especulativa"].includes(top.certainty),
    consistency_warnings: confusableWhimper
      ? [
          es
            ? humanPresent
              ? "Se oyó una voz humana en este clip; el quejido humano puede confundirse con el del perro (C42)."
              : "Posible quejido: puede confundirse con el quejido humano (C42)."
            : humanPresent
              ? "A human voice was heard in this clip; human Whimper can be confused with dog whimper (C42)."
              : "Possible whine: human whimper can be confused with dog whimper (C42).",
        ]
      : [],
    signals: {
      vocalization: {
        type: audible ? v.type : "none",
        present: audible,
        description: v.evidence,
      },
      bark: { present: audible && v.type === "bark", description: v.evidence },
      tail: d.tail.evidence,
      ears: d.ears.evidence,
      posture: d.posture.evidence,
      face: d.gaze.evidence,
      body_other: d.activity.evidence,
    },
    dog_says: dogLine,
    explanation: top.label,
    what_to_do: unknowns,
    vet_alert: {
      flag: vet,
      urgency: vet ? "soon" : "none",
      reasons: vet ? [VET_TEXT[input.lang]] : [],
      citations: vet ? ["C34"] : [],
    },
    media_observed: description,
    disclaimer: es
      ? "Interpretación, no un diagnóstico."
      : "Interpretation, not a diagnosis.",
    context_mode: mode,
  };
}
