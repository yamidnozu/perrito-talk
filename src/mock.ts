import type { AnalyzeInput } from "./schema";

export function mockReading(input: AnalyzeInput) {
  const es = input.lang === "es",
    s = JSON.stringify(input.context).toLowerCase();
  const pain = /limp|coje|pain|dolor/.test(s),
    door = /door|puerta|outside|salir/.test(s),
    play = /play|jugar|ball|pelota/.test(s),
    audio = input.media.some((m) => m.kind === "audio" || m.kind === "video");
  const label = pain
    ? "pain"
    : door
      ? "wants_out"
      : play
        ? "play"
        : audio
          ? "attention"
          : "happy";
  const phrase = pain
    ? es
      ? "Algo me molesta. ¿Me ayudas con calma?"
      : "Something feels uncomfortable. Can you gently help me?"
    : door
      ? es
        ? "¡La puerta! ¿Salimos a explorar?"
        : "That door! Shall we go exploring?"
      : play
        ? es
          ? "¡Una ronda más con mi pelota!"
          : "One more round with my ball!"
        : es
          ? "Mi lugar favorito es a tu lado."
          : "My favorite place is right beside you.";
  const unknown = es
    ? "No observado en esta simulación."
    : "Not observed in this simulation.";
  return {
    primary: {
      label,
      emoji: pain ? "🩹" : door ? "🚪" : play ? "🎾" : "🐶",
      confidence: pain ? 0.72 : 0.68,
      evidence: [unknown],
    },
    secondary: [{ label: "attention", confidence: 0.4 }],
    low_confidence: false,
    consistency_warnings: [],
    signals: {
      vocalization: { type: "none", present: false, description: unknown },
      bark: {
        present: audio,
        description: audio
          ? es
            ? "Ejemplo simulado de vocalización; no se analizó el audio."
            : "Simulated vocalization example; audio was not analyzed."
          : unknown,
      },
      tail: unknown,
      ears: unknown,
      posture: unknown,
      face: unknown,
      body_other: unknown,
    },
    dog_says: phrase,
    explanation: es
      ? "Ejemplo ilustrativo basado en el contexto y tipo de archivo; no es un análisis real del contenido."
      : "Illustrative example based on context and file type; this is not a real analysis of the content.",
    what_to_do: pain
      ? es
        ? [
            "Evita ejercicio intenso.",
            "Consulta al veterinario por la cojera o dolor.",
          ]
        : [
            "Avoid strenuous exercise.",
            "Contact your veterinarian about limping or pain.",
          ]
      : es
        ? [
            "Ofrece una pausa tranquila y observa su respuesta.",
            "Comprueba agua, paseo y oportunidades de juego.",
          ]
        : [
            "Offer a calm break and observe their response.",
            "Check water, walk and play opportunities.",
          ],
    vet_alert: {
      flag: pain,
      urgency: pain ? "soon" : "none",
      reasons: pain
        ? [
            es
              ? "El contexto menciona dolor o cojera."
              : "Context mentions pain or limping.",
          ]
        : [],
    },
    media_observed: es
      ? "Demostración: no se inspeccionó el contenido."
      : "Demo: media content was not inspected.",
    disclaimer: es
      ? "Interpretación, no un diagnóstico."
      : "Interpretation, not a diagnosis.",
    mode: "mock",
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
