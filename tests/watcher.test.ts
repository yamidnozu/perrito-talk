import { describe, it, expect } from "vitest";
import { createWatcher } from "../public/watcher/state.js";
import { decide, savedCalls } from "../public/watcher/triggers.js";
import { PARAMETERS, loadEvidence } from "../public/watcher/evidence-config.js";
import { mapScores, createResampler } from "../public/watcher/audio.js";
import evidence from "../public/evidence.json";
const testConfig = () => ({
  ...structuredClone(PARAMETERS),
  debounceMs: 2500,
  spike: { ...PARAMETERS.spike, debounceMs: 2500 },
  sustainedVocalMs: 20000,
  globalGapMs: 8000,
  states: [
    {
      name: "vocalization",
      feature: "vocalScore",
      enter: 0.6,
      exit: 0.3,
      below: false,
      scaled: false,
      subtype: true,
    },
    {
      name: "absent",
      feature: "presence",
      enter: 0.5,
      exit: 0.5,
      below: true,
      scaled: false,
      subtype: false,
    },
    {
      name: "active",
      feature: "motion",
      enter: 0.6,
      exit: 0.3,
      below: false,
      scaled: false,
      subtype: false,
    },
  ],
});
const session = () => ({
  startedAt: 0,
  used: 0,
  max: 20,
  heartbeat: 0,
  inFlight: false,
});
const features = (motion = 0, score = 0, present = true) => ({
  dogPresent: present,
  motion,
  scores: { howl: score },
});
describe("watcher mechanics with an injected test configuration", () => {
  it("establishes baseline locally; 30 s still then voice coalesces vocal_start and state_change after debounce", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 }),
      s = session(),
      triggers = [];
    for (let t = 0; t <= 40000; t += 500)
      triggers.push(
        ...decide(
          machine.update(features(0, t >= 30000 ? 0.9 : 0), t).events,
          t,
          s,
          config,
        ),
      );
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      type: "vocal_start",
      t: 32500,
      types: ["vocal_start", "state_change"],
    });
  });
  it("requires a continuously stable candidate and resets interrupted debounce", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 });
    expect(machine.update(features(), 0).changed).toBe(false);
    expect(machine.update(features(), 2499).state).toBe(null);
    expect(machine.update(features(), 2500).events[0].type).toBe("baseline");
    machine.update(features(0.8), 3000);
    machine.update(features(0), 5000);
    machine.update(features(0.8), 6000);
    expect(machine.update(features(0.8), 8499).state).toBe("still");
    expect(machine.update(features(0.8), 8500).state).toBe("active");
  });
  it("hysteresis prevents flapping around the enter threshold", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 });
    machine.update(features(0.8), 0);
    machine.update(features(0.8), 2500);
    for (let t = 3000; t <= 20000; t += 500)
      expect(machine.update(features(t % 1000 ? 0.59 : 0.61), t).changed).toBe(
        false,
      );
    machine.update(features(0.1), 21000);
    expect(machine.update(features(0.1), 23500).state).toBe("still");
  });
  it("vocal observation outranks motion and sustained voice re-arms only after its cooldown", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 }),
      s = session(),
      triggers = [];
    for (let t = 0; t <= 85000; t += 500)
      triggers.push(
        ...decide(machine.update(features(0.9, 0.9), t).events, t, s, config),
      );
    expect(machine.state).toBe("vocalization:howl");
    expect(
      triggers.filter((e) => e.type === "vocal_sustained").map((e) => e.t),
    ).toEqual([20500, 80500]);
  });
  it("quiet interrupts sustained voice even during exit debounce", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 });
    machine.update(features(0, 0.9), 0);
    machine.update(features(0, 0.9), 2500);
    expect(machine.update(features(), 15000).events.at(-1)?.vocalSince).toBe(
      null,
    );
    expect(
      machine.update(features(0, 0.9), 16000).events.at(-1)?.vocalSince,
    ).toBe(16000);
  });
  it("emits dog enter/exit only after the first baseline", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 });
    machine.update(features(0, 0, false), 0);
    expect(
      machine.update(features(0, 0, false), 2500).events.map((e) => e.type),
    ).toEqual(["baseline", "observation"]);
    machine.update(features(), 3000);
    expect(
      machine.update(features(), 5500).events.map((e) => e.type),
    ).toContain("dog_enter");
    machine.update(features(0, 0, false), 6000);
    expect(
      machine.update(features(0, 0, false), 8500).events.map((e) => e.type),
    ).toContain("dog_exit");
  });
  it("detects a persistent spike against a running baseline", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 }),
      s = session();
    for (let t = 0; t < 12000; t += 500)
      decide(machine.update(features(0.01), t).events, t, s, config);
    machine.update(features(0.2), 12000);
    expect(
      decide(machine.update(features(0.2), 14500).events, 14500, s, config)[0]
        .type,
    ).toBe("motion_spike");
  });
  it("enforces global gap, individual cooldowns, in-flight exclusion and reservations", () => {
    const config = testConfig(),
      s = session(),
      event = [
        { type: "vocal_start", prev: "still", next: "vocalization:howl" },
      ];
    expect(decide(event, 0, s, config)).toHaveLength(1);
    expect(decide([{ type: "dog_enter" }], 7999, s, config)).toEqual([]);
    expect(decide(event, 8000, s, config)).toEqual([]);
    expect(decide(event, 30000, s, config)).toHaveLength(1);
    s.inFlight = true;
    expect(decide([{ type: "dog_exit" }], 40000, s, config)).toEqual([]);
    s.inFlight = false;
    s.max = s.used;
    expect(decide([{ type: "dog_exit" }], 40000, s, config)).toEqual([]);
  });
  it("heartbeat is off by default and enabled only with an explicit interval", () => {
    const config = testConfig(),
      s = session(),
      event = [
        {
          type: "observation",
          next: "still",
          vocalSince: null,
          spikeSince: null,
        },
      ];
    expect(decide(event, 120000, s, config)).toEqual([]);
    s.heartbeat = 2;
    expect(decide(event, 120000, s, config)[0].type).toBe("heartbeat");
  });
  it("fires first_look once the dog has been present for stableMs, then check-ins while present", () => {
    const config = testConfig(),
      s = session();
    s.presentSince = 1000;
    expect(decide([], 1000 + config.firstLook.stableMs - 1, s, config)).toEqual(
      [],
    );
    const first = decide([], 1000 + config.firstLook.stableMs, s, config);
    expect(first[0].type).toBe("first_look");
    s.lastTrigger = 3000;
    s.used = 1;
    const due = 3000 + config.checkinSeconds * 1000;
    expect(decide([], due - 1, s, config)).toEqual([]);
    expect(decide([], due, s, config)[0].type).toBe("checkin");
    s.checkinSeconds = 0;
    expect(decide([], due + 60000, s, config)).toEqual([]);
  });
  it("never fires first_look or check-ins while no dog is present", () => {
    const config = testConfig(),
      s = session();
    s.presentSince = null;
    expect(decide([], 10000, s, config)).toEqual([]);
    s.lastTrigger = 0;
    s.used = 1;
    expect(decide([], 600000, s, config)).toEqual([]);
  });
  it("computes saved periodic evaluation windows minus actual calls, bounded at zero", () => {
    const s = session();
    s.used = 1;
    expect(savedCalls(36000, s)).toBe(2);
    expect(savedCalls(11999, s)).toBe(0);
    expect(savedCalls(-1000, s)).toBe(0);
  });
});
describe("evidence configuration and raw audio plumbing", () => {
  it("loads the same evidence JSON without changing engineering defaults", () => {
    const config = loadEvidence(evidence);
    expect(config.source).toBe("evidence");
    expect(config.citations.C34).toContain("AAHA");
    expect(config.labelQuality["Whimper (dog)"]).toContain("5/10");
    expect(PARAMETERS.source).toBe("provisional");
  });
  it.each([
    {},
    { ...evidence, citations: {} },
    { ...evidence, signals: [{ id: "bad", citations: ["C99"] }] },
  ])("rejects malformed scientific configuration", (value) =>
    expect(() => loadEvidence(value)).toThrow(),
  );
  it.each([
    { classThresholds: { Bark: 2 } },
    { debounceMs: NaN },
    { unknown: 1 },
    { sustainedVocalMs: 1000 },
  ])("rejects invalid engineering overrides", (value) =>
    expect(() => loadEvidence(evidence, value)).toThrow(),
  );
  it("applies per-class gates and ignores Yip alone", () => {
    expect(mapScores([{ categoryName: "Yip", score: 0.99 }]).yip).toBe(0);
    expect(
      mapScores([{ categoryName: "Whimper (dog)", score: 0.4 }]).whine,
    ).toBe(0);
    expect(mapScores([{ categoryName: "Howl", score: 0.9 }]).howl).toBe(0.9);
  });
  it("resamples across block boundaries without accumulating sample drift", () => {
    const resample = createResampler(48000);
    let length = 0;
    for (let i = 0; i < 100; i++)
      length += resample(new Float32Array(480)).length;
    expect(Math.abs(length - 16000)).toBeLessThanOrEqual(1);
  });
});

describe("pre-roll PCM and WAV integrity", () => {
  it("selects exactly four seconds before plus six after and releases on stop", async () => {
    const { createPreroll } = await import("../public/watcher/preroll.js");
    const ring = createPreroll({ sampleRate: 10 });
    for (let second = 1; second <= 20; second++)
      ring.pushPCM(new Float32Array(10).fill(second), second * 1000);
    const { pcm } = ring.snapshot(14000);
    expect(pcm).toHaveLength(100);
    expect(pcm[0]).toBe(11);
    expect(pcm[99]).toBe(20);
    ring.stop();
    expect(ring.snapshot(14000).pcm.every((n) => n === 0)).toBe(true);
  });
  it("encodes a mono 16 kHz signed PCM WAV with a valid length", async () => {
    const { encodeWav } = await import("../public/media.js");
    const blob = encodeWav(new Float32Array([-2, 0, 2]));
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.size).toBe(50);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getUint32(40, true)).toBe(6);
  });
});

describe("motion retention and pending trigger merging", () => {
  it("holds the rolling maximum across duplicate/missing samples, then expires real inactivity", async () => {
    const { createMotionHold } = await import("../public/watcher/motion.js");
    const hold = createMotionHold({ ...PARAMETERS, motionHoldMs: 1000 });
    expect(hold.update(0.2, 0)).toBe(0.2);
    expect(hold.update(0, 333)).toBe(0.2);
    expect(hold.update(undefined, 666)).toBe(0.2);
    expect(hold.value(999)).toBe(0.2);
    expect(hold.value(1000)).toBe(0);
    hold.update(0.4, 1100);
    hold.reset();
    expect(hold.value(1200)).toBe(0);
  });
  it("stabilizes an observation when raw motion alternates with duplicate-frame zeros", async () => {
    const { createMotionHold } = await import("../public/watcher/motion.js");
    const config = testConfig(),
      hold = createMotionHold({ ...config, motionHoldMs: 1000 }),
      machine = createWatcher({ config, now: () => 0 });
    machine.update(features(), 0);
    machine.update(features(), 2500);
    for (let t = 3000; t <= 6000; t += 500)
      machine.update(features(hold.update(t % 1000 ? 0 : 0.8, t)), t);
    expect(machine.state).toBe("active");
  });
  it("merges a vocal start in pending post-roll even at the budget cap without an extra reservation", () => {
    const config = testConfig(),
      s = { ...session(), max: 1, pendingUntil: 16000 };
    expect(
      decide([{ type: "state_change", next: "active" }], 10000, s, config),
    ).toHaveLength(1);
    s.inFlight = true;
    expect(
      decide(
        [{ type: "vocal_start", next: "vocalization:howl" }],
        12000,
        s,
        config,
      )[0],
    ).toMatchObject({ merged: true, type: "vocal_start" });
    expect(s.used).toBe(1);
    expect(decide([{ type: "dog_enter" }], 16001, s, config)).toEqual([]);
  });
});

describe("ambient calibration updates", () => {
  it("replaces startup motion transients with recent quiet-window measurements", async () => {
    const { createBaseline } = await import("../public/watcher/baseline.js");
    const config = structuredClone(PARAMETERS),
      baseline = createBaseline("test", config);
    for (let i = 0; i < config.calibration.minimumSamples; i++)
      baseline.ambient(0.001, 0.2);
    expect(baseline.gates().motion).toBeCloseTo(
      0.2 * config.calibration.motionNoiseMultiplier,
    );
    for (let i = 0; i < config.calibration.seconds; i++)
      baseline.ambient(0.001, 0.03);
    expect(baseline.gates().motion).toBeCloseTo(
      0.03 * config.calibration.motionNoiseMultiplier,
    );
  });
});

describe("presence persistence and candidate hysteresis", () => {
  it("does not treat a transient object-detector miss as a dog exit", async () => {
    const { createPresenceHold } = await import("../public/watcher/motion.js");
    const hold = createPresenceHold({ ...PARAMETERS, presenceHoldMs: 1500 });
    expect(hold.update(true, 0)).toBe(true);
    expect(hold.update(false, 333)).toBe(true);
    expect(hold.update(null, 666)).toBe(true);
    expect(hold.value(1500)).toBe(null);
    expect(hold.update(false, 1600)).toBe(false);
    hold.reset();
    expect(hold.value(1700)).toBe(null);
  });
  it("uses the exit threshold while a candidate is being debounced", () => {
    const config = testConfig(),
      machine = createWatcher({ config, now: () => 0 });
    machine.update(features(), 0);
    machine.update(features(), 2500);
    machine.update(features(0.7), 3000);
    expect(machine.update(features(0.5), 5000).state).toBe("still");
    expect(machine.update(features(0.5), 5500).state).toBe("active");
  });
});

describe("dog presence engineering threshold", () => {
  it("accepts COCO quadruped confusions at a permissive score", async () => {
    const { PARAMETERS } = await import("../public/watcher/evidence-config.js");
    expect(PARAMETERS.presence.detectorScore).toBeLessThanOrEqual(0.3);
    for (const label of ["dog", "cat", "cow", "horse", "bear"])
      expect(PARAMETERS.presence.animalClasses).toContain(label);
  });
});
