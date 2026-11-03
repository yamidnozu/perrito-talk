/** Evidence-backed alerts from code interpretations, never legacy emotion labels.
 * C34 routes pain/intense-stress flags to a vet; separation needs declared absence.
 * Sparse clips do not establish continuous vocalization or a diagnosis.
 * @param {import("../src/camera").CameraInput} input
 */
export function cameraHeuristics(input) {
  const es = input.lang === "es";
  const alerts = [];
  for (const c of input.clips) {
    if (c?.vet_alert?.flag)
      alerts.push({
        type: "pain_signs",
        severity: c.vet_alert.urgency === "emergency" ? "urgent" : "warning",
        evidence: `${c.ts}: ${c.vet_alert.reasons.join("; ")}`,
        advice: es
          ? "Esto no es un diagnóstico. Si es nuevo o persiste, consulta a tu veterinario; un video corto le ayuda"
          : "This is not a diagnosis. If it is new or persists, consult your veterinarian; a short video helps them",
      });
    if (
      c.context_mode === "i_left" &&
      c.interpretations?.some(
        (i) =>
          i?.state === "compatible_with_separation_related_problem" &&
          !i.conditional,
      )
    )
      alerts.push({
        type: "separation_anxiety",
        severity: "warning",
        evidence: `${c.ts}: C35, C37, C45`,
        advice: es
          ? "Patrón compatible con un problema relacionado con la separación; no es un diagnóstico. Consulta a un profesional si se repite."
          : "Pattern compatible with a separation-related problem; not a diagnosis. Consult a professional if it recurs.",
      });
  }
  return mergeAlerts([], alerts);
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
      "Compatible separation-related pattern",
      "Patrón compatible con malestar por separación",
    ],
    prolonged_barking: ["Repeated barking", "Ladridos repetidos"],
    distress_vocalization: ["Howling/whining", "Aullidos/quejidos"],
    pain_signs: ["Possible pain signs", "Posibles señales de dolor"],
    destructive_behavior: ["Destructive behavior", "Conducta destructiva"],
    inactivity: ["Inactivity", "Inactividad"],
  };
  return `🚨 ${(titles[type] || ["Check on your dog", "Comprueba cómo está tu perro"])[lang === "es" ? 1 : 0]}`;
}
