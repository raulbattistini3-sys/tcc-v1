// Exporters: where telemetry goes. The ring buffer feeds the scheduler; the
// bridge feeds the WebExtension; the beacon feeds a server you control.

/** @typedef {import("./bus.js").Exporter} Exporter */
/** @typedef {import("../types.js").TelemetryEvent} TelemetryEvent */

/**
 * Keeps recent events in memory and turns them into the signals the
 * scheduler reads. Frames that overlap the scheduler's own main-thread runs
 * are left out of `mainBusy`, so running a sort on the main thread doesn't
 * itself push the next decision to the worker.
 *
 * @param {{ windowMs?: number }} [options]
 */
export function signalsExporter({ windowMs = 3000 } = {}) {
  /** @type {{ start: number, end: number, blocking: number }[]} */
  let frames = [];
  /** @type {{ start: number, end: number }[]} */
  let self = [];
  /** @type {number[]} */
  let interactions = [];
  let pressure = "unknown";

  const trim = () => {
    const cutoff = performance.now() - windowMs;
    frames = frames.filter((f) => f.end >= cutoff);
    self = self.filter((s) => s.end >= cutoff);
    if (interactions.length > 500) interactions = interactions.slice(-500);
  };

  /** @type {Exporter} */
  const exporter = {
    name: "signals",
    export(e) {
      if (e.type === "frame") {
        const d = /** @type {{ duration: number, blockingDuration: number }} */ (e.data);
        frames.push({ start: e.ts, end: e.ts + d.duration, blocking: d.blockingDuration });
        if (frames.length > 200) trim();
      } else if (e.type === "state" && e.source === "pressure") {
        pressure = String(e.data.state);
      } else if (e.type === "interaction") {
        interactions.push(Number(e.data.duration));
      }
    },
  };

  return {
    exporter,
    /** Tell the signals about a main-thread run so its frames don't count as outside load. */
    markSelf(/** @type {number} */ start, /** @type {number} */ end) {
      self.push({ start, end });
    },
    /**
     * Share of the recent window the main thread spent in long frames caused
     * by others, 0..1. Uses frame duration, not blockingDuration: a 75 ms task
     * every 100 ms has only 25 ms of "blocking" but leaves 25% of the time free.
     */
    mainBusy() {
      trim();
      let busy = 0;
      for (const f of frames) {
        if (self.some((s) => s.start < f.end && s.end > f.start)) continue;
        busy += f.end - f.start;
      }
      return Math.min(1, busy / windowMs);
    },
    pressure: () => pressure,
    /** INP-like: the 98th percentile interaction duration seen so far. */
    inp() {
      if (interactions.length === 0) return null;
      const sorted = [...interactions].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
    },
    /** Sum of blocking time of frames in [start, end], the TBT of a run. */
    blockingBetween(/** @type {number} */ start, /** @type {number} */ end) {
      let sum = 0;
      for (const f of frames) if (f.start < end && f.end > start) sum += f.blocking;
      return sum;
    },
  };
}

/** @typedef {ReturnType<typeof signalsExporter>} Signals */

export const BRIDGE_CHANNEL = "tcc-telemetry/v1";

/**
 * Posts batches to the page window, where the extension's ISOLATED-world
 * content script picks them up. Anything on the page can read and forge these
 * messages, so send timings only, never row data, and make the extension
 * treat what it receives as untrusted.
 *
 * @param {{ flushMs?: number, maxBatch?: number }} [options]
 * @returns {Exporter}
 */
export function extensionBridgeExporter({ flushMs = 1000, maxBatch = 200 } = {}) {
  /** @type {TelemetryEvent[]} */
  let batch = [];
  const flush = () => {
    if (batch.length === 0) return;
    window.postMessage({ channel: BRIDGE_CHANNEL, events: batch }, location.origin);
    batch = [];
  };
  const timer = setInterval(flush, flushMs);
  return {
    name: "extension-bridge",
    export(e) {
      batch.push(e);
      if (batch.length >= maxBatch) flush();
    },
    flush,
    stop: () => clearInterval(timer),
  };
}

/**
 * Sends batches to a collector endpoint with sendBeacon, which survives page
 * unload. Governed by CSP `connect-src`. This is the one path that leaves the
 * machine, so it is the one a gateway (rate limit, size cap, schema check)
 * should sit in front of.
 *
 * @param {{ url: string, flushMs?: number }} options
 * @returns {Exporter}
 */
export function beaconExporter({ url, flushMs = 5000 }) {
  /** @type {TelemetryEvent[]} */
  let batch = [];
  const flush = () => {
    if (batch.length === 0) return;
    navigator.sendBeacon(url, new Blob([JSON.stringify(batch)], { type: "application/json" }));
    batch = [];
  };
  const timer = setInterval(flush, flushMs);
  const onHide = () => document.visibilityState === "hidden" && flush();
  document.addEventListener("visibilitychange", onHide);
  return {
    name: "beacon",
    export: (e) => void batch.push(e),
    flush,
    stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
    },
  };
}

/**
 * Keeps every event for CSV export from the page itself.
 *
 * @param {{ max?: number }} [options]
 */
export function memoryExporter({ max = 50_000 } = {}) {
  /** @type {TelemetryEvent[]} */
  const events = [];
  /** @type {Exporter} */
  const exporter = {
    name: "memory-log",
    export(e) {
      events.push(e);
      if (events.length > max) events.splice(0, events.length - max);
    },
  };
  return { exporter, events };
}
