import { createBaseline } from "./watcher/baseline.js";
import { prewarmModels } from "./watcher/vision.js";
import { certaintyWord, dogLineFor, observedTexts } from "./evidence-utils.js";
import { renderReading, mountContext } from "./reading-ui.js";
import { mountDevicePicker, openMedia } from "./devices.js";
import {
  BLUR_NOTICE,
  disableCameraEffects,
  heardText,
  mountLive,
} from "./live.js";
import {
  cameraHeuristics,
  mergeAlerts,
  alertTitle,
} from "./camera-heuristics.js";
import { normalize, loadImage } from "./media.js";
const $ = (id) => document.getElementById(id);
const words = {
  en: {
    cameraMode: "Camera mode",
    liveMode: "Watcher",
    cameraHelp:
      "Upload up to 8 security-camera clips. Times default to file modification time; edit to match recording time. Gaps are unobserved.",
    cameraRun: "Analyze clips",
    cameraSave: "Save all readings to diary",
    cameraDemo: "Demo summary",
    cameraContext: "Optional context",
    cameraStream: "Live stream · planned",
    read: "Read my dog",
    diary: "Dog diary",
    eyebrow: "A LITTLE CLOSER. A LITTLE MORE WOOF.",
    headline: "Big feelings.\nLittle clues.",
    intro:
      "That bark. That head tilt. That look. Explore what your best friend might be telling you.",
    powered: "A new kind of conversation, powered by Muse Spark",
    dogbubble: "“You get me.”",
    shareMoment: "Share a little moment",
    uploadTitle: "A woof is worth a thousand words.",
    formats: "Photo, video or audio. We'll handle the little details.",
    choose: "Choose a moment",
    limits: "Images · MP4 video up to 12 MB · Audio up to 30 seconds",
    recordVideo: "◉ Record video",
    cameraLabel: "Camera",
    micLabel: "Microphone",
    recordAudio: "♫ Record audio",
    stop: "■ Stop",
    contextTitle: "A little context helps · optional +",
    breed: "Breed",
    age: "Age",
    situation: "What's happening?",
    analyze: "Read this moment ✦",
    deepAnalyze: "Deep analysis",
    deepCost: "About three times the model calls; retries may add calls.",
    sample: "Just curious? Try a sample →",
    listen: "LET’S LISTEN A LITTLE CLOSER",
    welcomeTitle: "Their world.\nIn a few words.",
    welcomeText:
      "Share a moment to explore body language, possible needs, and thoughtful next steps.",
    bodyLanguage: "↗ Body language",
    voice: "♫ Voice & sounds",
    care: "♡ Better care",
    disclaimer:
      "Interpretation, not a diagnosis. Your dog is wonderfully complex; context and a veterinarian still matter.",
    littleMoments: "LITTLE MOMENTS, BIGGER PICTURE",
    diaryTitle: "Your dog's story.",
    clear: "Clear diary",
    localOnly:
      "Saved only in this browser. A little journal of your life together.",
    patterns: "Ask Muse about patterns ✦",
    footer: "Made for the love of dogs.",
    cardTitle: "A little woof to keep.",
    download: "Download",
    share: "Share",
    mock: "Demo mode (mock)",
    live: "Live · Muse Spark",
    sniff: "Sniffing the signals…",
    listenLoad: "Listening between the woofs…",
    think: "Putting our paws on it…",
    prepare: "Preparing your moment…",
    error: "Could not complete that request. Please try again.",
    confidence: "interpretation confidence",
    actions: "A little care goes a long way",
    observed: "Observed",
    vet: "Veterinary attention",
    speak: "♫ Read aloud",
    card: "↗ Make a share card",
    saved: "Saved to your diary",
    notSaved:
      "Browser storage unavailable or full. This reading was not saved.",
    empty: "Your story starts with one little moment. Try a reading first.",
    frequent: "Most frequent needs",
    time: "Time of day",
    periods: ["Night", "Morning", "Afternoon", "Evening"],
    recording: "Recording… stops automatically after 30 seconds.",
    denied:
      "Camera or microphone unavailable. Check permissions or upload a file.",
    audio30:
      "Audio normalized to mono WAV; only the first 30 seconds are sent.",
    framesAudio: "Video converted to 4 frames + the first 30 seconds of audio.",
    generating: "Making something worth a woof…",
    fallback: "Browser-made card · illustrated fallback",
    imageLive: "Muse Image · generated card",
    confirmClear: "Delete all diary entries from this browser?",
    patternSending: "Only compact diary entries are sent to Muse; no media.",
    signalNames: {
      bark: "Bark",
      tail: "Tail",
      ears: "Ears",
      posture: "Posture",
      face: "Face",
      body_other: "Other signals",
    },
    labels: {
      hungry: "Hungry",
      play: "Ready to play",
      anxious: "Anxious",
      pain: "Possible discomfort",
      alert: "Alert",
      wants_out: "Wants to go out",
      attention: "Wants attention",
      happy: "Content",
      tired: "Tired",
      fear: "Fearful",
      aggressive_warning: "Warning signals",
      other: "Other",
    },
  },
  es: {
    read: "Entender a mi perro",
    cameraMode: "Modo cámara",
    liveMode: "Vigilante",
    cameraHelp:
      "Sube hasta 8 clips de seguridad. La hora predeterminada es la modificación del archivo; ajústala a la grabación. Los intervalos no se observan.",
    cameraRun: "Analizar clips",
    cameraSave: "Guardar todas las lecturas en el diario",
    cameraDemo: "Resumen de demostración",
    cameraContext: "Contexto opcional",
    cameraStream: "Transmisión en vivo · prevista",
    diary: "Diario perruno",
    eyebrow: "MÁS CERCA. CON UN POCO MÁS DE GUAU.",
    headline: "Grandes emociones.\nPequeñas pistas.",
    intro:
      "Ese ladrido. Esa cabecita ladeada. Esa mirada. Explora lo que tu mejor amigo podría estar diciendo.",
    powered: "Una nueva conversación, con Muse Spark",
    dogbubble: "«Tú me entiendes.»",
    shareMoment: "Comparte un momento",
    uploadTitle: "Un guau vale más que mil palabras.",
    formats: "Foto, video o audio. Nosotros cuidamos los detalles.",
    choose: "Elige un momento",
    limits: "Imágenes · Video MP4 hasta 12 MB · Audio hasta 30 segundos",
    recordVideo: "◉ Grabar video",
    cameraLabel: "Cámara",
    micLabel: "Micrófono",
    recordAudio: "♫ Grabar audio",
    stop: "■ Detener",
    contextTitle: "Un poco de contexto ayuda · opcional +",
    breed: "Raza",
    age: "Edad",
    situation: "¿Qué está pasando?",
    analyze: "Lee este momento ✦",
    deepAnalyze: "Análisis profundo",
    deepCost:
      "Aproximadamente el triple de llamadas al modelo; los reintentos pueden añadir llamadas.",
    sample: "¿Curiosidad? Prueba un ejemplo →",
    listen: "ESCUCHEMOS UN POCO MÁS DE CERCA",
    welcomeTitle: "Su mundo.\nEn pocas palabras.",
    welcomeText:
      "Comparte un momento para explorar su lenguaje corporal, posibles necesidades y cómo ayudar.",
    bodyLanguage: "↗ Lenguaje corporal",
    voice: "♫ Voz y sonidos",
    care: "♡ Más cuidado",
    disclaimer:
      "Interpretación, no un diagnóstico. Tu perro es complejo; el contexto y el veterinario siguen siendo importantes.",
    littleMoments: "PEQUEÑOS MOMENTOS, UNA HISTORIA MAYOR",
    diaryTitle: "La historia de tu perro.",
    clear: "Borrar diario",
    localOnly: "Guardado solo en este navegador. Un diario de su vida juntos.",
    patterns: "Pregúntale a Muse sobre patrones ✦",
    footer: "Por amor a los perros.",
    cardTitle: "Un guau para guardar.",
    download: "Descargar",
    share: "Compartir",
    mock: "Modo demo (simulación)",
    live: "En vivo · Muse Spark",
    sniff: "Olfateando las señales…",
    listenLoad: "Escuchando entre los guaus…",
    think: "Juntando las pistas…",
    prepare: "Preparando tu momento…",
    error: "No pudimos completar la solicitud. Intenta de nuevo.",
    confidence: "confianza de interpretación",
    actions: "Un poco de cuidado hace mucho",
    observed: "Observado",
    vet: "Atención veterinaria",
    speak: "♫ Leer en voz alta",
    card: "↗ Crear tarjeta",
    saved: "Guardado en tu diario",
    notSaved:
      "Almacenamiento no disponible o lleno. Esta lectura no se guardó.",
    empty: "Tu historia comienza con un pequeño momento. Prueba una lectura.",
    frequent: "Necesidades más frecuentes",
    time: "Momento del día",
    periods: ["Noche", "Mañana", "Tarde", "Nochecita"],
    recording: "Grabando… se detiene automáticamente a los 30 segundos.",
    denied:
      "Cámara o micrófono no disponible. Revisa los permisos o sube un archivo.",
    audio30:
      "Audio convertido a WAV mono; solo se envían los primeros 30 segundos.",
    framesAudio:
      "Video convertido en 4 fotogramas + los primeros 30 segundos de audio.",
    generating: "Creando algo digno de un guau…",
    fallback: "Tarjeta creada en tu navegador · alternativa ilustrada",
    imageLive: "Muse Image · tarjeta generada",
    confirmClear: "¿Borrar todo el diario de este navegador?",
    patternSending:
      "Solo se envían entradas resumidas a Muse; sin archivos multimedia.",
    signalNames: {
      bark: "Ladrido",
      tail: "Cola",
      ears: "Orejas",
      posture: "Postura",
      face: "Cara",
      body_other: "Otras señales",
    },
    labels: {
      hungry: "Hambre",
      play: "Quiere jugar",
      anxious: "Ansiedad",
      pain: "Posible malestar",
      alert: "Alerta",
      wants_out: "Quiere salir",
      attention: "Busca atención",
      happy: "Contento",
      tired: "Cansancio",
      fear: "Miedo",
      aggressive_warning: "Señales de advertencia",
      other: "Otro",
    },
  },
};
let lang;
try {
  lang = localStorage.getItem("perrito-lang");
} catch {}
if (!["en", "es"].includes(lang))
  lang = navigator.language.startsWith("es") ? "es" : "en";
let selected = null,
  current = null,
  entries = [],
  busy = false,
  previewURL,
  cardURL,
  cardBlob,
  recorder,
  stream,
  recordTimer,
  live = false;
try {
  const stored = JSON.parse(localStorage.getItem("perrito-diary") || "[]");
  if (Array.isArray(stored))
    entries = stored
      .filter(
        (e) =>
          e &&
          typeof e.phrase === "string" &&
          typeof e.label === "string" &&
          Number.isFinite(Date.parse(e.date)),
      )
      .slice(0, 100);
} catch {}
const t = (key) => words[lang][key];
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};

function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function status(message) {
  $("status").textContent = message;
}

function setLanguage() {
  document.documentElement.lang = lang;
  $("language").textContent = lang === "en" ? "ES" : "EN";
  $("language").setAttribute(
    "aria-label",
    lang === "en" ? "Cambiar a español" : "Switch to English",
  );
  // Accessible labels that are not visible text.
  const aria = {
    ".brand": ["PerritoTalk home", "Inicio de PerritoTalk"],
    nav: ["Main", "Principal"],
    "#cameraFiles": ["Camera clips", "Clips de cámara"],
    "#closeCard": ["Close", "Cerrar"],
  };
  for (const [sel, [en, es]] of Object.entries(aria))
    document
      .querySelector(sel)
      ?.setAttribute("aria-label", lang === "es" ? es : en);
  document.querySelectorAll("[data-i18n]").forEach((n) => {
    n.textContent = t(n.dataset.i18n);
    n.style.whiteSpace = "pre-line";
  });
  $("breed").placeholder = lang === "es" ? "Ej. Beagle" : "e.g. Beagle";
  $("age").placeholder = lang === "es" ? "Ej. 3 años" : "e.g. 3 years";
  $("situation").placeholder =
    lang === "es"
      ? "Ej. Esperando junto a la puerta tras cenar"
      : "e.g. Waiting by the door after dinner";
  $("mode").textContent = t(live ? "live" : "mock");
  if (current) renderResult(current);
  renderDiary();
  document.dispatchEvent(new Event("live-language"));
}
$("language").onclick = () => {
  lang = lang === "en" ? "es" : "en";
  try {
    localStorage.setItem("perrito-lang", lang);
  } catch {}
  setLanguage();
};

function tab(diary, camera = false, realtime = false) {
  $("liveView").hidden = !realtime;
  $("liveTab").classList.toggle("active", realtime);
  $("cameraView").hidden = !camera;
  $("cameraTab").classList.toggle("active", camera);
  $("reader").hidden = diary || camera || realtime;
  $("diaryView").hidden = !diary;
  $("readTab").classList.toggle("active", !diary && !camera && !realtime);
  $("diaryTab").classList.toggle("active", diary);
  if (diary) renderDiary();
}
$("readTab").onclick = () => tab(false);
$("diaryTab").onclick = () => tab(true);
$("cameraTab").onclick = () => tab(false, true);
$("liveTab").onclick = () => {
  tab(false, false, true);
  prewarmModels([
    "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite",
  ]);
};

function lock(value) {
  busy = value;
  for (const id of [
    "analyze",
    "deepAnalyze",
    "cameraFiles",
    "cameraRun",
    "cameraDemo",
    "cameraSave",
    "sample",
    "file",
    "recordVideo",
    "recordAudio",
    "recCamera",
    "recMic",
    "patterns",
    "language",
  ])
    $(id).disabled =
      value || (["analyze", "deepAnalyze"].includes(id) && !selected);
}

async function api(path, data, mock = false) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 105000);
  try {
    const response = await fetch(`/api/${path}${mock ? "?mock=1" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(t("error"));
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function choose(file) {
  if (!file || busy) return;
  lock(true);
  error("");
  status(t("prepare"));
  try {
    selected = null;
    const normalized = await normalize(file);
    if (
      normalized.media.reduce((n, m) => n + m.data_b64.length, 0) >
      20 * 1024 * 1024
    )
      throw new Error("15 MB media maximum.");
    selected = normalized;
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = URL.createObjectURL(file);
    const p = $("preview");
    p.replaceChildren();
    const type = file.type.startsWith("image/")
        ? "img"
        : file.type.startsWith("audio/")
          ? "audio"
          : "video",
      view = el(type);
    view.src = previewURL;
    if (type !== "img") {
      view.controls = true;
      view.playsInline = true;
    } else view.alt = lang === "es" ? "Imagen seleccionada" : "Selected image";
    p.append(
      view,
      el("p", file.name || (lang === "es" ? "Grabación" : "Recording")),
    );
    if (normalized.notice) p.append(el("p", t(normalized.notice)));
    p.hidden = false;
    status("");
  } catch (e) {
    error(e.message || t("error"));
    status("");
  } finally {
    lock(false);
  }
}
$("file").onchange = (e) => choose(e.target.files[0]);
$("drop").ondragover = (e) => {
  e.preventDefault();
  $("drop").classList.add("drag");
};
$("drop").ondragleave = () => $("drop").classList.remove("drag");
$("drop").ondrop = (e) => {
  e.preventDefault();
  $("drop").classList.remove("drag");
  choose(e.dataTransfer.files[0]);
};

async function record(video) {
  if (busy) return;
  error("");
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw new Error();
    stream = await openMedia({
      camera: $("recCamera").value,
      mic: $("recMic").value,
      video,
      defaultFacing: "environment",
    });
    if (video && (await disableCameraEffects(stream)))
      status(BLUR_NOTICE[lang]);
    const types = video
      ? ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"]
      : ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = types.find((x) => MediaRecorder.isTypeSupported(x));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearTimeout(recordTimer);
      stream?.getTracks().forEach((t) => t.stop());
      $("camera").srcObject = null;
      $("camera").hidden = true;
      $("stopRecord").hidden = true;
      lock(false);
      const type = recorder.mimeType;
      choose(
        new File(
          chunks,
          video
            ? "recording." + (type.includes("mp4") ? "mp4" : "webm")
            : "recording.audio",
          { type },
        ),
      );
    };
    recorder.onerror = () => {
      error(t("denied"));
      stopRecord();
    };
    if (video) {
      $("camera").hidden = false;
      $("camera").srcObject = stream;
      await $("camera").play();
    }
    lock(true);
    $("stopRecord").hidden = false;
    status(t("recording"));
    recorder.start();
    recordTimer = setTimeout(stopRecord, 30000);
  } catch {
    stream?.getTracks().forEach((t) => t.stop());
    lock(false);
    $("camera").hidden = true;
    error(t("denied"));
  }
}

function stopRecord() {
  if (recorder?.state === "recording") recorder.stop();
}
$("recordVideo").onclick = () => record(true);
$("recordAudio").onclick = () => record(false);
$("stopRecord").onclick = stopRecord;
window.addEventListener("pagehide", () => {
  stream?.getTracks().forEach((t) => t.stop());
  clearTimeout(recordTimer);
});

async function analyze(mock = false, deep = false) {
  if (!selected || busy) return;
  lock(true);
  error("");
  const requestLang = lang;
  let tick = 0;
  status(t("sniff"));
  $("status").classList.add("loading");
  const timer = setInterval(
    () => status(t(["sniff", "listenLoad", "think"][++tick % 3])),
    2400,
  );
  try {
    current = await api(
      "analyze",
      {
        lang: requestLang,
        source: "upload",
        deep,
        watcher: selected.watcher,
        context_mode: document.getElementById("uploadContextMode").value,
        baseline: baselineForRequest(),
        context: {
          breed: $("breed").value,
          age: $("age").value,
          situation: $("situation").value,
        },
        media: selected.media,
        acoustic_hints: selected.acoustic_hints,
      },
      mock,
    );
    current.lang = requestLang;
    renderResult(current);
    const entry = {
      date: new Date().toISOString(),
      label: current.primary.label,
      phrase: current.dog_says,
      thumbnail: selected.thumbnail,
      mode: current.mode,
      lang: requestLang,
      vet: current.vet_alert.flag,
    };
    entries.unshift(entry);
    entries = entries.slice(0, 100);
    let saved = true;
    try {
      localStorage.setItem("perrito-diary", JSON.stringify(entries));
    } catch {
      saved = false;
    }
    status(t(saved ? "saved" : "notSaved"));
    $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    error(e.message || t("error"));
    status("");
  } finally {
    clearInterval(timer);
    $("status").classList.remove("loading");
    lock(false);
  }
}
$("analyze").onclick = () => analyze();
$("sample").onclick = async () => {
  try {
    const blob = await (await fetch("/sample.svg")).blob();
    await choose(new File([blob], "sample.svg", { type: "image/svg+xml" }));
    await analyze(true);
  } catch {
    error(t("error"));
  }
};

function renderResult(r) {
  const root = $("result");
  root.replaceChildren();
  root.hidden = false;
  $("welcome").hidden = true;
  renderReading(root, r, { lang, media: selected?.media || [] });
  const buttons = el("div", undefined, "result-actions");
  if ("speechSynthesis" in window) {
    const speak = el("button", t("speak"));
    speak.onclick = () => {
      speechSynthesis.cancel();
      const voice = new SpeechSynthesisUtterance(dogLineFor(r, lang));
      voice.lang = lang === "es" ? "es-ES" : "en-US";
      speechSynthesis.speak(voice);
    };
    buttons.append(speak);
  }
  const card = el("button", t("card"));
  card.onclick = () => makeCard(r, card);
  buttons.append(card);
  root.append(buttons);
}

function renderDiary() {
  const stats = $("stats"),
    timeline = $("timeline");
  stats.replaceChildren();
  timeline.replaceChildren();
  $("patterns").disabled = busy || !entries.length;
  if (!entries.length) {
    stats.append(el("p", t("empty")));
    return;
  }
  const counts = {};
  entries.forEach((e) => (counts[e.label] = (counts[e.label] || 0) + 1));
  const needs = el("div");
  needs.append(el("h3", t("frequent")));
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .forEach(([key, count]) =>
      needs.append(el("p", `${t("labels")[key] || key} · ${count}`)),
    );
  const times = el("div");
  times.append(el("h3", t("time")));
  const groups = [0, 0, 0, 0];
  entries.forEach((e) => groups[Math.floor(new Date(e.date).getHours() / 6)]++);
  const bars = el("div", undefined, "bars");
  groups.forEach((n, i) => {
    const col = el("div", undefined, "bar-col"),
      bar = el("i");
    bar.style.height = `${(n / Math.max(1, ...groups)) * 75}%`;
    col.append(el("small", String(n)), bar, el("small", t("periods")[i]));
    bars.append(col);
  });
  times.append(bars);
  stats.append(needs, times);
  for (const entry of entries) {
    const row = el("article", undefined, "entry"),
      img = el("img");
    img.src = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(
      entry.thumbnail || "",
    )
      ? entry.thumbnail
      : "/sample.svg";
    img.alt = "";
    img.loading = "lazy";
    const text = el("div");
    text.append(
      el(
        "small",
        `${new Date(entry.date).toLocaleString(lang)} · ${t(entry.mode === "live" ? "live" : "mock")}`,
      ),
      el("strong", ` ${t("labels")[entry.label] || entry.label}`),
      el("p", entry.phrase),
    );
    row.append(img, text);
    timeline.append(row);
  }
}
$("clearDiary").onclick = () => {
  if (confirm(t("confirmClear"))) {
    entries = [];
    try {
      localStorage.removeItem("perrito-diary");
    } catch {}
    $("patternResult").hidden = true;
    renderDiary();
  }
};
$("patterns").onclick = async () => {
  if (busy || !entries.length) return;
  lock(true);
  error("");
  status(t("patternSending"));
  try {
    const result = await api("patterns", {
      lang,
      entries: entries.map(({ date, label, phrase, vet, mode }) => ({
        date,
        label,
        phrase,
        vet,
        mode,
      })),
    });
    const root = $("patternResult");
    root.replaceChildren(
      el("small", t(result.mode === "live" ? "live" : "mock")),
      el("h3", result.summary),
    );
    for (const list of [result.patterns, result.tips]) {
      const ul = el("ul");
      list.forEach((s) => ul.append(el("li", s)));
      root.append(ul);
    }
    root.append(el("p", result.vet_note));
    root.hidden = false;
    status("");
  } catch (e) {
    error(e.message);
    status("");
  } finally {
    lock(false);
  }
};

// Keep sharing available when image generation is unavailable or in demo mode.
async function canvasCard(r) {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f7f1e5";
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = "#e8dfbd";
  ctx.beginPath();
  ctx.arc(512, 400, 330, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(await loadImage("/sample.svg"), 262, 100, 500, 500);
  ctx.fillStyle = "#fffdf9";
  ctx.beginPath();
  ctx.roundRect(80, 610, 864, 270, 40);
  ctx.fill();
  ctx.fillStyle = "#293e35";
  ctx.font = "bold 38px system-ui";
  ctx.textAlign = "center";
  const words = (
      dogLineFor(r, lang) ||
      observedTexts(r, lang).join(" · ") ||
      (lang === "es" ? "Lectura incierta" : "Uncertain reading")
    ).split(/\s+/),
    lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (ctx.measureText(candidate).width > 760 && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  lines.push(line);
  if (lines.length > 4) {
    ctx.font = "bold 29px system-ui";
  }
  lines.slice(0, 5).forEach((s, i) => ctx.fillText(s, 512, 680 + i * 42, 780));
  ctx.font = "bold 26px system-ui";
  ctx.fillText(
    `PerritoTalk 🐾 · ${certaintyWord(r.certainty, lang)}`,
    512,
    955,
  );
  ctx.font = "17px system-ui";
  ctx.fillText(
    lang === "es"
      ? "Interpretación, no un diagnóstico."
      : "Interpretation, not a diagnosis.",
    512,
    990,
  );
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

async function makeCard(r, button) {
  button.disabled = true;
  status(t("generating"));
  error("");
  try {
    const result = await api(
      "card",
      {
        lang,
        dog_says:
          dogLineFor(r, lang) ||
          observedTexts(r, lang).join(" · ") ||
          (lang === "es" ? "Lectura incierta" : "Uncertain reading"),
        certainty: r.certainty,
        label: r.primary.label,
        emoji: r.primary.emoji,
      },
      r.mode === "mock",
    );
    if (result.b64_json) {
      const raw = atob(result.b64_json);
      cardBlob = new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], {
        type: result.mime,
      });
    } else cardBlob = await canvasCard(r);
    if (cardURL) URL.revokeObjectURL(cardURL);
    cardURL = URL.createObjectURL(cardBlob);
    $("cardImage").src = cardURL;
    $("download").href = cardURL;
    $("download").download =
      cardBlob.type === "image/jpeg" ? "perritotalk.jpg" : "perritotalk.png";
    $("cardMode").textContent = t(result.b64_json ? "imageLive" : "fallback");
    $("share").hidden = !navigator.share;
    $("cardDialog").showModal();
    status("");
  } catch (e) {
    error(e.message || t("error"));
    status("");
  } finally {
    button.disabled = false;
  }
}
$("closeCard").onclick = () => $("cardDialog").close();
$("share").onclick = async () => {
  const file = new File(
    [cardBlob],
    cardBlob.type === "image/jpeg" ? "perritotalk.jpg" : "perritotalk.png",
    { type: cardBlob.type },
  );
  try {
    if (navigator.canShare?.({ files: [file] }))
      await navigator.share({ title: "PerritoTalk", files: [file] });
    else
      await navigator.share({
        title: "PerritoTalk",
        text: current ? dogLineFor(current, lang) : "",
        url: "https://perritos.edevcore.com",
      });
  } catch (e) {
    if (e.name !== "AbortError") error(t("error"));
  }
};
setLanguage();
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    live = h.live;
    $("mode").textContent = t(live ? "live" : "mock");
  })
  .catch(() => {});

let cameraFiles = [],
  cameraReadings = [],
  cameraSaved = false;
$("cameraFiles").onchange = () => {
  if (busy) return;
  const files = [...$("cameraFiles").files];
  const root = $("cameraClips");
  root.replaceChildren();
  cameraFiles = [];
  if (
    files.length > 8 ||
    files.some(
      (f) => !f.type.startsWith("video/") && !/\.(mp4|mov|webm)$/i.test(f.name),
    )
  ) {
    $("cameraProgress").textContent =
      lang === "es" ? "Elige de 1 a 8 vídeos." : "Choose 1–8 videos.";
    return;
  }
  cameraFiles = files.map((file) => {
    const row = el("div", undefined, "panel");
    const timestamp = el("input");
    timestamp.type = "datetime-local";
    timestamp.step = "1";
    const date = new Date(file.lastModified);
    timestamp.value = new Date(
      date.getTime() - date.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 19);
    const timeLabel = el(
      "label",
      file.name + (lang === "es" ? " · Hora local" : " · Local time"),
    );
    timeLabel.append(timestamp);
    const context = el("textarea");
    context.maxLength = 1000;
    const contextLabel = el("label", t("cameraContext"));
    contextLabel.append(context);
    const progress = el("p");
    progress.setAttribute("role", "status");
    row.append(timeLabel, contextLabel, progress);
    root.append(row);
    return { file, timestamp, context, progress };
  });
};
async function runCamera(mock = false) {
  if (busy || !cameraFiles.length) return;
  lock(true);
  cameraReadings = [];
  cameraSaved = false;
  $("cameraSave").hidden = true;
  $("cameraResult").replaceChildren();
  cameraFiles.forEach((c) => {
    c.timestamp.disabled = true;
    c.context.disabled = true;
    c.progress.textContent = "";
  });
  try {
    const ordered = cameraFiles
      .map((c) => ({ ...c, ts: new Date(c.timestamp.value).toISOString() }))
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    for (const [i, c] of ordered.entries()) {
      const prefix = `${i + 1}/${ordered.length} · ${c.file.name}`;
      c.progress.textContent = `${prefix} · ${t("prepare")}`;
      const normalized = await normalize(c.file);
      c.progress.textContent = `${prefix} · ${normalized.notice ? t(normalized.notice) : ""} · ${t("think")}`;
      const r = await api(
        "analyze",
        {
          lang,
          source: "camera",
          watcher: normalized.watcher,
          context_mode: document.getElementById("cameraContextMode").value,
          baseline: baselineForRequest(),
          context: { situation: c.context.value },
          media: normalized.media,
          acoustic_hints: normalized.acoustic_hints,
        },
        mock,
      );
      cameraReadings.push({
        ts: c.ts,
        label: r.primary.label,
        confidence: r.primary.confidence,
        dog_says: r.dog_says,
        signals: r.signals,
        acoustic_hints: r.acoustic_hints ?? normalized.acoustic_hints,
        vet_alert: r.vet_alert,
        mode: r.mode,
        thumbnail: normalized.thumbnail,
        lang,
        reading: r,
        interpretations: r.interpretations,
        context_mode: r.context_mode,
        media: normalized.media,
      });
      c.progress.textContent = `${r.acoustic_hints ? `${heardText(r.acoustic_hints.class, lang)} · ` : ""}${prefix} · ${t(r.mode === "mock" ? "mock" : "live")} · ${normalized.notice ? t(normalized.notice) : "✓"}`;
    }
    $("cameraSave").hidden = false;
    $("cameraProgress").textContent = t("think");
    await summarizeCamera(mock);
  } catch (e) {
    $("cameraProgress").textContent = e.message || t("error");
    $("cameraSave").hidden = !cameraReadings.length;
  } finally {
    lock(false);
    cameraFiles.forEach((c) => {
      c.timestamp.disabled = false;
      c.context.disabled = false;
    });
  }
}
async function summarizeCamera(mock) {
  const clips = cameraReadings.map(
    ({ thumbnail, lang, media, reading, ...c }) => c,
  );
  const summary = await api("camera/summary", { lang, clips }, mock);
  const root = $("cameraResult");
  root.replaceChildren(
    el("p", t(summary.mode === "mock" ? "mock" : "live")),
    el("p", summary.overall),
  );
  summary.alerts = mergeAlerts(
    summary.alerts,
    cameraHeuristics({ lang, clips }),
  );
  for (const alert of summary.alerts) {
    if (
      alert.type === "pain_signs" &&
      cameraReadings.some((clip) => clip.reading?.vet_alert?.flag)
    )
      continue;
    const banner = el("div", undefined, `camera-alert ${alert.severity}`);
    const details = el("details");
    details.append(
      el("summary", lang === "es" ? "Detalles" : "Details"),
      el("p", alert.evidence),
    );
    banner.append(
      el("strong", alertTitle(alert.type, lang)),
      el("p", alert.advice.split(/\r?\n/)[0]),
      details,
    );
    root.append(banner);
  }
  const timeline = el("ol", undefined, "camera-timeline");
  for (const item of summary.timeline) {
    const row = el("li");
    const time = el("time", new Date(item.ts).toLocaleString(lang));
    time.dateTime = item.ts;
    row.append(
      time,
      el("h3", `${item.emoji} ${item.dog_says}`),
      el("p", item.note),
    );
    timeline.append(row);
  }
  root.append(timeline);
  for (const clip of cameraReadings) {
    const readingRoot = el("article");
    renderReading(readingRoot, clip.reading, {
      lang: clip.lang,
      media: clip.media,
    });
    root.append(readingRoot);
  }
  const recommendations = el("ul");
  summary.recommendations.forEach((r) => recommendations.append(el("li", r)));
  root.append(recommendations);
  $("cameraProgress").textContent = "";
}
$("cameraRun").onclick = () => runCamera();
$("cameraDemo").onclick = async () => {
  if (busy || !cameraReadings.length) return runCamera(true);
  lock(true);
  try {
    await summarizeCamera(true);
  } catch (e) {
    $("cameraProgress").textContent = e.message;
  } finally {
    lock(false);
  }
};
$("cameraSave").onclick = () => {
  if (busy || cameraSaved || !cameraReadings.length) return;
  const next = [
    ...cameraReadings.map((c) => ({
      date: c.ts,
      label: c.label,
      phrase: c.dog_says,
      thumbnail: c.thumbnail,
      mode: c.mode,
      lang: c.lang,
      vet: c.vet_alert.flag,
    })),
    ...entries,
  ]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 100);
  try {
    localStorage.setItem("perrito-diary", JSON.stringify(next));
    entries = next;
    cameraSaved = true;
    $("cameraSave").hidden = true;
    $("cameraProgress").textContent = t("saved");
    renderDiary();
  } catch {
    $("cameraProgress").textContent = t("notSaved");
  }
};
$("cameraStream").onclick = async () => {
  try {
    const response = await fetch("/api/camera/stream", { method: "POST" });
    const result = await response.json();
    $("cameraProgress").textContent =
      lang === "es"
        ? "Aún no implementado. Se necesita un puente local con ffmpeg (LAN/Raspberry Pi) para enviar clips MP4 de 10–15 s. Workers no consume RTSP directamente. Muse realtime: futuro. Consulta docs/camera-bridge.md."
        : result.plan;
  } catch {
    $("cameraProgress").textContent = t("error");
  }
};

mountDevicePicker({
  camSelect: $("recCamera"),
  micSelect: $("recMic"),
  getLang: () => lang,
  defaultFacing: "environment",
});
mountLive({
  getLang: () => lang,
  api,
  labelOf: (l) => words[lang].labels[l] || l.replaceAll("_", " "),
});

mountContext(
  document.getElementById("situation").closest("details").parentElement,
  () => lang,
  "uploadContextMode",
);
mountContext(
  document.getElementById("cameraFiles").parentElement,
  () => lang,
  "cameraContextMode",
);

function baselineForRequest() {
  let profile = "default";
  try {
    profile = localStorage.getItem("watcherDog") || profile;
  } catch {}
  return createBaseline(profile).summary();
}

$("deepAnalyze").onclick = () => analyze(false, true);
