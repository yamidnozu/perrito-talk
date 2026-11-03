// Pure policy; session is explicitly owned by the caller, never module-global.
import { PARAMETERS } from "./evidence-config.js";
export function savedCalls(t, session, config = PARAMETERS) {
  return Math.max(
    0,
    Math.floor(Math.max(0, t - session.startedAt) / config.evaluationWindowMs) -
      session.used,
  );
}
export function decide(events, t, session, config = PARAMETERS) {
  // Engineering decisions: all time gates come from the injected configuration.
  session.lastByType ||= {};
  const heartbeat = session.heartbeat ?? config.heartbeatMinutes;
  const observation = events.find((e) => e.type === "observation");
  const candidates = events.filter((e) =>
    Object.hasOwn(config.cooldowns, e.type),
  );
  if (observation && !observation.baselineOnly) {
    if (
      observation.vocalSince !== null &&
      t - observation.vocalSince > config.sustainedVocalMs
    )
      candidates.push({ ...observation, type: "vocal_sustained" });
    if (
      observation.spikeSince !== null &&
      t - observation.spikeSince >= config.spike.debounceMs
    )
      candidates.push({ ...observation, type: "motion_spike" });
    if (
      heartbeat > 0 &&
      t - (session.lastTrigger ?? session.startedAt) >= heartbeat * 60000
    )
      candidates.push({ ...observation, type: "heartbeat" });
  }
  const merging =
    session.inFlight &&
    session.pendingUntil !== undefined &&
    t <= session.pendingUntil;
  if (
    !merging &&
    (session.inFlight ||
      session.used >= session.max ||
      t - (session.lastTrigger ?? -Infinity) < config.globalGapMs)
  )
    return [];
  const eligible = candidates.filter(
    (e) =>
      t - (session.lastByType[e.type] ?? -Infinity) >= config.cooldowns[e.type],
  );
  // Coalesce simultaneous reasons into one clip; account for every reason's cooldown.
  const priority = config.triggerPriority;
  eligible.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
  if (!eligible.length) return [];
  for (const e of eligible) session.lastByType[e.type] = t;
  if (!merging) {
    session.lastTrigger = t;
    session.used++;
  }
  return [
    {
      ...eligible[0],
      t,
      ...(merging ? { merged: true } : {}),
      types: [...new Set(eligible.map((e) => e.type))],
    },
  ];
}
