// Single-flight analysis lock with a one-slot queue. Exactly one reading may run
// at a time; a manual request made while busy waits for the current reading
// instead of starting a second one (or being lost). Release is token-checked so a
// stale reading (e.g. after a restart or camera switch) cannot free a newer lock.
export function createFlight() {
  let token = 0,
    busy = null,
    queued = null;
  return {
    get busy() {
      return busy !== null;
    },
    get queued() {
      return queued;
    },
    acquire() {
      if (busy !== null) return null;
      busy = ++token;
      return busy;
    },
    enqueue(request) {
      if (busy === null) return false;
      queued ??= request;
      return true;
    },
    release(id) {
      if (id === null || id !== busy) return null;
      busy = null;
      const next = queued;
      queued = null;
      return next;
    },
    clear() {
      busy = null;
      queued = null;
    },
  };
}
