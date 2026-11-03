export const MOTION_THRESHOLD = 0.025;
export const RMS_THRESHOLD = 0.02;
export function frameDifference(previous, current) {
  if (!previous || previous.length !== current.length) return 1;
  let sum = 0;
  for (let i = 0; i < current.length; i += 4)
    sum +=
      Math.abs(current[i] - previous[i]) +
      Math.abs(current[i + 1] - previous[i + 1]) +
      Math.abs(current[i + 2] - previous[i + 2]);
  return sum / ((current.length / 4) * 3 * 255);
}
export function rms(samples) {
  return Math.sqrt(
    samples.reduce((sum, x) => sum + x * x, 0) / (samples.length || 1),
  );
}
export function shouldAnalyze(motion, sound) {
  return motion >= MOTION_THRESHOLD || sound >= RMS_THRESHOLD;
}
export function reserveAnalysis(session) {
  if (session.inFlight || session.used >= session.max) return false;
  session.used++;
  session.inFlight = true;
  return true;
}
const ACTIVITY = {
  still: ["Still", "Quieto"],
  active: ["Active", "Activo"],
  restless: ["Much movement", "Mucho movimiento"],
  vocalization: ["Vocalizing", "Vocalizando"],
  at_zone: ["In zone", "En zona"],
  absent: ["Absent", "Ausente"],
};
const VOCAL = {
  bark: ["bark", "ladrido"],
  howl: ["howl", "aullido"],
  whine: ["whine", "quejido"],
  cry: ["cry", "llanto"],
  growl: ["growl", "gruñido"],
  yip: ["high-pitched bark", "ladrido agudo"],
  pant: ["panting", "jadeo"],
  human_voice_music_noise_only: [
    "human voice, music or noise only",
    "solo voz humana, música o ruido",
  ],
};
// Observable on-device summary for the instant preliminary card. It reports
// strictly what the watcher measured (presence/activity/sound); it never
// claims an emotion or interpretation.
export function preliminarySummary(meta, lang = "en") {
  const es = lang === "es";
  const activity = meta?.observations?.activity || "unknown";
  const vocal = meta?.observations?.vocal_type || "none";
  const title = (ACTIVITY[activity] || [es ? "Watching" : "Watching", es ? "Observando" : "Observando"])[es ? 1 : 0];
  const lines = [
    meta?.dog_present === true
      ? es
        ? "Perro a la vista"
        : "Dog in view"
      : meta?.dog_present === false
        ? es
          ? "No se ve un perro"
          : "No dog in view"
        : es
          ? "Presencia sin confirmar"
          : "Presence unconfirmed",
    vocal === "none"
      ? es
        ? "Sin vocalización"
        : "No vocalization"
      : `${es ? "Se oye" : "Heard"}: ${(VOCAL[vocal] || [vocal.replaceAll("_", " "), vocal.replaceAll("_", " ")])[es ? 1 : 0]}`,
  ];
  return {
    badge: es
      ? "PRELIMINAR · solo dispositivo, sin IA todavía"
      : "PRELIMINARY · on-device only, no AI yet",
    title,
    lines,
    note: es
      ? "La lectura de la IA reemplaza esta tarjeta. No afirma ninguna emoción."
      : "The AI reading replaces this card. It claims no emotion.",
  };
}
// Live uploads already carry the native MP4 when available, and the server
// only sends that video to Spark on the live path (no SAM pre-pass). Dropping
// the auxiliary keyframes then saves upload bytes without changing the model
// input; the frames+WAV fallback keeps everything when there is no video.
export function selectLiveMedia(media) {
  if (!Array.isArray(media)) return media;
  if (!media.some((m) => m && m.kind === "video")) return media.slice();
  return media.filter((m) => m && m.kind !== "image");
}
export function newAlerts(alerts, seen) {
  const rank = { info: 0, warning: 1, urgent: 2 };
  return alerts.filter((alert) => {
    const severity = rank[alert.severity] || 0;
    if (severity <= (seen.get(alert.type) || 0)) return false;
    seen.set(alert.type, severity);
    return true;
  });
}
