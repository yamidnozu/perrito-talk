import { PARAMETERS } from "./evidence-config.js";
/** Pure rolling maximum. A missing result is not a new zero-energy frame. */
export function createMotionHold(config = PARAMETERS) {
  let samples = [];
  const value = (t) => {
    samples = samples.filter((sample) => t - sample.t < config.motionHoldMs);
    return samples.reduce((max, sample) => Math.max(max, sample.motion), 0);
  };
  return {
    update(motion, t) {
      if (Number.isFinite(motion) && motion >= 0) samples.push({ motion, t });
      return value(t);
    },
    value,
    reset() {
      samples = [];
    },
  };
}

/** C43 recommends persistence for object detections. Duration is engineering. */
export function createPresenceHold(config = PARAMETERS) {
  let lastPositive = -Infinity,
    lastKnown = null;
  const value = (t) =>
    t - lastPositive < config.presenceHoldMs ? true : lastKnown;
  return {
    update(present, t) {
      lastKnown = typeof present === "boolean" ? present : null;
      if (present === true) lastPositive = t;
      return value(t);
    },
    value,
    reset() {
      lastPositive = -Infinity;
      lastKnown = null;
    },
  };
}
