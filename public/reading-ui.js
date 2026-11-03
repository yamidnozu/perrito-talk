import {
  citationUrl,
  certaintyWord,
  stateLabel,
  observedTexts,
  behaviorSummary,
  dogLineFor,
  contextQuestions,
  VET_TEXT,
} from "./evidence-utils.js";
import { downloadClip } from "./clip-download.js";
export const evidenceReady = fetch("/evidence.json")
  .then((r) => {
    if (!r.ok) throw new Error("Evidence unavailable");
    return r.json();
  })
  .catch(() => null);
const element = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
};
export const contextName = (mode, lang) =>
  ({
    at_home: ["At home", "En casa"],
    i_left: ["I left", "Salí"],
    visitor: ["Visitor", "Hay visita"],
    playing: ["Playing", "Jugando"],
  })[mode || "at_home"][lang === "es" ? 1 : 0];
export function mountContext(root, getLang, id) {
  const label = element("label"),
    title = element("span"),
    select = element("select");
  select.id = id;
  label.append(title, select);
  root.append(label);
  const render = () => {
    const value = select.value || "at_home";
    title.textContent = getLang() === "es" ? "Contexto" : "Context";
    select.replaceChildren(
      ...["at_home", "i_left", "visitor", "playing"].map((mode) => {
        const o = element("option", contextName(mode, getLang()));
        o.value = mode;
        return o;
      }),
    );
    select.value = value;
  };
  render();
  document.addEventListener("live-language", render);
  return select;
}
export function citationChip(id) {
  const chip = element("a", id, "badge citation");
  chip.target = "_blank";
  chip.rel = "noopener noreferrer";
  void evidenceReady.then((evidence) => {
    const url = citationUrl(id, evidence?.citations);
    if (url) chip.href = url;
  });
  return chip;
}
export function renderReading(
  root,
  r,
  { lang = "en", media = [], noDog = false } = {},
) {
  const es = lang === "es";
  root.replaceChildren(
    element(
      "small",
      r.mode === "mock"
        ? es
          ? "DEMOSTRACIÓN: contenido no inspeccionado"
          : "DEMO: content not inspected"
        : "Muse Spark",
    ),
  );
  if (r.analysis_mode === "deep")
    root.append(
      element(
        "small",
        es
          ? "Análisis profundo · mayoría de tres descripciones"
          : "Deep analysis · majority of three descriptions",
        "badge",
      ),
    );
  const doing = behaviorSummary(r, lang);
  const head = element("section", null, "reading-headline");
  head.append(
    element("small", es ? "Qué está haciendo" : "What your dog is doing"),
    element(
      "p",
      doing ||
        (noDog
          ? es
            ? "No se ve un perro en la cámara"
            : "No dog visible on camera"
          : es
            ? "No se pudo ver con claridad qué hace"
            : "Could not clearly see what the dog is doing"),
    ),
  );
  root.append(head);
  const observed = element("section", null, "reading-observed");
  observed.append(
    element("h3", es ? "Detalle de lo observado" : "Observation details"),
  );
  const descriptions = observedTexts(r, lang);
  const list = element("ul");
  for (const text of descriptions) list.append(element("li", text));
  observed.append(
    descriptions.length
      ? list
      : element(
          "p",
          r.lang === lang
            ? r.media_observed
            : es
              ? "No hay observaciones verificables."
              : "No verifiable observations.",
        ),
  );
  const dogLine = dogLineFor(r, lang);
  if (dogLine) {
    const line = element("div", null, "speech");
    line.append(
      element(
        "small",
        es
          ? "Si tu perro hablara… (interpretación lúdica)"
          : "If your dog could talk… (playful interpretation)",
      ),
      element("p", dogLine),
    );
    root.append(line);
  }
  const meanings = element("section");
  meanings.append(
    element("h3", es ? "Lo que podría significar" : "Could mean"),
  );
  for (const i of (r.interpretations || []).filter(Boolean)) {
    const p = element(
      "p",
      `${stateLabel(i.state, lang)} · ${certaintyWord(i.certainty, lang)}${i.conditional ? (es ? " · falta contexto" : " · context needed") : ""}`,
    );
    for (const id of i.citations) p.append(" ", citationChip(id));
    meanings.append(p);
  }
  for (const warning of r.consistency_warnings || [])
    meanings.append(
      element(
        "p",
        r.lang === lang
          ? warning
          : es
            ? "Posible confusión con sonidos humanos (C42)."
            : "Possible confusion with human sounds (C42).",
      ),
    );
  if ((r.interpretations || []).every((i) => !i || i.state === "unspecified"))
    meanings.append(
      element(
        "p",
        es
          ? "No le atribuimos una emoción: ninguna señal observada coincide con una regla de la base de evidencia. Sueño, hambre o alegría no tienen una regla validada, así que solo describimos lo que se ve y se oye."
          : "We do not attribute an emotion: no observed signal matches a rule in the evidence base. Sleep, hunger or joy have no validated rule, so we only describe what is seen and heard.",
        "note",
      ),
    );
  const how = element("details", null, "reading-how");
  how.append(
    element("summary", es ? "¿Cómo se decide?" : "How is this decided?"),
    element(
      "p",
      es
        ? "Muse Spark solo describe señales observables (postura, cola, sonido…). El código compara esas señales con una base de estudios revisados y limita la certeza a lo que esos estudios permiten. Toca un código (p. ej. C06) para abrir la fuente."
        : "Muse Spark only describes observable signals (posture, tail, sound…). Code matches those signals against a base of peer-reviewed studies and caps certainty at what they support. Tap a code (e.g. C06) to open the source.",
    ),
  );
  meanings.append(how);
  root.append(meanings);
  root.append(observed);
  const unknown = element("section");
  unknown.append(element("h3", es ? "Lo que falta saber" : "Still unknown"));
  const questions = contextQuestions(r.required_context || [], lang);
  if (r.context_mode === "i_left" && r.human_speech?.present)
    questions.unshift(
      es
        ? "Se oyó a una persona: ¿había alguien con tu perro?"
        : "A person was heard — was someone with your dog?",
    );
  for (const question of questions) unknown.append(element("p", question));
  root.append(unknown);
  const disclaimer = element(
    "p",
    es
      ? "Interpretación, no un diagnóstico."
      : "Interpretation, not a diagnosis.",
    "note reading-disclaimer",
  );
  root.append(disclaimer);
  if (r.vet_alert?.flag) {
    const banner = element("div", null, "vet reading-vet");
    banner.setAttribute("role", "alert");
    banner.append(element("strong", VET_TEXT[lang]), " ", citationChip("C34"));
    root.append(banner);
    if (media.length) {
      const save = element(
        "button",
        es ? "Guardar clip para el veterinario" : "Save clip for the vet",
      );
      save.onclick = () => downloadClip(media);
      banner.append(save);
    }
  }
}
