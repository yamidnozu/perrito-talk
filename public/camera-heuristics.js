/** @param {import("../src/camera").CameraInput} input */
export function cameraHeuristics(input) {
  const es = input.lang === "es";
  const clips = [...input.clips].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
  );
  /** @type {{type:string, severity:string, evidence:string, advice:string}[]} */
  const alerts = [];
  const voices = (c) => [
    ...(c.signals.vocalization?.present ? [c.signals.vocalization.type] : []),
    ...(c.acoustic_hints?.confidence >= 0.5 ? [c.acoustic_hints.class] : []),
  ];
  const anxious = (c) =>
    ["anxious", "fear", "wants_out"].includes(c.label) ||
    voices(c).some((v) =>
      ["whine", "whimper", "whine_whimper", "cry", "howl"].includes(v),
    );
  let run = [],
    longest = [];
  for (const c of clips) {
    run = anxious(c) ? [...run, c] : [];
    if (run.length > longest.length) longest = run;
  }
  if (longest.length >= 2)
    alerts.push({
      type: "separation_anxiety",
      severity: longest.length >= 4 ? "urgent" : "warning",
      evidence: `${longest[0].ts} — ${longest[longest.length - 1].ts}: ${longest.length} ${es ? "clips consecutivos con quejidos, llanto, aullidos o ansiedad/miedo/deseo de salir; posible ansiedad por separación, sin confirmar." : "consecutive clips with whining, crying, howling or anxious/fear/wants_out labels; possible separation anxiety, unconfirmed."}`,
      advice: es
        ? "Comprueba cómo está y consulta a un profesional si se repite."
        : "Check on your dog and consult a professional if this repeats.",
    });
  const barks = clips.filter(
    (c) =>
      c.signals.bark.present ||
      voices(c).some((v) => ["bark", "howl"].includes(v)),
  );
  const window = barks.findIndex(
    (c, i) =>
      i >= 2 && Date.parse(c.ts) - Date.parse(barks[i - 2].ts) <= 30 * 60000,
  );
  if (window >= 2)
    alerts.push({
      type: "prolonged_barking",
      severity: "warning",
      evidence: `${barks[window - 2].ts} — ${barks[window].ts}: ${es ? "Ladridos/aullidos en tres clips en 30 minutos; no prueba ladrido continuo." : "Barking/howling in three clips within 30 minutes; does not establish continuous barking/howling."}`,
      advice: es
        ? "Revisa posibles desencadenantes y ofrece apoyo sin castigar."
        : "Check possible triggers and offer support without punishment.",
    });
  for (const c of clips.filter((c) =>
    voices(c).some((v) => ["cry", "yelp", "cry_yelp"].includes(v)),
  ))
    alerts.push({
      type: "distress_vocalization",
      severity: "warning",
      evidence: `${c.ts}: ${es ? "Llanto/gemido reportado." : "Cry/yelp vocalization reported."}`,
      advice: es
        ? "Comprueba cómo está tu perro y busca posibles causas de malestar."
        : "Check on your dog for possible causes of distress.",
    });
  for (const c of clips.filter((c) => c.vet_alert.flag || c.label === "pain"))
    alerts.push({
      type: "pain_signs",
      severity: c.vet_alert.urgency === "emergency" ? "urgent" : "warning",
      evidence: `${c.ts}: ${c.vet_alert.reasons.join("; ") || c.label}`,
      advice: es
        ? "Contacta a un veterinario; ante una emergencia busca atención inmediata."
        : "Contact a veterinarian; seek immediate care for an emergency.",
    });
  return alerts;
}
/** @param {ReturnType<typeof cameraHeuristics>} model
 * @param {ReturnType<typeof cameraHeuristics>} deterministic */
export function mergeAlerts(model, deterministic) {
  const rank = { info: 0, warning: 1, urgent: 2 };
  const merged = new Map();
  for (const a of [...model, ...deterministic]) {
    const old = merged.get(a.type);
    merged.set(
      a.type,
      old
        ? {
            ...a,
            severity:
              rank[old.severity] > rank[a.severity] ? old.severity : a.severity,
            evidence: old.evidence.includes(a.evidence)
              ? old.evidence
              : `${old.evidence}\n${a.evidence}`,
            advice: old.advice.includes(a.advice)
              ? old.advice
              : `${old.advice}\n${a.advice}`,
          }
        : a,
    );
  }
  return [...merged.values()];
}

export function alertTitle(type, lang) {
  const titles = {
    separation_anxiety: [
      "Possible separation anxiety",
      "Posible ansiedad por separación",
    ],
    prolonged_barking: ["Repeated barking", "Ladridos repetidos"],
    distress_vocalization: ["Howling/whining", "Aullidos/quejidos"],
    pain_signs: ["Possible pain signs", "Posibles señales de dolor"],
    destructive_behavior: ["Destructive behavior", "Conducta destructiva"],
    inactivity: ["Inactivity", "Inactividad"],
  };
  return `🚨 ${(titles[type] || ["Check on your dog", "Comprueba cómo está tu perro"])[lang === "es" ? 1 : 0]}`;
}
