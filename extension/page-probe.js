// Runs in the page's MAIN world at document_start, before page scripts.
// It sees the same performance timeline as the page, so it can measure pages
// that don't ship the bundle. It has no chrome.* APIs: it can only hand data
// to bridge.js through window.postMessage.
//
// Because it shares the page's globals, the page could replace
// PerformanceObserver or window.postMessage before or after this runs. Treat
// its output as the page's word, not as ground truth.

(() => {
  const CHANNEL = "tcc-probe/v1";
  const types = PerformanceObserver.supportedEntryTypes ?? [];
  const type = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : null;
  if (!type) return;

  // Keep a private reference: a page that patches postMessage later can't intercept us.
  const post = window.postMessage.bind(window);
  /** @type {{ source: string, type: string, ts: number, data: Record<string, unknown> }[]} */
  let batch = [];

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
  }).observe({ type, buffered: true });

  // Batched once a second: every message costs main-thread time on the page we measure.
  setInterval(() => {
    if (batch.length === 0) return;
    post({ channel: CHANNEL, events: batch }, location.origin);
    batch = [];
  }, 1000);
})();
