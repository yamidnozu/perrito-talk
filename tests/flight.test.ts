import { describe, it, expect } from "vitest";
import { createFlight } from "../public/watcher/flight.js";
import { decide } from "../public/watcher/triggers.js";
import { PARAMETERS } from "../public/watcher/evidence-config.js";

const session = (flight: ReturnType<typeof createFlight>) => ({
  used: 1,
  max: 10,
  startedAt: 0,
  lastTrigger: 0,
  lastByType: {} as Record<string, number>,
  presentSince: 0,
  checkinSeconds: 50,
  heartbeat: 0,
  get inFlight() {
    return flight.busy;
  },
});

describe("single-flight analysis lock", () => {
  it("check-in and 'Analyze now' at the same instant run one reading, then the queued manual", () => {
    const flight = createFlight(),
      s = session(flight),
      t = 50000;
    const [checkin] = decide([], t, s, PARAMETERS);
    expect(checkin.type).toBe("checkin");
    const a = flight.acquire();
    expect(a).not.toBeNull();
    // Button pressed in the same tick: no second lock, request is queued once.
    expect(flight.acquire()).toBeNull();
    expect(flight.enqueue({ type: "manual" })).toBe(true);
    expect(flight.enqueue({ type: "manual" })).toBe(true);
    // While busy no other trigger may start (decide sees inFlight).
    expect(decide([], t + 1, s, PARAMETERS)).toEqual([]);
    // A stale release (old session / camera switch) cannot free the lock.
    expect(flight.release(a! + 99)).toBeNull();
    expect(flight.busy).toBe(true);
    expect(flight.release(a)).toEqual({ type: "manual" });
    expect(flight.busy).toBe(false);
    expect(flight.queued).toBeNull();
    const b = flight.acquire();
    expect(b).not.toBeNull();
    expect(flight.release(b)).toBeNull();
  });
  it("does not queue when idle and clear() drops lock and queue", () => {
    const flight = createFlight();
    expect(flight.enqueue({ type: "manual" })).toBe(false);
    const id = flight.acquire();
    flight.enqueue({ type: "manual" });
    flight.clear();
    expect(flight.busy).toBe(false);
    expect(flight.queued).toBeNull();
    expect(flight.release(id)).toBeNull();
  });
});
