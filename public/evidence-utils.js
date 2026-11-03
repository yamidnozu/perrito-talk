import { PARAMETERS } from "./watcher/evidence-config.js";
/** DOI takes precedence over PMID, then an explicit source URL. */
export function citationUrl(id, citations) {
  const reference = citations?.[id] || "";
  const doi = reference.match(/\bdoi:\s*(10\.\d{4,9}\/[^\s]+)/i)?.[1];
  if (doi) return `https://doi.org/${doi.replace(/[.,;]+$/, "")}`;
  const pmid = reference.match(/\bPMID\s*:?\s*(\d+)/i)?.[1];
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  return reference.match(/https?:\/\/[^\s)]+/)?.[0] || null;
}
export const certaintyWord = (level, lang) =>
  lang === "es"
    ? level
    : {
        alta: "high",
        moderada: "moderate",
        baja: "low",
        especulativa: "speculative",
      }[level] || "speculative";

const labels = {
  play_intent: ["intención de juego", "play intent"],
  play: ["juego", "play"],
  alert_disturbance: ["alerta o perturbación", "alert or disturbance"],
  perceived_aggression_by_humans: [
    "sonido percibido como amenazante por humanos",
    "sound perceived as threatening by humans",
  ],
  isolation: ["aislamiento", "isolation"],
  perceived_playful_happy_by_humans: [
    "sonido percibido como juguetón por humanos",
    "sound perceived as playful by humans",
  ],
  perceived_fear_desperation_by_humans: [
    "sonido percibido como miedo por humanos",
    "sound perceived as fearful by humans",
  ],
  threat_or_guarding: [
    "amenaza o protección de recursos",
    "threat or guarding",
  ],
  separation_related_stress: [
    "malestar relacionado con separación",
    "separation-related distress",
  ],
  separation_fear_component: [
    "componente de miedo durante la ausencia",
    "fear component during absence",
  ],
  separation_frustration_component: [
    "componente de frustración durante la ausencia",
    "frustration component during absence",
  ],
  possible_pain: ["posible dolor", "possible pain"],
  possible_pain_consult_vet: [
    "posible dolor: consulta veterinaria",
    "possible pain: consult a veterinarian",
  ],
  unspecified: [
    "sin señal con respaldo científico suficiente",
    "no signal with enough scientific support",
  ],
  arousal_not_valence: [
    "activación, sin saber si es agradable",
    "arousal, without knowing its valence",
  ],
  intense_acute_stress: ["estrés agudo intenso", "intense acute stress"],
  moderate_acute_stress: ["estrés agudo moderado", "moderate acute stress"],
  appeasement_mild_conflict: [
    "apaciguamiento o conflicto leve",
    "appeasement or mild conflict",
  ],
  greeting: ["saludo", "greeting"],
  freeze_stress: [
    "inmovilidad en contexto estresante",
    "freezing in a stressful setting",
  ],
  positive_anticipation: [
    "anticipación de una recompensa",
    "reward anticipation",
  ],
  frustration: ["frustración", "frustration"],
  compatible_with_separation_related_problem: [
    "compatible con un problema relacionado con la separación",
    "compatible with a separation-related problem",
  ],
  observation_only: ["solo observación", "observation only"],
};
export const stateLabel = (state, lang) =>
  labels[state]?.[lang === "es" ? 0 : 1] ||
  (lang === "es" ? "significado desconocido" : "unknown meaning");

export const VET_TEXT = {
  es: "Esto no es un diagnóstico. Si es nuevo o persiste, consulta a tu veterinario; un video corto le ayuda",
  en: "This is not a diagnosis. If it is new or persists, consult your veterinarian; a short video helps them",
};

export function contextQuestions(contexts, lang) {
  const es = lang === "es";
  const questions = contexts.map((context) => {
    if (/absent|alone|separat/.test(context))
      return es
        ? "¿Saliste y quedó separado de ti?"
        : "Did you leave the dog separated from you?";
    if (/partner|interaction|human|social/.test(context))
      return es
        ? "¿Había una persona u otro perro interactuando?"
        : "Was a person or another dog interacting?";
    if (/external|sudden/.test(context))
      return es
        ? "¿Hubo un timbre, visita o ruido repentino?"
        : "Was there a doorbell, visitor or sudden noise?";
    if (/reward/.test(context))
      return es
        ? "¿Había una recompensa visible o fuera de su alcance?"
        : "Was a reward visible or withheld?";
    if (/touch|movement|deviation|persistence/.test(context))
      return es
        ? "¿Es nuevo, persiste o aparece al moverse o tocar una zona?"
        : "Is it new, persistent, or related to movement or touching an area?";
    return es
      ? "¿Qué ocurrió alrededor y cómo se compara con lo habitual para tu perro?"
      : "What happened nearby, and how does it compare with your dog's usual behavior?";
  });
  return [
    ...new Set(
      questions.length
        ? questions
        : [
            es
              ? "¿Se repite y cómo se compara con lo habitual para tu perro?"
              : "Does it recur, and how does it compare with your dog's usual behavior?",
          ],
    ),
  ];
}

export function dogLineFor(reading, lang) {
  if (reading.vet_alert?.flag) return PARAMETERS.templates.neutral[lang];
  const top = reading.interpretations?.[0];
  if (!top || top.certainty === "especulativa") return "";
  if (top.state === "play_intent" && top.certainty === "alta")
    return PARAMETERS.templates.play_intent[lang];
  return PARAMETERS.templates[top.certainty][lang].replace(
    "{state}",
    stateLabel(top.state, lang),
  );
}

// Preserve model evidence in its original language. On a language switch, render
// the same observable enum values locally instead of inventing a translation.
export function observedTexts(reading, lang) {
  const additions = stackObservations(reading, lang);
  if (!reading.lang || reading.lang === lang)
    return Object.values(reading.observations || {})
      .filter((d) => d.seen === "yes")
      .map((d) => d.evidence)
      .filter(Boolean)
      .concat(additions);
  const result = [];
  for (const [key, descriptor] of Object.entries(reading.observations || {})) {
    if (descriptor.seen !== "yes") continue;
    if (key === "vocalization") {
      const type = {
        bark: ["Ladrido", "Bark"],
        howl: ["Aullido", "Howl"],
        whine: ["Posible quejido", "Possible whine"],
        growl: ["Gruñido", "Growl"],
        none: ["Sin vocalización", "No vocalization"],
        unclear: ["Sonido incierto", "Unclear sound"],
      }[descriptor.type];
      if (type)
        result.push(
          `${type[lang === "es" ? 0 : 1]} · ${descriptor.count} · ${lang === "es" ? "tandas" : "bursts"}: ${descriptor.bursts}`,
        );
    } else
      for (const value of descriptor.values || [])
        if (OBSERVABLE_WORDS[value])
          result.push(OBSERVABLE_WORDS[value][lang === "es" ? 0 : 1]);
  }
  return [...new Set([...result, ...additions])];
}
const OBSERVABLE_WORDS = {
  neutral: ["Postura neutra", "Neutral posture"],
  lowered: ["Postura baja", "Lowered posture"],
  very_low: ["Postura muy baja", "Very low posture"],
  hunched: ["Postura encorvada", "Hunched posture"],
  head_lowered: ["Cabeza baja", "Lowered head"],
  wagging: ["Mueve la cola", "Tail wagging"],
  still: ["Quieto", "Still"],
  tucked: ["Cola recogida", "Tucked tail"],
  raised: ["Cola elevada", "Raised tail"],
  pinned_back: ["Orejas hacia atrás", "Ears pinned back"],
  adductor: ["Orejas aductoras", "Adductor ears"],
  flattener: ["Orejas aplanadas", "Flattened ears"],
  lip_lick: ["Lamido de labios", "Lip lick"],
  nose_lick: ["Lamido de nariz", "Nose lick"],
  yawn: ["Bostezo", "Yawn"],
  pant: ["Jadeo", "Panting"],
  lips_part: ["Labios separados", "Lips parted"],
  jaw_drop: ["Mandíbula abierta", "Jaw dropped"],
  averted: ["Mirada desviada", "Averted gaze"],
  whale_eye: ["Esclerótica visible", "Visible sclera"],
  blink: ["Parpadeo", "Blink"],
  toward_partner: ["Mira al compañero", "Looks toward partner"],
  shake_off: ["Sacudida corporal", "Body shake"],
  forelimbs_lowered_rear_raised: [
    "Patas delanteras bajas y parte trasera elevada",
    "Forelimbs lowered, rear raised",
  ],
  limp: ["Cojera", "Limp"],
  stiffness: ["Rigidez", "Stiffness"],
  reluctance_to_move: ["Reticencia a moverse", "Reluctance to move"],
  lick_area: ["Lame una zona", "Licks an area"],
  squinted_eyes: ["Ojos entrecerrados", "Squinted eyes"],
  other_dog: ["Otro perro presente", "Another dog present"],
  person: ["Persona presente", "Person present"],
  touch: ["Contacto físico", "Physical contact"],
  interacting: ["Interacción observada", "Observed interaction"],
  vocalize_on_touch: ["Vocaliza al tocar una zona", "Vocalizes on touch"],
  active: ["Movimiento activo", "Active movement"],
  restless: ["Movimiento inquieto", "Restless movement"],
  pacing: ["Deambula repetidamente", "Pacing"],
  sudden_stimulus: ["Estímulo repentino", "Sudden stimulus"],
  external_stimulus: ["Estímulo externo", "External stimulus"],
  reward_visible: ["Recompensa visible", "Visible reward"],
  reward_withheld: ["Recompensa fuera de alcance", "Reward withheld"],
  handling: ["Manipulación física", "Handling"],
  exit_scratching: ["Rasca una salida", "Scratches an exit"],
  exit_destruction: ["Daña una salida", "Destruction near an exit"],
  elimination: ["Eliminación observada", "Observed elimination"],
  hypersalivation: ["Salivación abundante", "Heavy salivation"],
  heat_or_exercise: [
    "Calor o ejercicio observados",
    "Observed heat or exercise",
  ],
  trembling: ["Temblor", "Trembling"],
  lying_down: ["Tumbado", "Lying down"],
  eyes_closed: ["Ojos cerrados", "Eyes closed"],
  sitting: ["Sentado", "Sitting"],
  standing: ["De pie", "Standing"],
  walking: ["Camina", "Walking"],
  running: ["Corre", "Running"],
  eating: ["Come", "Eating"],
  chewing_object: ["Mastica algo", "Chewing something"],
  drinking: ["Bebe", "Drinking"],
  sniffing: ["Olfatea", "Sniffing"],
  digging: ["Escarba", "Digging"],
  chasing_object: ["Persigue un objeto", "Chasing an object"],
  fixed_stare: ["Mirada fija", "Fixed stare"],
};

/** "What the dog is doing": observable actions and sounds only, no emotion.
 * Priority: audible vocalization, observed actions, activity, company. */
export function behaviorSummary(reading, lang) {
  const o = reading?.observations || {},
    i = lang === "es" ? 0 : 1,
    out = [];
  const v = o.vocalization;
  const voice = {
    bark: ["Ladra", "Barking"],
    howl: ["Aúlla", "Howling"],
    whine: ["Posible quejido", "Possible whine"],
    growl: ["Gruñe", "Growling"],
  }[v?.seen === "yes" ? v.type : ""];
  if (voice) out.push(voice[i]);
  const values = (key) => (o[key]?.seen === "yes" ? o[key].values || [] : []);
  for (const value of values("behavior")) {
    if (value === "standing" && values("behavior").length > 1) continue;
    if (OBSERVABLE_WORDS[value]) out.push(OBSERVABLE_WORDS[value][i]);
  }
  if (out.length < 2) {
    const a = values("activity")[0];
    if (a) out.push(OBSERVABLE_WORDS[a][i]);
  }
  if (values("tail").includes("wagging")) out.push(OBSERVABLE_WORDS.wagging[i]);
  const company = values("interaction");
  if (company.includes("person"))
    out.push(lang === "es" ? "con una persona" : "with a person");
  else if (company.includes("other_dog"))
    out.push(lang === "es" ? "con otro perro" : "with another dog");
  return [...new Set(out)].slice(0, 4).join(" · ");
}

/** Localization of server enrichment: speaker labels never identify the owner. */
export function stackObservations(reading, lang) {
  const result = [],
    es = lang === "es";
  if (
    reading.acoustic_hints?.certainty &&
    !["unclear", "silence"].includes(reading.acoustic_hints.class)
  ) {
    const label =
      reading.acoustic_hints.class === "whine_whimper"
        ? "whine"
        : reading.acoustic_hints.class;
    result.push(
      `${es ? "Heurística acústica" : "Acoustic heuristic"}: ${observableName(label, lang)} · ${certaintyWord(reading.acoustic_hints.certainty, lang)}`,
    );
  }
  if (reading.sam?.frames_checked > 0)
    result.push(
      es
        ? `SAM 3.1: ${reading.sam.dogs} ${reading.sam.dogs === 1 ? "perro localizado" : "perros localizados"}`
        : `SAM 3.1: ${reading.sam.dogs} ${reading.sam.dogs === 1 ? "dog located" : "dogs located"}`,
    );
  if (reading.human_speech?.present)
    result.push(
      es
        ? `Se oyó una voz humana: «${reading.human_speech.excerpt}»`
        : `A person's voice was heard: '${reading.human_speech.excerpt}'`,
    );
  return result;
}

/** Canonical observable wording for majority voting; no new interpretations. */
export function observableName(value, lang) {
  const voice = {
    bark: ["Ladrido", "Bark"],
    howl: ["Aullido", "Howl"],
    whine: ["Quejido", "Whine"],
    growl: ["Gruñido", "Growl"],
  };
  return (
    (voice[value] || OBSERVABLE_WORDS[value])?.[lang === "es" ? 0 : 1] ||
    (lang === "es" ? "Observación incierta" : "Unclear observation")
  );
}
