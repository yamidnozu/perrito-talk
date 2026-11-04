import { createMotionHold, createPresenceHold } from "./watcher/motion.js";
import {
  certaintyWord,
  stateLabel,
  observedTexts,
  behaviorSummary,
} from "./evidence-utils.js";
import { cameraHeuristics, alertTitle } from "./camera-heuristics.js";
import { createFlight } from "./watcher/flight.js";
import { newAlerts, preliminarySummary, selectLiveMedia } from "./live-logic.js";
import { mountDevicePicker, openMedia, videoConstraints } from "./devices.js";
import { startAudio } from "./watcher/audio.js";
import { startVision } from "./watcher/vision.js";
import { createWatcher } from "./watcher/state.js";
import { decide, savedCalls } from "./watcher/triggers.js";
import { createPreroll } from "./watcher/preroll.js";
import { PARAMETERS, loadEvidence } from "./watcher/evidence-config.js";
import { createBaseline } from "./watcher/baseline.js";
import {
  evidenceReady,
  renderReading,
  mountContext,
  contextName,
} from "./reading-ui.js";
/** Localized "🔊 heard: …" chip text for an acoustic hint or vocalization type. */
function modelLine(f, tr) {
  const m = f.modelStatus;
  if (!m || m.state === "loading")
    return `⏳ ${tr("Loading models…", "Cargando modelos…")}`;
  if (m.state === "failed")
    return `⚠️ ${tr("Detector unavailable", "Detector no disponible")}`;
  return `✅ ${tr("Models ready", "Modelos listos")}${m.ms ? ` (${(m.ms / 1000).toFixed(1)} s)` : ""}`;
}

export function heardText(kind, lang) {
  const es = {
    yip: "ladrido agudo",
    dog: "perro",
    none: "sin vocalización",
    howl: "aullido",
    whine_whimper: "quejido",
    whine: "quejido",
    bark: "ladrido",
    cry: "llanto",
    growl: "gruñido",
    music_or_noise: "música o ruido",
    silence: "silencio",
    unclear: "incierto",
  };
  const en = { whine_whimper: "whine", music_or_noise: "music or noise" };
  return lang === "es"
    ? `🔊 se oye: ${es[kind] || kind.replaceAll("_", " ")}`
    : `🔊 heard: ${en[kind] || kind.replaceAll("_", " ")}`;
}

export { RAW_AUDIO } from "./devices.js";

/**
 * Turns off OS/browser camera effects (background blur, face framing, eye-gaze
 * correction) when the track exposes them. Returns true if blur is still on,
 * e.g. because Windows Studio Effects or macOS applies it outside the browser.
 */
export async function disableCameraEffects(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return false;
  const caps = track.getCapabilities?.() || {};
  for (const effect of ["backgroundBlur", "faceFraming", "eyeGazeCorrection"]) {
    if (!(effect in caps)) continue;
    try {
      await track.applyConstraints({ [effect]: false });
    } catch {}
  }
  try {
    return track.getSettings?.().backgroundBlur === true;
  } catch {
    return false;
  }
}

export const BLUR_NOTICE = {
  en: "Your system is blurring the camera; turn it off in Windows/macOS camera effects.",
  es: "Tu sistema está aplicando desenfoque a la cámara; desactívalo en los efectos de cámara de Windows/macOS.",
};

export function mountLive({ getLang, api, labelOf = (x) => x }) {
  const root = document.getElementById("liveView"),
    tr = (en, es) => (getLang() === "es" ? es : en);
  // Judge-first order: start, see the camera, get a reading. Engineering knobs and
  // raw meters live in collapsed sections so nothing looks like a debug console.
  root.innerHTML = `<h2 id="liveTitle"></h2><p id="liveHelp"></p>
  <div class="live-controls live-primary">
    <button id="liveStart" class="live-start"></button><button id="liveStop" disabled></button>
    <label><span id="liveCameraLabel"></span><select id="liveCamera"></select></label>
    <label><span id="liveMicLabel"></span><select id="liveMic"></select></label>
  </div>
  <div class="live-stage"><video id="liveVideo" playsinline muted autoplay></video><canvas id="liveZone"></canvas><div id="liveOverlay" aria-live="polite"></div></div>
  <div class="live-now"><button id="liveAnalyze" class="live-analyze" disabled></button>
    <p id="liveStep" class="live-step" role="status" aria-live="polite"></p>
    <section id="liveResult" class="live-result" aria-live="polite" hidden></section></div>
  <p id="liveCounter" role="status"></p><p id="liveStatus" role="status"></p>
  <p id="liveBlur" class="notice" role="alert" hidden></p>
  <p id="liveBanner" role="alert" hidden></p>
  <details class="live-more"><summary id="liveAdvancedLabel"></summary>
  <div class="live-controls">
    <label><span id="liveCheckinLabel"></span><input id="liveCheckin" type="number" min="0" max="600" value="${PARAMETERS.checkinSeconds}"></label>
    <label><span id="liveMaxLabel"></span><input id="liveMax" type="number" min="1" max="100" value="20"></label>
    <label><span id="liveSensitivityLabel"></span><select id="liveSensitivity"><option value="low"></option><option value="medium"></option><option value="high"></option></select></label>
    <label><span id="liveSustainedLabel"></span><input id="liveSustained" type="number" min="2" max="5" value="2"></label>
    <label><span id="liveDogLabel"></span><input id="liveDog" maxlength="80" value="default"></label>
    <button id="liveDrawZone"></button><button id="liveClearZone"></button>
  </div></details>
  <details class="live-more"><summary id="liveTechLabel"></summary>
  <div class="watcher-meters"><strong id="liveState"></strong>
    <label><span id="liveRmsLabel"></span><meter id="liveRms" min="0" max="1" value="0"></meter><span id="liveRmsValue"></span></label>
    <p id="liveSound"></p><p id="liveMotion"></p><p id="livePresence"></p><p id="liveDetector"></p><p id="liveVocal"></p><p id="liveRelative"></p>
  </div></details>
  <h3 id="liveTimelineLabel" class="live-timeline-title"></h3><ol id="liveTimeline" aria-live="polite"></ol>`;
  const $ = (id) => document.getElementById(id),
    video = $("liveVideo"),
    zoneCanvas = $("liveZone");
  mountContext(
    root.querySelector(".live-controls"),
    getLang,
    "liveContextMode",
  );
  // Keep stacks of uncaught errors for diagnosis (headless tests read this).
  window.__liveErrors = [];
  const keepError = (error) => {
    window.__liveErrors.push(String(error?.stack || error?.message || error));
    if (window.__liveErrors.length > 20) window.__liveErrors.shift();
  };
  window.addEventListener("error", (e) => keepError(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => keepError(e.reason));
  let active = null,
    config = PARAMETERS,
    zone = null,
    drawing = false,
    anchor = null;
  const debug = () => ({
    state: null,
    events: [],
    triggers: [],
    aiCalls: 0,
    saved: 0,
    samVerifiedSkips: 0,
    features: [],
  });
  window.__watcher = debug();
  void evidenceReady.then((evidence) => {
    if (evidence) {
      try {
        config = loadEvidence(evidence);
      } catch {}
    }
    refresh();
  });
  try {
    $("liveSensitivity").value =
      localStorage.getItem("watcherSensitivity") || "medium";
    $("liveDog").value = localStorage.getItem("watcherDog") || "default";
  } catch {}
  const controls = [
    "liveMic",
    "liveMax",
    "liveCheckin",
    "liveSensitivity",
    "liveSustained",
    "liveDog",
    "liveContextMode",
  ];
  function setStatus(en, es) {
    $("liveStatus").localMessage = [en, es];
    $("liveStatus").textContent = tr(en, es);
  }
  function stateName(value) {
    if (!value) return tr("Calibrating…", "Calibrando…");
    const [state, voice] = value.split(":");
    const names = {
      absent: ["🐾 Dog absent", "🐾 Perro ausente"],
      still: ["💤 Still", "💤 Quieto"],
      active: ["🐕 Active", "🐕 Activo"],
      restless: [
        "🐾 Much movement (proxy)",
        "🐾 Mucho movimiento (indicador aproximado)",
      ],
      at_zone: ["📍 In zone", "📍 En zona"],
      vocalization: ["🔊 Vocalization", "🔊 Vocalización"],
    };
    return (
      (names[state]?.[getLang() === "es" ? 1 : 0] ||
        tr("Observation", "Observación")) +
      (voice ? ` · ${heardText(voice, getLang())}` : "")
    );
  }
  const clock = (t) =>
    new Date(t).toLocaleTimeString(getLang(), {
      timeZone: "America/Bogota",
      hour12: false,
    });
  function refresh() {
    const s = active,
      f = s?.features || {},
      debug = window.__watcher,
      now = performance.now();
    if (s)
      debug.saved = savedCalls(now, { ...s, used: debug.aiCalls }, s.config);
    $("liveStep").textContent =
      stepText(s, now) +
      (s?.flight?.queued
        ? tr(" · 🔁 Manual reading queued", " · 🔁 Lectura manual en cola")
        : "");
    $("liveAnalyze").disabled = !s?.buffer || !!s?.flight?.queued;
    $("liveCounter").textContent =
      `${tr("AI calls", "Llamadas a IA")}: ${debug.aiCalls}/${s?.max || $("liveMax").value} · ${tr("AI calls saved", "Llamadas a IA ahorradas")}: ${debug.saved} · ${tr("Verified by SAM, Spark skipped", "Verificado por SAM, Spark omitido")}: ${debug.samVerifiedSkips}`;
    $("liveState").textContent =
      `${stateName(debug.state)}${(s?.config || config).source === "provisional" ? " · provisional" : ""}${s?.machine?.state ? ` · ${Math.floor((now - s.machine.since) / 1000)} s` : ""}`;
    $("liveRms").value = f.rms || 0;
    $("liveRmsValue").textContent = (f.rms || 0).toFixed(3);
    const top = Object.entries(f.scores || {})
      .filter(([key]) => key !== "dog")
      .sort((a, b) => b[1] - a[1])[0];
    $("liveSound").textContent =
      `${tr("Sound", "Sonido")}: ${top?.[1] ? heardText(top[0], getLang()) : tr("unclear", "incierto")} · ${f.audioStatus === "yamnet" ? `${tr("model confidence in the sound", "confianza del modelo en el sonido")}: ${Math.round((top?.[1] || 0) * 100)}%` : `${tr("heuristic certainty", "certeza heurística")}: ${certaintyWord(f.acousticHints?.certainty || "especulativa", getLang())}`}`;
    $("liveMotion").textContent =
      `${tr("Motion", "Movimiento")}: ${(s?.rawMotion || 0).toFixed(3)} · ${tr("Centroid displacement", "Desplazamiento del centroide")}: ${(f.centroidShift || 0).toFixed(3)}`;
    $("livePresence").textContent =
      `${f.dogPresent == null ? `${tr("Dog", "Perro")}: ${tr("unknown (motion only)", "desconocido (solo movimiento)")}` : f.dogPresent ? `✅ ${tr("Dog detected", "Perro detectado")}${f.dogLabel && f.dogLabel !== "dog" ? ` (${tr("seen as", "visto como")} ${f.dogLabel})` : ""}` : `⬜ ${tr("Dog not detected", "Perro no detectado")}`} · ${tr("detector score", "puntaje del detector")}: ${(f.dogScore || 0).toFixed(2)}`;
    $("liveDetector").textContent =
      `${modelLine(f, tr)} · ${tr("Detectors", "Detectores")}: ${f.audioStatus === "yamnet" ? "YAMNet" : tr("acoustics fallback", "acústica alternativa")} / ${f.visionStatus === "mediapipe" ? `EfficientDet${f.modelStatus?.delegate ? ` (${f.modelStatus.delegate})` : ""}` : tr("motion only", "solo movimiento")}`;
    const minutes = s?.vocalSince != null ? (now - s.vocalSince) / 60000 : 0;
    $("liveVocal").textContent =
      `${tr("Bursts", "Tandas")}: ${s?.bursts || 0} · ${tr("Continuous vocalization (minutes)", "Vocalización continua (minutos)")}: ${minutes.toFixed(2)}`;
    const relative =
      s?.baseline.relative(f.acousticHints?.metrics.pitch_hz) || "unknown";
    $("liveRelative").textContent =
      `${tr("Pitch compared with this dog's baseline", "Tono frente a la línea base de este perro")}: ${{ lower: ["lower than usual", "más grave de lo habitual"], higher: ["higher than usual", "más agudo de lo habitual"], usual: ["usual", "habitual"], unknown: ["not established", "sin establecer"] }[relative][getLang() === "es" ? 1 : 0]}`;
  }
  function reasonText(types = []) {
    const names = {
      first_look: ["dog stably detected", "perro detectado de forma estable"],
      checkin: ["periodic check-in", "chequeo periódico"],
      manual: ["manual request", "pedido manual"],
      vocal_start: ["vocalization started", "empezó a vocalizar"],
      vocal_sustained: ["sustained vocalization", "vocalización sostenida"],
      dog_enter: ["dog entered", "el perro entró"],
      dog_exit: ["dog left", "el perro salió"],
      state_change: ["state changed", "cambió el estado"],
      motion_spike: ["motion spike", "pico de movimiento"],
      heartbeat: ["heartbeat", "comprobación"],
    };
    return types
      .map((x) => names[x]?.[getLang() === "es" ? 1 : 0] || x)
      .join(" + ");
  }
  function errorText(step) {
    const sec = Math.round((active?.config || config).analyzeTimeoutMs / 1000);
    return {
      timeout: tr(
        `⚠️ The AI took longer than ${sec} s (2 attempts). Tap “Analyze now” to retry.`,
        `⚠️ La IA tardó más de ${sec} s (2 intentos). Toca «Analizar ahora» para reintentar.`,
      ),
      server: tr(
        `⚠️ Could not analyze (server or network error, 2 attempts)${step.detail ? `: ${step.detail}` : ""}. Tap “Analyze now” to retry.`,
        `⚠️ No se pudo analizar (error del servidor o de red, 2 intentos)${step.detail ? `: ${step.detail}` : ""}. Toca «Analizar ahora» para reintentar.`,
      ),
      clip: tr(
        "⚠️ Could not prepare the clip from the camera. Check camera and microphone.",
        "⚠️ No se pudo preparar el clip de la cámara. Revisa cámara y micrófono.",
      ),
      limit: tr(
        "⚠️ Session analysis limit reached. Raise “Max analyses” and restart.",
        "⚠️ Se alcanzó el máximo de análisis de la sesión. Súbelo y reinicia.",
      ),
    }[step.code];
  }
  function stepText(s, now) {
    if (!s) return "";
    const st = s.step || {},
      secs = Math.max(0, Math.floor((now - (st.since || now)) / 1000));
    const f = s.features || {},
      gates = s.baseline?.gates?.() || {};
    const watching = () => {
      const top = Object.entries(f.scores || {})
        .filter(([k]) => k !== "dog")
        .sort((a, b) => b[1] - a[1])[0];
      const next =
        s.presentSince != null &&
        s.lastTrigger !== undefined &&
        s.checkinSeconds
          ? ` · ${tr("next check-in", "próximo chequeo")} ${Math.max(0, Math.ceil((Math.max(s.lastTrigger, s.presentSince) + s.checkinSeconds * 1000 - now) / 1000))} s`
          : "";
      // Plain-language status; raw levels/gates stay in the technical panel.
      const dog = f.dogPresent
        ? tr("dog in view", "perro a la vista")
        : tr("looking for your dog", "buscando a tu perro");
      const heard = top?.[1] ? ` · ${heardText(top[0], getLang())}` : "";
      const calib = gates.ready
        ? ""
        : ` · ${tr("calibrating", "calibrando")} ${Math.min(10, Math.floor((now - s.startedAt) / 1000))}/10 s`;
      return `👀 ${tr("Watching", "Vigilando")}: ${dog}${heard}${calib}${next}`;
    };
    switch (st.kind) {
      case "change":
        return `⚡ ${tr("Change detected", "Cambio detectado")}: ${reasonText(st.reasons)} · ${tr("recording", "grabando")} ${Math.max(0, Math.ceil((st.post - (now - st.since)) / 1000))} s`;
      case "analyzing":
        return `⏳ ${tr("Analyzing…", "Analizando…")} ${secs} s${st.attempt > 1 ? ` · ${tr("retry", "reintento")} ${st.attempt - 1}` : ""}`;
      case "error":
        return `${errorText(st)} · ${watching()}`;
      case "result":
        return `✅ ${tr("Reading ready", "Lectura lista")} (${((st.ms || 0) / 1000).toFixed(1)} s) · ${watching()}`;
      default:
        return watching();
    }
  }
  function labels() {
    for (const [id, en, es] of [
      ["liveTitle", "Watcher", "Vigilante"],
      [
        "liveHelp",
        "Point the camera at your dog and press Start. The phone watches on-device for free; when your dog appears, barks or moves, it sends a 10 s clip to Muse Spark and shows what it sees and what the science says.",
        "Apunta la cámara a tu perro y pulsa Iniciar. El teléfono observa gratis en el dispositivo; cuando tu perro aparece, ladra o se mueve, envía un clip de 10 s a Muse Spark y te muestra qué hace y qué dice la ciencia.",
      ],
      ["liveAdvancedLabel", "Advanced settings", "Ajustes avanzados"],
      [
        "liveTechLabel",
        "Live technical data (on-device sensors)",
        "Datos técnicos en vivo (sensores del dispositivo)",
      ],
      ["liveTimelineLabel", "Readings", "Lecturas"],
      ["liveCameraLabel", "Camera", "Cámara"],
      ["liveMicLabel", "Microphone", "Micrófono"],
      [
        "liveCheckinLabel",
        "Check-in while dog present (s; 0 = off)",
        "Chequeo con perro presente (s; 0 = apagado)",
      ],
      ["liveAnalyze", "🔍 Analyze now", "🔍 Analizar ahora"],
      ["liveMaxLabel", "Max analyses", "Máximo de análisis"],
      ["liveSensitivityLabel", "Sensitivity", "Sensibilidad"],
      [
        "liveSustainedLabel",
        "Sustained voice (2–5 min)",
        "Vocalización sostenida (2–5 min)",
      ],
      [
        "liveDogLabel",
        "Dog baseline profile",
        "Perfil de línea base del perro",
      ],
      ["liveStart", "Start", "Iniciar"],
      ["liveStop", "Stop", "Detener"],
      ["liveRmsLabel", "Audio level (RMS)", "Nivel de audio (RMS)"],
      ["liveDrawZone", "Draw zone", "Dibujar zona"],
      ["liveClearZone", "Clear zone", "Borrar zona"],
    ])
      $(id).textContent = tr(en, es);
    for (const o of $("liveSensitivity").options)
      o.textContent = {
        low: ["Low", "Baja"],
        medium: ["Medium", "Media"],
        high: ["High", "Alta"],
      }[o.value][getLang() === "es" ? 1 : 0];
    if (!$("liveBlur").hidden)
      $("liveBlur").textContent = BLUR_NOTICE[getLang()] || BLUR_NOTICE.en;
    for (const row of $("liveTimeline").children) row.updateLanguage?.();
    const message = $("liveStatus").localMessage;
    if (message) setStatus(...message);
    $("liveOverlay").updateLanguage?.();
    $("liveResult").updateLanguage?.();
    $("liveBanner").updateLanguage?.();
    refresh();
  }
  document.addEventListener("live-language", labels);
  labels();
  $("liveSensitivity").onchange = () => {
    try {
      localStorage.setItem("watcherSensitivity", $("liveSensitivity").value);
    } catch {}
  };
  mountDevicePicker({
    camSelect: $("liveCamera"),
    micSelect: $("liveMic"),
    getLang,
    defaultFacing: "user",
    onCamera: (value) => {
      if (active?.stream) void swapCamera(active, value);
    },
  });
  function watchEnded(s, track) {
    track.onended = () => {
      if (active === s) {
        stop();
        setStatus(
          "Camera or microphone disconnected.",
          "Cámara o micrófono desconectado.",
        );
      }
    };
  }
  async function swapCamera(s, value) {
    let fresh;
    try {
      fresh = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(value),
      });
      if (active !== s) {
        fresh.getTracks().forEach((t) => t.stop());
        return;
      }
      const old = s.stream.getVideoTracks();
      s.stream = new MediaStream([
        ...fresh.getVideoTracks(),
        ...s.stream.getAudioTracks(),
      ]);
      $("liveBlur").hidden = !(await disableCameraEffects(s.stream));
      $("liveBlur").textContent = BLUR_NOTICE[getLang()] || BLUR_NOTICE.en;
      video.srcObject = s.stream;
      await video.play();
      old.forEach((t) => t.stop());
      fresh.getTracks().forEach((track) => watchEnded(s, track));
      s.vision.reset();
      s.motionHold.reset();
      s.presenceHold.reset();
      s.buffer.resetFrames();
      s.buffer.startVideo(s.stream);
      s.machine = createWatcher({
        sensitivity: s.sensitivity,
        config: s.config,
        now: () => performance.now(),
      });
      setStatus("Camera switched", "Cámara cambiada");
    } catch {
      fresh?.getTracks().forEach((t) => t.stop());
      setStatus("Could not switch camera.", "No se pudo cambiar de cámara.");
    }
  }
  function rowFor(local = false) {
    const row = document.createElement("li");
    if (local) row.className = "live-local";
    $("liveTimeline").prepend(row);
    while ($("liveTimeline").children.length > 100)
      $("liveTimeline").lastChild.remove();
    return row;
  }
  function localEvent(event, s) {
    const row = rowFor(true),
      end = Date.now(),
      start = end - (event.duration || 0) * 1000;
    row.updateLanguage = () => {
      row.textContent = `${clock(start)}–${clock(end)} · ${event.type === "baseline" ? tr("Baseline", "Línea base") : tr("Observed change", "Cambio observado")}: ${stateName(event.prev)} → ${stateName(event.next)} · ${contextName(s.contextMode, getLang())}`;
    };
    row.updateLanguage();
  }
  function stop() {
    const s = active;
    if (s) {
      window.__watcher.saved = savedCalls(
        performance.now(),
        { ...s, used: window.__watcher.aiCalls },
        s.config,
      );
      clearTimeout(s.postroll);
      s.flight?.clear();
      clearInterval(s.frameTimer);
      clearInterval(s.uiTimer);
      s.audioCapture?.stop();
      s.vision?.stop();
      s.buffer?.stop();
      s.stream?.getTracks().forEach((t) => t.stop());
      s.audio?.close().catch(() => {});
    }
    active = null;
    video.srcObject = null;
    $("liveStop").disabled = true;
    $("liveStart").disabled = false;
    controls.forEach((id) => ($(id).disabled = false));
    setStatus("Stopped", "Detenido");
  }
  $("liveStop").onclick = stop;
  window.addEventListener("pagehide", stop);
  function draw() {
    const rect = video.getBoundingClientRect();
    zoneCanvas.width = rect.width;
    zoneCanvas.height = rect.height;
    const ctx = zoneCanvas.getContext("2d");
    const box = (r, color) => {
      if (!r) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(
        r[0] * rect.width,
        r[1] * rect.height,
        r[2] * rect.width,
        r[3] * rect.height,
      );
    };
    box(active?.features.bbox, "#72e5a1");
    if (active?.sam?.dogs > 0 && active.sam.box) {
      ctx.setLineDash([6, 4]);
      box(active.sam.box, "#69baff");
      ctx.setLineDash([]);
      ctx.fillStyle = "#69baff";
      ctx.font = "14px system-ui";
      ctx.fillText(
        tr("SAM 3.1 · analyzed clip", "SAM 3.1 · clip analizado"),
        active.sam.box[0] * rect.width,
        Math.max(16, active.sam.box[1] * rect.height),
      );
    }
    box(zone, "#ffbf69");
  }
  $("liveDrawZone").onclick = () => {
    drawing = true;
    zoneCanvas.classList.add("drawing");
  };
  $("liveClearZone").onclick = () => {
    zone = null;
    draw();
  };
  const point = (e) => {
    const r = zoneCanvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  };
  zoneCanvas.onpointerdown = (e) => {
    if (!drawing) return;
    anchor = point(e);
    zoneCanvas.setPointerCapture(e.pointerId);
  };
  zoneCanvas.onpointermove = (e) => {
    if (!anchor) return;
    const end = point(e);
    zone = [
      Math.min(anchor[0], end[0]),
      Math.min(anchor[1], end[1]),
      Math.abs(end[0] - anchor[0]),
      Math.abs(end[1] - anchor[1]),
    ];
    draw();
  };
  zoneCanvas.onpointerup = () => {
    anchor = null;
    drawing = false;
    zoneCanvas.classList.remove("drawing");
  };
  zoneCanvas.onpointercancel = zoneCanvas.onpointerup;
  window.addEventListener("resize", draw);
  function evaluate(s) {
    if (active !== s) return;
    // Guard: sensors can report before start() has built the machine/baseline,
    // and after a camera switch or stop.
    if (active !== s || !s.machine || !s.baseline) return;
    const t = performance.now(),
      f = s.features;
    // Calibrate locally before baseline selection; continuous vocal input must
    // not postpone initialization indefinitely. A stably present dog still gets its
    // first reading during calibration (first_look needs no state change).
    const calibrating =
      !s.machine.state &&
      !s.baseline.gates().ready &&
      t - s.startedAt < s.config.calibration.initialWaitMs;
    const result = calibrating
      ? { state: s.machine.state, events: [] }
      : s.machine.update(
          {
            ...f,
            motion: s.motionHold.value(t),
            dogPresent: s.presenceHold.value(t),
            zone,
          },
          t,
        );
    if (!result) return;
    window.__watcher.state = result.state ?? null;
    for (const event of (result.events || []).filter(
      (e) => e.type !== "observation",
    )) {
      window.__watcher.events.push({ ...event, t: t - s.startedAt });
      if (window.__watcher.events.length > 1000)
        window.__watcher.events.shift();
      localEvent(event, s);
    }
    for (const trigger of decide(result.events || [], t, s, s.config))
      fire(s, trigger, t, result.state);
  }
  function metadataFor(s, trigger, t, state) {
    const f = s.features;
    return {
      trigger: trigger.type,
      trigger_types: trigger.types,
      sound_scores: { ...f.scores },
      prev_state: trigger.prev ?? state ?? null,
      new_state: trigger.next ?? state ?? "calibrating",
      time_in_prev_state_s: trigger.duration || 0,
      yamnet: f.yamnet || [],
      motion: s.rawMotion || 0,
      observations: {
        vocal_type: state?.startsWith("vocalization:")
          ? state.split(":")[1]
          : "none",
        bursts: s.bursts,
        sustained_s: s.vocalSince === null ? 0 : (t - s.vocalSince) / 1000,
        activity: state?.split(":")[0] || "unknown",
      },
      centroid_shift: f.centroidShift || 0,
      bbox: f.bbox || null,
      dog_present: f.dogPresent ?? null,
      detector:
        f.audioStatus === "yamnet" && f.visionStatus === "mediapipe"
          ? "mediapipe"
          : "fallback",
    };
  }
  const QUICK = ["first_look", "manual", "checkin"];
  function fire(s, trigger, t, state) {
    window.__watcher.triggers.push({
      type: trigger.type,
      types: trigger.types,
      t: t - s.startedAt,
      prev: trigger.prev,
      next: trigger.next,
      ...(trigger.merged ? { merged: true } : {}),
    });
    const metadata = metadataFor(s, trigger, t, state);
    if (trigger.merged && s.pendingWatcher) {
      const reasons = [
        ...new Set([...s.pendingWatcher.trigger_types, ...trigger.types]),
      ];
      const previous = s.pendingWatcher.prev_state;
      const duration = s.pendingWatcher.time_in_prev_state_s;
      Object.assign(s.pendingWatcher, metadata, {
        trigger: s.pendingWatcher.trigger,
        trigger_types: reasons,
        prev_state: previous,
        time_in_prev_state_s: duration,
      });
      showPreliminary(s);
      return;
    }
    // Engineering decision: change triggers collect 6 s after the trigger. First-look,
    // check-in and manual readings use more pre-roll and a short post-roll so the
    // reading starts within seconds; the clip is still 10 s long.
    // First look right after Start: wait until the clip holds minClipMs of real
    // media (a 2 s clip missed barks that started a moment later).
    const post = trigger.types.some((x) => QUICK.includes(x))
      ? Math.max(
          s.config.firstLook.postMs,
          (s.config.firstLook.minClipMs || 0) - (t - s.startedAt),
        )
      : 6000;
    const clipAt = t + post - 6000;
    const id = s.flight.acquire();
    if (id === null) return; // another reading owns the lock
    s.pendingUntil = t + post;
    s.pendingWatcher = metadata;
    s.step = { kind: "change", reasons: trigger.types, since: t, post };
    showPreliminary(s);
    refresh();
    s.postroll = setTimeout(() => void submit(s, metadata, clipAt, id), post);
  }
  // Instant on-device observation while the AI clip is prepared and analyzed.
  // Strictly local state (presence/activity/sound); the AI card replaces it.
  function showPreliminary(s) {
    if (active !== s || !s.pendingWatcher) return;
    const meta = s.pendingWatcher;
    const card = $("liveResult");
    card.hidden = false;
    card.updateLanguage = () => {
      const lang = getLang(),
        prelim = preliminarySummary(meta, lang);
      card.replaceChildren();
      const badge = document.createElement("small");
      badge.className = "badge prelim";
      badge.textContent = prelim.badge;
      const head = document.createElement("p");
      head.className = "prelim-head";
      head.textContent = `⏳ ${prelim.title} · ${reasonText(meta.trigger_types)}`;
      card.append(badge, head);
      const list = document.createElement("ul");
      for (const line of prelim.lines) {
        const li = document.createElement("li");
        li.textContent = line;
        list.append(li);
      }
      card.append(list);
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = prelim.note;
      card.append(note);
    };
    card.updateLanguage();
    if (!s.pendingRow) {
      const row = rowFor(true);
      s.pendingRow = row;
      const at = Date.now();
      row.updateLanguage = () => {
        const prelim = preliminarySummary(meta, getLang());
        row.textContent =
          `${new Date(at).toLocaleTimeString(getLang(), { timeZone: "America/Bogota", hour12: false })} · ${prelim.badge.split("·")[0].trim()}: ${prelim.title} — ${prelim.lines.join(" · ")}`;
      };
      row.updateLanguage();
    } else s.pendingRow.updateLanguage?.();
    const overlay = $("liveOverlay");
    overlay.updateLanguage = () => {
      const prelim = preliminarySummary(meta, getLang());
      overlay.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = `${prelim.title} (${getLang() === "es" ? "preliminar" : "preliminary"})`;
      overlay.append(title);
    };
    overlay.updateLanguage();
    if (window.__watcher.prelimMs == null)
      window.__watcher.prelimMs = performance.now() - s.startedAt;
  }
  function manual(s) {
    if (active !== s || !s.buffer) return;
    if (s.flight.busy) {
      // Check-in/trigger already running: queue one manual reading after it.
      s.flight.enqueue({ type: "manual" });
      return refresh();
    }
    if (s.used >= s.max) {
      s.step = { kind: "error", code: "limit", since: performance.now() };
      return refresh();
    }
    const t = performance.now();
    s.lastTrigger = t;
    s.used++;
    s.lastByType ||= {};
    s.lastByType.manual = t;
    fire(s, { type: "manual", types: ["manual"] }, t, s.machine?.state ?? null);
  }
  $("liveAnalyze").onclick = () => manual(active);
  async function submit(s, watcher, t, id) {
    if (active !== s) return void s.flight?.release(id);
    delete s.pendingUntil;
    delete s.pendingWatcher;
    const row = s.pendingRow || rowFor();
    s.pendingRow = null;
    row.className = "";
    row.updateLanguage = () => {
      row.textContent = tr("Analyzing…", "Analizando…");
    };
    row.updateLanguage();
    s.step = { kind: "analyzing", since: performance.now() };
    refresh();
    let clip;
    // Diagnostics: proves readings never overlap (must stay <= 1).
    window.__watcher.running = (window.__watcher.running || 0) + 1;
    window.__watcher.maxRunning = Math.max(
      window.__watcher.maxRunning || 0,
      window.__watcher.running,
    );
    try {
      clip = await s.buffer.build(t);
      if (active !== s) return;
      window.__watcher.aiCalls++;
      // The server forwards the native video plus the WAV to Spark on the live
      // path, so auxiliary keyframes are dead upload weight once a video exists.
      const sendMedia = selectLiveMedia(clip.media);
      window.__watcher.lastPayload = {
        items: sendMedia.map((m) => m.kind),
        bytes: sendMedia.reduce((n, m) => n + (m.data_b64?.length || 0), 0),
      };
      const body = {
        lang: getLang(),
        source: "live",
        context: {},
        context_mode: s.contextMode,
        ...clip,
        media: sendMedia,
        watcher,
        baseline: s.baseline.summary(),
      };
      const dry =
        new URLSearchParams(location.search).get("watcher-dry") === "1";
      // Never hang silently: per-attempt timeout, one retry, then a visible error.
      let r, lastError;
      for (let attempt = 1; attempt <= 2 && !r; attempt++) {
        s.step.attempt = attempt;
        try {
          r = await api("analyze", body, dry, s.config.analyzeTimeoutMs);
        } catch (e) {
          lastError = e;
          if (active !== s) return;
        }
      }
      if (!r) throw lastError;
      if (active !== s) return;
      if (r.sam?.frames_checked > 0) {
        s.sam = r.sam;
        draw();
      }
      if (r.skipped && r.reason === "sam_no_dog") {
        window.__watcher.aiCalls--;
        window.__watcher.samVerifiedSkips++;
        s.used--;
        row.className = "live-local";
        row.updateLanguage = () => {
          row.textContent = `${clock(Date.now())} · ${tr("No dog visible (SAM 3.1)", "No se ve un perro (SAM 3.1)")}`;
        };
        row.updateLanguage();
        window.__watcher.events.push({
          type: "sam_no_dog",
          t: performance.now() - s.startedAt,
        });
        return;
      }
      row.className = `live-ai ${r.primary.label}`;
      // On-device detector state at clip time; only used to explain an empty reading.
      const noDog = !s.features.dogPresent;
      const ts = new Date().toISOString();
      row.updateLanguage = () => {
        renderReading(row, r, { lang: getLang(), media: clip.media, noDog });
      };
      row.updateLanguage();
      const card = $("liveResult");
      card.hidden = false;
      card.updateLanguage = () => {
        renderReading(card, r, { lang: getLang(), media: clip.media, noDog });
        const when = document.createElement("small");
        when.className = "live-result-when";
        when.textContent = `${clock(Date.now())} · ${reasonText(watcher.trigger_types)}`;
        card.prepend(when);
      };
      card.updateLanguage();
      s.step = {
        kind: "result",
        since: performance.now(),
        ms: performance.now() - s.step.since,
      };
      window.__watcher.readings = (window.__watcher.readings || 0) + 1;
      const overlay = $("liveOverlay");
      overlay.updateLanguage = () => {
        overlay.replaceChildren();
        // Lead with what the dog is doing; a state only when evidence supports one.
        const lang = getLang(),
          top = r.interpretations?.[0];
        const title = document.createElement("strong");
        title.textContent =
          behaviorSummary(r, lang) ||
          (noDog
            ? tr("No dog in view", "No se ve un perro")
            : tr("Couldn't see clearly", "No se vio con claridad"));
        overlay.append(title);
        const meaning = document.createElement("span");
        meaning.textContent =
          top && top.state !== "unspecified"
            ? `${r.primary.emoji} ${stateLabel(top.state, lang)} · ${certaintyWord(r.certainty, lang)}`
            : tr(
                "No emotion claimed: no evidence rule matched",
                "Sin emoción atribuida: ninguna regla de evidencia coincide",
              );
        overlay.append(meaning);
      };
      overlay.updateLanguage();
      s.clips.push({
        ts,
        label: r.primary.label,
        confidence: r.primary.confidence,
        dog_says: r.dog_says,
        signals: r.signals,
        vet_alert: r.vet_alert,
        interpretations: r.interpretations,
        context_mode: s.contextMode,
      });
      for (const alert of newAlerts(
        cameraHeuristics({ lang: getLang(), clips: s.clips }),
        s.seen,
      )) {
        const message = `${alertTitle(alert.type, getLang())} · ${alert.advice}`;
        if (alert.type !== "pain_signs") $("liveBanner").hidden = false;
        $("liveBanner").updateLanguage = () => {
          const translated = cameraHeuristics({
            lang: getLang(),
            clips: s.clips,
          }).find((a) => a.type === alert.type);
          if (translated && alert.type !== "pain_signs")
            $("liveBanner").textContent =
              `${alertTitle(translated.type, getLang())} · ${translated.advice}`;
        };
        $("liveBanner").updateLanguage();
        if (r.mode !== "mock") {
          try {
            if (
              "Notification" in window &&
              Notification.permission === "granted"
            )
              new Notification("PerritoTalk", { body: message });
          } catch {}
          try {
            navigator.vibrate?.([200, 100, 200]);
          } catch {}
        }
      }
    } catch (e) {
      if (active === s) {
        const code =
          e?.name === "AbortError" ? "timeout" : clip ? "server" : "clip";
        s.step = {
          kind: "error",
          code,
          detail: e?.message || "",
          since: performance.now(),
        };
        window.__watcher.errors = (window.__watcher.errors || 0) + 1;
        row.updateLanguage = () => {
          row.textContent = errorText(s.step);
        };
        row.updateLanguage();
      }
    } finally {
      window.__watcher.running--;
      const next = s.flight.release(id);
      if (active === s && s.used >= s.max) {
        stop();
        setStatus("Session limit reached.", "Límite de sesión alcanzado.");
      } else if (next && active === s) manual(s);
      refresh();
    }
  }
  $("liveStart").onclick = async () => {
    if (active) return;
    const max = Number($("liveMax").value),
      checkin = Number($("liveCheckin").value),
      sustained = Number($("liveSustained").value);
    if (
      !Number.isInteger(max) ||
      max < 1 ||
      max > 100 ||
      !Number.isFinite(checkin) ||
      checkin < 0 ||
      checkin > 600 ||
      (checkin > 0 && checkin < 20) ||
      !Number.isFinite(sustained) ||
      sustained < 2 ||
      sustained > 5
    ) {
      setStatus(
        "Use 1–100 analyses, a 0 or 20–600 s check-in and 2–5 sustained minutes.",
        "Usa 1–100 análisis, chequeo de 0 o 20–600 s y 2–5 minutos sostenidos.",
      );
      return;
    }
    const sensitivity = $("liveSensitivity").value;
    const s = (active = {
      startedAt: performance.now(),
      used: 0,
      max,
      heartbeat: 0,
      checkinSeconds: checkin,
      presentSince: null,
      step: { kind: "start", since: performance.now() },
      flight: createFlight(),
      get inFlight() {
        return this.flight.busy;
      },
      sensitivity,
      config: { ...config, sustainedVocalMs: sustained * 60000 },
      features: { dogPresent: null },
      clips: [],
      seen: new Map(),
      bursts: 0,
      vocalSince: null,
      lastVoice: null,
      contextMode: $("liveContextMode").value,
    });
    s.motionHold = createMotionHold(s.config);
    s.presenceHold = createPresenceHold(s.config);
    window.__watcher = debug();
    $("liveTimeline").replaceChildren();
    $("liveOverlay").replaceChildren();
    $("liveOverlay").updateLanguage = null;
    $("liveResult").replaceChildren();
    $("liveResult").hidden = true;
    $("liveResult").updateLanguage = null;
    $("liveBanner").updateLanguage = null;
    $("liveBanner").hidden = true;
    $("liveStart").disabled = true;
    $("liveStop").disabled = false;
    controls.forEach((id) => ($(id).disabled = true));
    setStatus(
      "Requesting camera and microphone…",
      "Solicitando cámara y micrófono…",
    );
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("Media unavailable");
      if ("Notification" in window && Notification.permission === "default")
        Notification.requestPermission().catch(() => {});
      const AC = window.AudioContext || window.webkitAudioContext;
      s.audio = new AC();
      await s.audio.resume();
      const stream = await openMedia({
        camera: $("liveCamera").value,
        mic: $("liveMic").value,
        defaultFacing: "user",
      });
      if (active !== s) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      s.stream = stream;
      s.startedAt = performance.now();
      $("liveBlur").hidden = !(await disableCameraEffects(stream));
      $("liveBlur").textContent = BLUR_NOTICE[getLang()] || BLUR_NOTICE.en;
      video.srcObject = stream;
      await video.play();
      if (active !== s) return;
      stream.getTracks().forEach((track) => watchEnded(s, track));
      s.buffer = createPreroll();
      s.buffer.startVideo(stream);
      s.baseline = createBaseline($("liveDog").value, s.config);
      try {
        localStorage.setItem("watcherDog", $("liveDog").value);
      } catch {}
      s.machine = createWatcher({
        config: s.config,
        sensitivity,
        now: () => performance.now(),
      });
      s.audioCapture = await startAudio({
        context: s.audio,
        stream,
        config: s.config,
        onPCM: (pcm, t) => s.buffer.pushPCM(pcm, t),
        onFeatures: (features) => {
          if (active !== s) return;
          Object.assign(s.features, features);
          const t = performance.now();
          const vocal = s.config.vocalSignals.some(
            (key) => features.scores[key] > 0,
          );
          const envelopeDelta = Math.max(
            0,
            features.envelopeBursts - (s.lastEnvelopeBursts || 0),
          );
          s.lastEnvelopeBursts = features.envelopeBursts;
          const pulseDelta = Math.max(
            0,
            features.envelopeCount - (s.lastEnvelopeCount || 0),
          );
          s.lastEnvelopeCount = features.envelopeCount;
          s.barkCount =
            (s.barkCount || 0) + (features.scores.bark > 0 ? pulseDelta : 0);
          if (vocal && features.rms >= s.config.dsp.rmsFloor) {
            s.vocalSince ??= t;
            s.bursts += envelopeDelta;
          } else s.vocalSince = null;
          const metrics = features.acousticHints.metrics;
          if (features.scores.bark > 0 && s.features.dogPresent)
            s.baseline.add({
              pitch: metrics.pitch_hz,
              peak: features.peakHz || metrics.pitch_hz,
              hnr: metrics.hnr || 0,
              rate: (s.barkCount * 60000) / Math.max(1000, t - s.startedAt),
              motion: s.rawMotion || 0,
            });
          // Engineering calibration: update from quiet audio only, and retain raw
          // motion rather than feeding the already-gated value back into its gate.
          if (!vocal && features.rms <= s.config.dsp.rmsFloor)
            s.baseline.ambient(features.rms, s.rawMotion || 0);
          const gates = s.baseline.gates();
          // Engineering gates adapt to ambient noise; never infer an emotion.
          if (features.rms < gates.rms) s.features.scores = {};
          window.__watcher.features.push({
            t: t - s.startedAt,
            motion: s.rawMotion,
            held_motion: s.motionHold.value(t),
            motion_gate: s.baseline.gates().motion,
            dog_present: s.features.dogPresent,
            held_presence: s.presenceHold.value(t),
            rms: features.rms,
            scores: features.scores,
            yamnet: features.yamnet,
            audio: features.audioStatus,
            vision: s.features.visionStatus,
            dog_via: s.features.dogVia,
            low_light: s.features.lowLight,
            detect_ms: s.features.detectMs,
            detector_model: s.features.detectorModel,
            visionError: s.features.visionError,
          });
          if (window.__watcher.features.length > 300)
            window.__watcher.features.shift();
          evaluate(s);
          refresh();
        },
      });
      if (active !== s) {
        s.audioCapture.stop();
        return;
      }
      s.vision = startVision({
        video,
        sensitivity,
        config: s.config,
        onFeatures: (features) => {
          if (active !== s) return;
          if (
            s.features.visionStatus &&
            s.features.visionStatus !== features.visionStatus
          )
            s.machine = createWatcher({
              config: s.config,
              sensitivity,
              now: () => performance.now(),
            });
          Object.assign(s.features, features);
          const held = s.presenceHold.update(
            features.dogPresent,
            performance.now(),
          );
          if (held === true) s.presentSince ??= performance.now();
          else s.presentSince = null;
          const gate = s.baseline.gates().motion;
          // The state machine receives ambient-adjusted motion; UI retains raw energy.
          s.rawMotion = features.motion;
          s.features.motion = s.motionHold.update(
            features.motion >= gate ? features.motion : 0,
            performance.now(),
          );
          evaluate(s);
          draw();
        },
      });
      s.frameTimer = setInterval(
        () => void s.buffer.capture(video, performance.now()),
        1000,
      );
      void s.buffer.capture(video, performance.now());
      s.uiTimer = setInterval(refresh, 1000);
      setStatus("Watching on this device", "Vigilando en este dispositivo");
      refresh();
    } catch {
      if (active !== s) return;
      stop();
      setStatus(
        "Could not start. Allow camera/microphone access and use HTTPS.",
        "No se pudo iniciar. Permite acceso a cámara/micrófono y usa HTTPS.",
      );
    }
  };
}
