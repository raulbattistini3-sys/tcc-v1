// Runs in the page's MAIN world at document_start, before page scripts.
// It sees the same performance timeline as the page, so it can measure pages
// that don't ship the bundle. It has no chrome.* APIs: it can only hand data
// to bridge.js through window.postMessage.
//
// What it records (never what is typed or clicked on, only timings):
// - "page": once per page, after load: the whole navigation timeline
//   (PerformanceNavigationTiming), so every covered page produces at least one
//   event and a stream can always be checked end to end;
// - "resource": every fetch/XHR/script/stylesheet... (PerformanceResourceTiming),
//   with the same breakdown, so the first request to the API can be compared
//   with the ones after it;
// - "vital": FCP once, then LCP, CLS and INP each time the page is hidden;
// - "frame": long animation frames (> 50 ms), with the scripts behind them;
// - "interaction": clicks, key presses and taps that took >= 16 ms to paint
//   (Event Timing), split into input delay, processing and presentation.
//
// The timeline of a request, as both "page" and "resource" report it (ms):
//   redirect  redirectStart -> redirectEnd
//   dns       domainLookupStart -> domainLookupEnd
//   connect   connectStart -> connectEnd (TCP, plus TLS on HTTPS: tls is a part of it)
//   tls       secureConnectionStart -> connectEnd
//   queue     connectEnd -> requestStart (waiting for a connection, or the cache)
//   ttfb      requestStart -> responseStart: request out, server work, first byte back
//   download  responseStart -> responseEnd
// A reused connection has dns/connect/tls 0. A cross-origin response without a
// Timing-Allow-Origin header hides all of it (timingAllowed: false): only the
// duration is real. serverTiming is the response's Server-Timing header
// ({ app: 18.4, db: 7.2 }): with it, ttfb - app is roughly the time on the
// network. Browser timing alone is not the server's processing time.
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

  /** interactionId -> its longest event duration, for INP (at most MAX_INTERACTIONS kept: the longest) */
  /** @type {Map<number, number>} */
  const interactions = new Map();
  // Bounded per page: a long-lived SPA must not grow this script's memory, or the batch, without limit.
  const MAX_EVENTS = 500; // "frame" and "interaction" events each
  const MAX_INTERACTIONS = 1000;
  let frames = 0;
  let interactionEvents = 0;
  const remember = (/** @type {number} */ id, /** @type {number} */ duration) => {
    interactions.set(id, Math.max(interactions.get(id) ?? 0, duration));
    if (interactions.size <= MAX_INTERACTIONS) return;
    // drop the shortest: INP only looks at the longest ones
    let minId = id;
    let min = Infinity;
    for (const [k, v] of interactions) if (v < min) [min, minId] = [v, k];
    interactions.delete(minId);
  };

  const frameType = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : null;
  if (frameType) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (frames >= MAX_EVENTS) return;
        frames++;
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
        remember(e.interactionId, e.duration);
        if (interactionEvents >= MAX_EVENTS) continue;
        interactionEvents++;
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

  /** origin + path: query strings can carry tokens or personal data */
  const clean = (/** @type {string} */ url) => {
    try {
      const u = new URL(url, location.href);
      return u.origin + u.pathname;
    } catch {
      return "";
    }
  };
  const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
  const span = (/** @type {number} */ a, /** @type {number} */ b) => (a > 0 && b >= a ? r1(b - a) : 0);

  /**
   * The request timeline shared by navigation and resource entries (see the top of the file).
   * @param {PerformanceResourceTiming} e
   */
  const timeline = (e) => {
    const timingAllowed = e.responseStart > 0;
    /** @type {Record<string, number>} */
    const serverTiming = {};
    for (const st of /** @type {any} */ (e).serverTiming ?? []) serverTiming[st.name] = r1(st.duration);
    return {
      protocol: e.nextHopProtocol || undefined,
      redirect: span(e.redirectStart, e.redirectEnd),
      dns: span(e.domainLookupStart, e.domainLookupEnd),
      connect: span(e.connectStart, e.connectEnd),
      tls: e.secureConnectionStart > 0 ? span(e.secureConnectionStart, e.connectEnd) : 0,
      queue: span(e.connectEnd || e.fetchStart, e.requestStart),
      ttfb: span(e.requestStart, e.responseStart),
      download: span(e.responseStart, e.responseEnd),
      duration: r1(e.duration),
      reusedConnection: timingAllowed && e.connectStart === e.connectEnd,
      timingAllowed,
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
      decodedBodySize: e.decodedBodySize,
      // from the HTTP cache: nothing came over the network, yet there is a body
      cached: e.transferSize === 0 && e.decodedBodySize > 0,
      status: /** @type {any} */ (e).responseStatus || undefined,
      ...(Object.keys(serverTiming).length ? { serverTiming } : {}),
    };
  };

  // Resources: one event each, at most MAX_RESOURCES a page (a long-lived SPA keeps fetching)
  const MAX_RESOURCES = 500;
  let resources = 0;
  if (types.includes("resource")) {
    new PerformanceObserver((list) => {
      for (const e of /** @type {PerformanceResourceTiming[]} */ (list.getEntries())) {
        if (resources >= MAX_RESOURCES) return;
        if (e.initiatorType === "beacon") continue;
        resources++;
        batch.push({
          source: "ext-probe",
          type: "resource",
          ts: e.startTime,
          data: { url: clean(e.name), initiator: e.initiatorType, renderBlocking: /** @type {any} */ (e).renderBlockingStatus, ...timeline(e) },
        });
      }
    }).observe({ type: "resource", buffered: true });
  }

  // Web Vitals. FCP is final when it happens; LCP, CLS and INP keep changing until the page is hidden,
  // so their latest values go out every time it is (the server keeps the last one per page view).
  /** @type {Record<string, number>} */
  const vitals = {};
  if (types.includes("paint")) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name !== "first-contentful-paint") continue;
        vitals.FCP = r1(e.startTime);
        batch.push({ source: "ext-probe", type: "vital", ts: e.startTime, data: { name: "FCP", value: vitals.FCP } });
      }
    }).observe({ type: "paint", buffered: true });
  }
  if (types.includes("largest-contentful-paint")) {
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) vitals.LCP = r1(last.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  }
  if (types.includes("layout-shift")) {
    // CLS: the largest session window (shifts < 1 s apart, at most 5 s long), shifts right after input excluded
    let session = 0;
    let first = 0;
    let prev = 0;
    vitals.CLS = 0;
    new PerformanceObserver((list) => {
      for (const e of /** @type {any[]} */ (list.getEntries())) {
        if (e.hadRecentInput) continue;
        if (session && e.startTime - prev < 1000 && e.startTime - first < 5000) session += e.value;
        else {
          session = e.value;
          first = e.startTime;
        }
        prev = e.startTime;
        if (session > vitals.CLS) vitals.CLS = Math.round(session * 10000) / 10000;
      }
    }).observe({ type: "layout-shift", buffered: true });
  }

  // INP: the worst interaction, skipping one in every 50 (about p98 on pages with many)
  const inp = () => {
    if (!interactions.size) return undefined;
    const sorted = [...interactions.values()].sort((a, b) => b - a);
    return sorted[Math.min(sorted.length - 1, Math.floor(interactions.size / 50))];
  };

  const send = () => {
    if (batch.length === 0) return;
    post({ channel: CHANNEL, events: batch }, location.origin);
    batch = [];
  };

  const reportVitals = () => {
    const now = performance.now();
    const i = inp();
    if (i !== undefined) vitals.INP = i;
    for (const name of ["LCP", "CLS", "INP"]) {
      if (vitals[name] !== undefined) batch.push({ source: "ext-probe", type: "vital", ts: now, data: { name, value: vitals[name] } });
    }
    // right away: a hidden page may never get its next interval
    send();
  };
  addEventListener("visibilitychange", () => document.visibilityState === "hidden" && reportVitals());
  addEventListener("pagehide", reportVitals);

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
                ...timeline(nav),
                // milestones, ms since navigation start
                responseStart: r1(nav.responseStart),
                domInteractive: r1(nav.domInteractive),
                domContentLoaded: r1(nav.domContentLoadedEventEnd),
                load: r1(nav.loadEventEnd),
                frameObserver: frameType,
              }
            : { frameObserver: frameType },
        });
      }, 0),
    { once: true },
  );

  // Batched once a second: every message costs main-thread time on the page we measure.
  setInterval(send, 1000);
})();
