import { vote } from "./vote";
import { EMPTY_SAM } from "./sam";
import { EMPTY_SPEECH } from "./asr";
import type { AnalyzeInput } from "./schema";
import { emptyDescriptors } from "./descriptors";
import { interpret } from "./interpret";

export function mockReading(input: AnalyzeInput) {
  const es = input.lang === "es";
  const note = es
    ? "Demostración: no se inspeccionó el contenido."
    : "Demo: media content was not inspected.";
  const descriptors = emptyDescriptors(note);
  // Synthetic examples are explicitly demos, never claims about attached media.
  const situation = input.context.situation || "";
  if (/limp|coje|pain|dolor/i.test(situation))
    descriptors.pain_signs = { seen: "yes", values: ["limp"], evidence: note };
  if (/play|jugar|ball|pelota/i.test(situation)) {
    descriptors.play_bow = {
      seen: "yes",
      values: ["forelimbs_lowered_rear_raised"],
      evidence: note,
    };
    descriptors.interaction = {
      seen: "yes",
      values: ["person", "interacting"],
      evidence: note,
    };
  }
  return {
    ...interpret(
      input.deep
        ? vote(
            [
              structuredClone(descriptors),
              structuredClone(descriptors),
              structuredClone(descriptors),
            ],
            input.lang,
          )
        : descriptors,
      input,
      {
        sam: { ...EMPTY_SAM },
        human_speech: { ...EMPTY_SPEECH },
      },
    ),
    media_observed: note,
    mode: "mock",
    analysis_mode: input.deep ? "deep" : "single",
    descriptor_calls: 0,
  };
}

export function mockPatterns(lang: string) {
  return lang === "es"
    ? {
        summary: "Tu diario ayuda a observar necesidades recurrentes.",
        patterns: [
          "Compara necesidades y horarios en la gráfica local; estos consejos son una demostración.",
        ],
        tips: [
          "Registra también cambios en sueño, apetito y actividad.",
          "Mantén una rutina de paseos y descanso.",
        ],
        vet_note: "Consulta al veterinario ante dolor o cambios persistentes.",
        mode: "mock",
      }
    : {
        summary: "Your diary helps you notice recurring needs.",
        patterns: [
          "Compare needs and times in the local chart; these tips are a demonstration.",
        ],
        tips: [
          "Also record changes in sleep, appetite and activity.",
          "Keep a regular routine of walks and rest.",
        ],
        vet_note: "Contact a veterinarian for pain or persistent changes.",
        mode: "mock",
      };
}
