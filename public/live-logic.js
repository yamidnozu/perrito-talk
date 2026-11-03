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
export function newAlerts(alerts, seen) {
  const rank = { info: 0, warning: 1, urgent: 2 };
  return alerts.filter((alert) => {
    const severity = rank[alert.severity] || 0;
    if (severity <= (seen.get(alert.type) || 0)) return false;
    seen.set(alert.type, severity);
    return true;
  });
}
