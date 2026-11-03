import { normalize } from "./media.js";
import { cameraHeuristics, mergeAlerts } from "./camera-heuristics.js";
import {
  frameDifference,
  rms,
  shouldAnalyze,
  reserveAnalysis,
  newAlerts,
} from "./live-logic.js";

export function mountLive({ getLang, api }) {
  const root = document.getElementById("liveView");
  const tr = (en, es) => (getLang() === "es" ? es : en);
  root.innerHTML = `<h2 id="liveTitle"></h2><p id="liveHelp"></p>
    <div class="live-controls"><label><span id="liveCameraLabel"></span><select id="liveCamera"><option value="user"></option><option value="environment"></option></select></label>
    <label><span id="liveIntervalLabel"></span><input id="liveInterval" type="number" min="10" max="15" value="12"></label>
    <label><span id="liveMaxLabel"></span><input id="liveMax" type="number" min="1" max="100" value="20"></label>
    <button id="liveStart"></button><button id="liveStop" disabled></button></div>
    <p id="liveCounter" role="status">0 / 20</p><p id="liveStatus" role="status"></p>
    <div class="live-stage"><video id="liveVideo" playsinline muted autoplay></video><div id="liveOverlay" aria-live="polite"></div></div>
    <p id="liveBanner" role="alert" hidden></p><ol id="liveTimeline" aria-live="polite"></ol>`;
  const $ = (id) => document.getElementById(id);
  let active = null,
    processing = false;
  function labels() {
    for (const [id, en, es] of [
      ["liveTitle", "Live mode", "Modo en vivo"],
      [
        "liveHelp",
        "Camera + microphone. Segments are sent for analysis; quiet segments are skipped. Keep this tab visible.",
        "Cámara y micrófono. Se envían segmentos para analizar; se omiten los silenciosos sin movimiento. Mantén esta pestaña visible.",
      ],
      ["liveCameraLabel", "Camera", "Cámara"],
      ["liveIntervalLabel", "Interval (seconds)", "Intervalo (segundos)"],
      ["liveMaxLabel", "Max analyses", "Máximo de análisis"],
      ["liveStart", "Start", "Iniciar"],
      ["liveStop", "Stop", "Detener"],
    ])
      $(id).textContent = tr(en, es);
    $("liveCamera").options[0].textContent = tr("Front", "Frontal");
    $("liveCamera").options[1].textContent = tr("Back", "Trasera");
  }
  labels();
  document.addEventListener("live-language", labels);
  function tick(text, ts = new Date().toISOString()) {
    const li = document.createElement("li");
    li.textContent = `${new Date(ts).toLocaleTimeString()} · ${text}`;
    $("liveTimeline").prepend(li);
    while ($("liveTimeline").children.length > 100)
      $("liveTimeline").lastChild.remove();
    return li;
  }
  function stop() {
    const s = active;
    active = null;
    if (s) {
      clearTimeout(s.timer);
      clearInterval(s.sampleTimer);
      if (s.recorder?.state !== "inactive") s.recorder?.stop();
      s.stream?.getTracks().forEach((t) => t.stop());
      s.audio?.close().catch(() => {});
    }
    $("liveVideo").srcObject = null;
    $("liveStatus").textContent = tr("Stopped", "Detenido");
    $("liveStop").disabled = true;
    $("liveStart").disabled = processing;
    for (const id of ["liveCamera", "liveInterval", "liveMax"])
      $(id).disabled = false;
  }
  $("liveStop").onclick = stop;
  window.addEventListener("pagehide", stop);
  async function submit(s, blob, motion, sound, ts) {
    if (!shouldAnalyze(motion, sound)) {
      tick(tr("skipped (quiet)", "omitido (sin movimiento ni sonido)"), ts);
      return;
    }
    if (!reserveAnalysis(s)) {
      tick(tr("dropped (busy)", "descartado (ocupado)"), ts);
      return;
    }
    processing = true;
    $("liveCounter").textContent = `${s.used} / ${s.max}`;
    const row = tick(tr("Analyzing…", "Analizando…"), ts);
    try {
      const normalized = await normalize(
        new File(
          [blob],
          blob.type.startsWith("video/mp4") ? "live.mp4" : "live.webm",
          { type: blob.type.split(";")[0] },
        ),
        s.interval,
      );
      if (active !== s) {
        row.textContent = tr("Stopped", "Detenido");
        return;
      }
      const r = await api("analyze", {
        lang: s.lang,
        source: "live",
        context: {},
        media: normalized.media,
      });
      if (active !== s) {
        row.textContent = tr("Stopped", "Detenido");
        return;
      }
      const demo = r.mode === "mock" ? tr(" · DEMO", " · DEMOSTRACIÓN") : "";
      row.textContent = `${new Date(ts).toLocaleTimeString()} · ${r.primary.emoji} ${r.dog_says}${demo}`;
      const overlay = $("liveOverlay");
      overlay.replaceChildren();
      for (const text of [
        `${r.primary.emoji} ${r.dog_says}${demo}`,
        `${Math.round(r.primary.confidence * 100)}%${r.low_confidence || r.primary.confidence < 0.4 ? tr(" · Low confidence", " · Baja confianza") : ""}`,
        ...r.primary.evidence.slice(0, 2),
        r.signals.vocalization.description,
      ]) {
        const p = document.createElement("p");
        p.textContent = text;
        overlay.append(p);
      }
      if (r.low_confidence || r.primary.confidence < 0.4) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = tr("Low confidence", "Baja confianza");
        overlay.append(badge);
      }
      s.clips.push({
        ts,
        label: r.primary.label,
        confidence: r.primary.confidence,
        dog_says: r.dog_says,
        signals: r.signals,
        vet_alert: r.vet_alert,
      });
      const voice = r.signals.vocalization;
      const distress =
        voice.present && ["whine", "cry", "howl"].includes(voice.type)
          ? [
              {
                type: "distress_vocalization",
                severity: "warning",
                evidence: voice.description,
                advice: tr(
                  "Check on your dog.",
                  "Comprueba cómo está tu perro.",
                ),
              },
            ]
          : [];
      const alerts = newAlerts(
        mergeAlerts(
          distress,
          cameraHeuristics({ lang: s.lang, clips: s.clips }),
        ),
        s.seen,
      );
      for (const alert of alerts) {
        const message = `${alert.evidence} ${alert.advice}${demo}`;
        $("liveBanner").hidden = false;
        $("liveBanner").textContent = message;
        tick(message, ts);
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
      row.textContent = `${new Date(ts).toLocaleTimeString()} · ${tr("Analysis failed", "Falló el análisis")}: ${e.message}`;
    } finally {
      s.inFlight = false;
      processing = false;
      if (active === s && s.used >= s.max) {
        stop();
        $("liveStatus").textContent = tr(
          "Session limit reached.",
          "Límite de sesión alcanzado.",
        );
      }
      if (!active) $("liveStart").disabled = false;
    }
  }
  function record(s) {
    if (active !== s) return;
    s.motion = 0;
    s.sound = 0;
    const chunks = [],
      ts = new Date().toISOString();
    const recorder = (s.recorder = new MediaRecorder(
      s.stream,
      s.mime ? { mimeType: s.mime, videoBitsPerSecond: 800000 } : {},
    ));
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => {
      $("liveStatus").textContent = tr(
        "Recording failed. Try another camera/browser.",
        "Falló la grabación. Prueba otra cámara o navegador.",
      );
      stop();
    };
    recorder.onstop = () => {
      if (active !== s) return;
      const motion = s.motion,
        sound = s.sound;
      try {
        record(s);
      } catch {
        recorder.onerror();
        return;
      }
      if (chunks.length)
        void submit(
          s,
          new Blob(chunks, { type: recorder.mimeType }),
          motion,
          sound,
          ts,
        );
    };
    recorder.start();
    s.timer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, s.interval * 1000);
  }
  $("liveStart").onclick = async () => {
    if (active || processing) return;
    const interval = Number($("liveInterval").value),
      max = Number($("liveMax").value);
    if (
      !Number.isInteger(interval) ||
      interval < 10 ||
      interval > 15 ||
      !Number.isInteger(max) ||
      max < 1 ||
      max > 100
    ) {
      $("liveStatus").textContent = tr(
        "Use 10–15 seconds and 1–100 analyses.",
        "Usa 10–15 segundos y 1–100 análisis.",
      );
      return;
    }
    const s = (active = {
      used: 0,
      max,
      interval,
      lang: getLang(),
      inFlight: false,
      clips: [],
      seen: new Map(),
      motion: 0,
      sound: 0,
    });
    $("liveStart").disabled = true;
    $("liveStop").disabled = false;
    for (const id of ["liveCamera", "liveInterval", "liveMax"])
      $(id).disabled = true;
    $("liveTimeline").replaceChildren();
    $("liveOverlay").replaceChildren();
    $("liveBanner").hidden = true;
    $("liveCounter").textContent = `0 / ${max}`;
    $("liveStatus").textContent = tr(
      "Requesting camera and microphone…",
      "Solicitando cámara y micrófono…",
    );
    try {
      if (
        !window.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        !window.MediaRecorder
      )
        throw new Error(
          tr(
            "Use HTTPS and a browser with camera recording support.",
            "Usa HTTPS y un navegador con soporte de grabación.",
          ),
        );
      if ("Notification" in window && Notification.permission === "default") {
        try {
          Notification.requestPermission().catch(() => {});
        } catch {}
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC)
        throw new Error(
          tr(
            "Audio monitoring unavailable.",
            "Monitor de audio no disponible.",
          ),
        );
      s.audio = new AC();
      await s.audio.resume();
      if (active !== s) return;
      const facing = $("liveCamera").value;
      let acquired;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: facing },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: true,
        });
      } catch (e) {
        if (!["OverconstrainedError", "NotFoundError"].includes(e.name))
          throw e;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === "videoinput");
        const camera =
          cameras.find((d) =>
            (facing === "environment"
              ? /back|rear|environment/i
              : /front|user|facetime/i
            ).test(d.label),
          ) || cameras[facing === "environment" ? cameras.length - 1 : 0];
        acquired = await navigator.mediaDevices.getUserMedia({
          video: camera
            ? { deviceId: { exact: camera.deviceId } }
            : { facingMode: facing },
          audio: true,
        });
      }
      if (active !== s) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      s.stream = acquired;
      $("liveVideo").srcObject = acquired;
      await $("liveVideo").play();
      if (active !== s) return;
      const safari =
        /Safari/i.test(navigator.userAgent) &&
        !/Chrome|Chromium|CriOS|Android/i.test(navigator.userAgent);
      const types = safari
        ? ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"]
        : ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
      s.mime = types.find((m) => MediaRecorder.isTypeSupported(m));
      const analyser = s.audio.createAnalyser();
      analyser.fftSize = 1024;
      s.audio.createMediaStreamSource(acquired).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 48;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let previous;
      s.sampleTimer = setInterval(() => {
        try {
          ctx.drawImage($("liveVideo"), 0, 0, 64, 48);
          const pixels = ctx.getImageData(0, 0, 64, 48).data;
          s.motion = Math.max(s.motion, frameDifference(previous, pixels));
          previous = pixels;
          analyser.getFloatTimeDomainData(samples);
          s.sound = Math.max(s.sound, rms(samples));
        } catch {
          s.motion = 1;
        }
      }, 500);
      acquired.getTracks().forEach((track) => {
        track.onended = () => {
          if (active === s) {
            stop();
            $("liveStatus").textContent = tr(
              "Camera or microphone disconnected.",
              "Cámara o micrófono desconectado.",
            );
          }
        };
      });
      record(s);
      $("liveStatus").textContent = tr("Recording", "Grabando");
    } catch (e) {
      if (active !== s) return;
      stop();
      $("liveStatus").textContent = [
        "NotAllowedError",
        "SecurityError",
      ].includes(e.name)
        ? tr(
            "Camera/microphone permission denied. Allow both in browser settings, then Start.",
            "Permiso de cámara/micrófono denegado. Permite ambos en ajustes del navegador e inicia.",
          )
        : e.message;
    }
  };
}
