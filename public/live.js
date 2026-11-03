import { createMotionHold, createPresenceHold } from "./watcher/motion.js";
import { certaintyWord, stateLabel, observedTexts } from "./evidence-utils.js";
import { cameraHeuristics, alertTitle } from "./camera-heuristics.js";
import { newAlerts } from "./live-logic.js";
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
  root.innerHTML = `<h2 id="liveTitle"></h2><p id="liveHelp"></p>
  <div class="live-controls">
    <label><span id="liveCameraLabel"></span><select id="liveCamera"></select></label>
    <label><span id="liveMicLabel"></span><select id="liveMic"></select></label>
    <label><span id="liveHeartbeatLabel"></span><input id="liveHeartbeat" type="number" min="0" max="60" value="0"></label>
    <label><span id="liveMaxLabel"></span><input id="liveMax" type="number" min="1" max="100" value="20"></label>
    <label><span id="liveSensitivityLabel"></span><select id="liveSensitivity"><option value="low"></option><option value="medium"></option><option value="high"></option></select></label>
    <label><span id="liveSustainedLabel"></span><input id="liveSustained" type="number" min="2" max="5" value="2"></label>
    <label><span id="liveDogLabel"></span><input id="liveDog" maxlength="80" value="default"></label>
    <button id="liveStart"></button><button id="liveStop" disabled></button>
  </div>
  <p id="liveCounter" role="status"></p><p id="liveStatus" role="status"></p>
  <p id="liveBlur" class="notice" role="alert" hidden></p>
  <div class="watcher-meters"><strong id="liveState"></strong>
    <label><span id="liveRmsLabel"></span><meter id="liveRms" min="0" max="1" value="0"></meter><span id="liveRmsValue"></span></label>
    <p id="liveSound"></p><p id="liveMotion"></p><p id="livePresence"></p><p id="liveDetector"></p><p id="liveVocal"></p><p id="liveRelative"></p>
  </div>
  <div class="live-stage"><video id="liveVideo" playsinline muted autoplay></video><canvas id="liveZone"></canvas><div id="liveOverlay" aria-live="polite"></div></div>
  <div class="live-controls"><button id="liveDrawZone"></button><button id="liveClearZone"></button></div>
  <p id="liveBanner" role="alert" hidden></p><ol id="liveTimeline" aria-live="polite"></ol>`;
  const $ = (id) => document.getElementById(id),
    video = $("liveVideo"),
    zoneCanvas = $("liveZone");
  mountContext(
    root.querySelector(".live-controls"),
    getLang,
    "liveContextMode",
  );
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
    "liveHeartbeat",
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
    $("liveCounter").textContent =
      `${tr("AI calls", "Llamadas a IA")}: ${debug.aiCalls}/${s?.max || $("liveMax").value} · ${tr("AI calls saved", "Llamadas a IA ahorradas")}: ${debug.saved} · ${tr("Verified by SAM, Spark skipped", "Verificado por SAM, Spark omitido")}: ${debug.samVerifiedSkips}`;
    $("liveState").textContent =
      `${stateName(debug.state)}${(s?.config || config).source === "provisional" ? " · provisional" : ""}${s?.machine.state ? ` · ${Math.floor((now - s.machine.since) / 1000)} s` : ""}`;
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
  function labels() {
    for (const [id, en, es] of [
      ["liveTitle", "Watcher", "Vigilante"],
      [
        "liveHelp",
        "Free on-device observations. Only triggers send a 4 s + 6 s clip to Muse Spark. Numeric gates are engineering settings, not validated behavior thresholds.",
        "Observaciones gratuitas en el dispositivo. Solo los disparadores envían un clip de 4 s + 6 s a Muse Spark. Los umbrales son ajustes de ingeniería, no límites de conducta validados.",
      ],
      ["liveCameraLabel", "Camera", "Cámara"],
      ["liveMicLabel", "Microphone", "Micrófono"],
      [
        "liveHeartbeatLabel",
        "Heartbeat (minutes; 0 = off)",
        "Comprobación (minutos; 0 = apagada)",
      ],
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
    const t = performance.now(),
      f = s.features;
    // Calibrate locally before baseline selection; continuous vocal input must
    // not postpone initialization indefinitely.
    if (
      !s.machine.state &&
      !s.baseline.gates().ready &&
      t - s.startedAt < s.config.calibration.initialWaitMs
    )
      return;
    const result = s.machine.update(
      {
        ...f,
        motion: s.motionHold.value(t),
        dogPresent: s.presenceHold.value(t),
        zone,
      },
      t,
    );
    window.__watcher.state = result.state;
    for (const event of result.events.filter((e) => e.type !== "observation")) {
      window.__watcher.events.push({ ...event, t: t - s.startedAt });
      if (window.__watcher.events.length > 1000)
        window.__watcher.events.shift();
      localEvent(event, s);
    }
    const triggers = decide(result.events, t, s, s.config);
    for (const trigger of triggers) {
      window.__watcher.triggers.push({
        type: trigger.type,
        types: trigger.types,
        t: t - s.startedAt,
        prev: trigger.prev,
        next: trigger.next,
        ...(trigger.merged ? { merged: true } : {}),
      });
      const metadata = {
        trigger: trigger.type,
        trigger_types: trigger.types,
        sound_scores: { ...f.scores },
        prev_state: trigger.prev,
        new_state: trigger.next,
        time_in_prev_state_s: trigger.duration || 0,
        yamnet: f.yamnet || [],
        motion: s.rawMotion || 0,
        observations: {
          vocal_type: result.state?.startsWith("vocalization:")
            ? result.state.split(":")[1]
            : "none",
          bursts: s.bursts,
          sustained_s: s.vocalSince === null ? 0 : (t - s.vocalSince) / 1000,
          activity: result.state?.split(":")[0] || "unknown",
        },
        centroid_shift: f.centroidShift || 0,
        bbox: f.bbox || null,
        dog_present: f.dogPresent ?? null,
        detector:
          f.audioStatus === "yamnet" && f.visionStatus === "mediapipe"
            ? "mediapipe"
            : "fallback",
      };
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
        continue;
      }
      s.inFlight = true;
      s.pendingUntil = t + 6000;
      s.pendingWatcher = metadata;
      // Engineering decision: collect six seconds after the observed trigger.
      s.postroll = setTimeout(() => void submit(s, metadata, t), 6000);
    }
  }
  async function submit(s, watcher, t) {
    if (active !== s) return;
    delete s.pendingUntil;
    delete s.pendingWatcher;
    const row = rowFor();
    row.updateLanguage = () => {
      row.textContent = tr("Analyzing…", "Analizando…");
    };
    row.updateLanguage();
    try {
      const clip = await s.buffer.build(t);
      if (active !== s) return;
      window.__watcher.aiCalls++;
      const r = await api(
        "analyze",
        {
          lang: getLang(),
          source: "live",
          context: {},
          context_mode: s.contextMode,
          ...clip,
          watcher,
          baseline: s.baseline.summary(),
        },
        new URLSearchParams(location.search).get("watcher-dry") === "1",
      );
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
      const ts = new Date().toISOString();
      row.updateLanguage = () => {
        renderReading(row, r, { lang: getLang(), media: clip.media });
      };
      row.updateLanguage();
      const overlay = $("liveOverlay");
      overlay.updateLanguage = () => {
        overlay.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = `${r.primary.emoji} ${r.interpretations?.[0] ? stateLabel(r.interpretations[0].state, getLang()) : labelOf(r.primary.label)} · ${certaintyWord(r.certainty, getLang())}`;
        overlay.append(title);
        const observed = document.createElement("span");
        observed.textContent = observedTexts(r, getLang()).join(" · ");
        overlay.append(observed);
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
    } catch {
      if (active === s) {
        row.updateLanguage = () => {
          row.textContent = tr("Analysis failed.", "Falló el análisis.");
        };
        row.updateLanguage();
      }
    } finally {
      s.inFlight = false;
      if (active === s && s.used >= s.max) {
        stop();
        setStatus("Session limit reached.", "Límite de sesión alcanzado.");
      }
      refresh();
    }
  }
  $("liveStart").onclick = async () => {
    if (active) return;
    const max = Number($("liveMax").value),
      heartbeat = Number($("liveHeartbeat").value),
      sustained = Number($("liveSustained").value);
    if (
      !Number.isInteger(max) ||
      max < 1 ||
      max > 100 ||
      !Number.isFinite(heartbeat) ||
      heartbeat < 0 ||
      heartbeat > 60 ||
      !Number.isFinite(sustained) ||
      sustained < 2 ||
      sustained > 5
    ) {
      setStatus(
        "Use 1–100 analyses, 0–60 heartbeat minutes and 2–5 sustained minutes.",
        "Usa 1–100 análisis, 0–60 minutos de comprobación y 2–5 minutos sostenidos.",
      );
      return;
    }
    const sensitivity = $("liveSensitivity").value;
    const s = (active = {
      startedAt: performance.now(),
      used: 0,
      max,
      heartbeat,
      inFlight: false,
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
          s.presenceHold.update(features.dogPresent, performance.now());
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
