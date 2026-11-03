/** @param {import("../src/camera").CameraInput} input */
export function cameraHeuristics(input) {
  const es = input.lang === "es";
  const clips = [...input.clips].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
  );
  /** @type {{type:string, severity:string, evidence:string, advice:string}[]} */
  const alerts = [];
  const anxious = (c) => ["anxious", "fear"].includes(c.label);
  const pair = clips.findIndex(
    (c, i) => i > 0 && anxious(c) && anxious(clips[i - 1]),
  );
  if (pair > 0)
    alerts.push({
      type: "separation_anxiety",
      severity: "warning",
      evidence: `${clips[pair - 1].ts} — ${clips[pair].ts}: ${es ? "Dos lecturas consecutivas de ansiedad o miedo; posible ansiedad por separación, sin confirmar." : "Two consecutive anxious/fear readings; possible separation anxiety, unconfirmed."}`,
      advice: es
        ? "Comprueba cómo está y consulta a un profesional si se repite."
        : "Check on your dog and consult a professional if this repeats.",
    });
  const barks = clips.filter((c) => c.signals.bark.present);
  const window = barks.findIndex(
    (c, i) =>
      i >= 2 && Date.parse(c.ts) - Date.parse(barks[i - 2].ts) <= 30 * 60000,
  );
  if (window >= 2)
    alerts.push({
      type: "prolonged_barking",
      severity: "warning",
      evidence: `${barks[window - 2].ts} — ${barks[window].ts}: ${es ? "Ladridos en tres clips en 30 minutos; no prueba ladrido continuo." : "Barking in three clips within 30 minutes; does not establish continuous barking."}`,
      advice: es
        ? "Revisa posibles desencadenantes y ofrece apoyo sin castigar."
        : "Check possible triggers and offer support without punishment.",
    });
  for (const c of clips.filter((c) => c.vet_alert.flag))
    alerts.push({
      type: "pain_signs",
      severity: c.vet_alert.urgency === "emergency" ? "urgent" : "warning",
      evidence: `${c.ts}: ${c.vet_alert.reasons.join("; ")}`,
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
