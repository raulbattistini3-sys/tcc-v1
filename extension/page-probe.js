// Runs in the page's MAIN world at document_start, before page scripts.
// It sees the same performance timeline as the page, so it can measure pages
// that don't ship the bundle. It has no chrome.* APIs: it can only hand data
// to bridge.js through window.postMessage.
//
// What it records (never what is typed or clicked on, only timings):
// - "page": once per page, after load (navigation timing), so every covered page
//   produces at least one event and a stream can always be checked end to end;
// - "frame": long animation frames (> 50 ms), with the scripts behind them;
// - "interaction": clicks, key presses and taps that took >= 16 ms to paint
//   (Event Timing), split into input delay, processing and presentation.
//
// Because it shares the page's globals, the page could replace
// PerformanceObserver or window.postMessage before or after this runs. Treat
// its output as the page's word, not as ground truth.

(() => {
  const CHANNEL = "tcc-probe/v1";
  const types = PerformanceObserver.supportedEntryTypes ?? [];

  // Keep a private reference: a page that patches postMessage later can't intercept us.
  const post = window.postMessage.bind(window);
  /** @type {{ source: string, type: string, ts: number, data: Record<string, unknown> }[]} */
  let batch = [];

  const frameType = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : null;
  if (frameType) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const loaf = /** @type {any} */ (e);
        batch.push({
          source: "ext-probe",
          type: "frame",
          ts: e.startTime,
          data: {
            duration: e.duration,
            blockingDuration: loaf.blockingDuration ?? Math.max(0, e.duration - 50),
            scripts: (loaf.scripts ?? []).map((/** @type {any} */ s) => ({ url: s.sourceURL, duration: s.duration })),
          },
        });
      }
    }).observe({ type: frameType, buffered: true });
  }

  if (types.includes("event")) {
    new PerformanceObserver((list) => {
      for (const e of /** @type {any[]} */ (list.getEntries())) {
        // interactionId 0: hovers and other events that aren't a discrete interaction
        if (!e.interactionId) continue;
        batch.push({
          source: "ext-probe",
          type: "interaction",
          ts: e.startTime,
          data: {
            event: e.name, // "keydown", "pointerup", "click"...: the kind, never the key or the target
            interactionId: e.interactionId,
            duration: e.duration,
            inputDelay: e.processingStart - e.startTime,
            processing: e.processingEnd - e.processingStart,
            presentation: Math.max(0, e.startTime + e.duration - e.processingEnd),
          },
        });
      }
      // 16 ms is the lowest threshold Event Timing allows
    }).observe(/** @type {any} */ ({ type: "event", durationThreshold: 16, buffered: true }));
  }

  addEventListener(
    "load",
    () =>
      // after load returns, so loadEventEnd is set
      setTimeout(() => {
        const nav = /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType("navigation")[0]);
        batch.push({
          source: "ext-probe",
          type: "page",
          ts: performance.now(),
          data: nav
            ? {
                navType: nav.type,
                ttfb: nav.responseStart,
                domContentLoaded: nav.domContentLoadedEventEnd,
                load: nav.loadEventEnd,
                transferSize: nav.transferSize,
                frameObserver: frameType,
              }
            : { frameObserver: frameType },
        });
      }, 0),
    { once: true },
  );

  // Batched once a second: every message costs main-thread time on the page we measure.
  setInterval(() => {
    if (batch.length === 0) return;
    post({ channel: CHANNEL, events: batch }, location.origin);
    batch = [];
  }, 1000);
})();
