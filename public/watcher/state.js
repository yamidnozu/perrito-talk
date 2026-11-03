import { PARAMETERS } from "./evidence-config.js";
export const sensitivityScale = (value, config = PARAMETERS) =>
  config.sensitivity[value] ?? config.sensitivity.medium;
// Pure state machine. All timestamps are monotonic milliseconds; rules are data.
export function createWatcher({
  sensitivity = "medium",
  now = () => Date.now(),
  config = PARAMETERS,
} = {}) {
  const scale = sensitivityScale(sensitivity, config);
  let state = null,
    since = now(),
    candidate = null,
    candidateSince = since;
  let baseline = 0,
    samples = 0,
    vocalSince = null,
    spikeSince = null;
  return {
    get state() {
      return state;
    },
    get since() {
      return since;
    },
    update(features, t = now()) {
      const f = features,
        scores = f.scores || {};
      const voice = [...config.vocalSignals].sort(
        (a, b) => (scores[b] || 0) - (scores[a] || 0),
      )[0];
      const motion = f.motion || 0;
      // Engineering decisions: observation gates only; no emotion or behavioral interpretation.
      const values = {
        motion,
        vocalScore: scores[voice] || 0,
        presence: Number(
          f.dogPresent ?? motion > config.presence.motionThreshold * scale,
        ),
        inZone: Number(!!(f.zone && f.bbox && inside(f.bbox, f.zone))),
      };
      const baseState = state?.split(":")[0];
      const matches = (rule) => {
        const threshold =
          (baseState === rule.name || candidate?.split(":")[0] === rule.name
            ? rule.exit
            : rule.enter) * (rule.scaled ? scale : 1);
        return rule.below
          ? values[rule.feature] < threshold
          : values[rule.feature] >= threshold;
      };
      const rule = config.states.find(matches);
      const next = rule
        ? `${rule.name}${rule.subtype ? `:${voice}` : ""}`
        : config.defaultState;
      const events = [];
      if (next !== candidate) {
        candidate = next;
        candidateSince = t;
      }
      let changed = false;
      if (
        next !== state &&
        t - candidateSince >= (rule?.debounceMs ?? config.debounceMs)
      ) {
        const prev = state,
          duration = (t - since) / 1000;
        state = next;
        since = t;
        changed = true;
        const event = {
          type: prev === null ? "baseline" : "state_change",
          t,
          prev,
          next,
          duration,
        };
        events.push(event);
        if (prev !== null) {
          if (
            next.split(":")[0] === config.transitions.vocalState &&
            prev.split(":")[0] !== config.transitions.vocalState
          )
            events.push({ ...event, type: "vocal_start" });
          if (prev === config.transitions.absentState && next !== prev)
            events.push({ ...event, type: "dog_enter" });
          if (next === config.transitions.absentState && prev !== next)
            events.push({ ...event, type: "dog_exit" });
        }
      }
      const vocal = config.states.some(
        (r) => r.name === config.transitions.vocalState && matches(r),
      );
      vocalSince = vocal ? (vocalSince ?? t) : null;
      const spike =
        samples >= config.baseline.minimumSamples &&
        motion >
          Math.max(config.spike.floor * scale, baseline * config.spike.factor);
      spikeSince = spike ? (spikeSince ?? t) : null;
      if (!spike)
        baseline = samples
          ? baseline * (1 - config.baseline.weight) +
            motion * config.baseline.weight
          : motion;
      samples++;
      events.push({
        type: "observation",
        t,
        prev: state,
        next: state,
        motion,
        baseline,
        vocalSince,
        spikeSince,
        baselineOnly:
          state === null || (changed && events[0].type === "baseline"),
      });
      return { state, changed, events, since };
    },
  };
}
function inside([x, y, w, h], [zx, zy, zw, zh]) {
  return (
    x + w / 2 >= zx &&
    x + w / 2 <= zx + zw &&
    y + h / 2 >= zy &&
    y + h / 2 <= zy + zh
  );
}
