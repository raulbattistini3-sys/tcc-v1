// Injected before any page script (Page.addScriptToEvaluateOnNewDocument,
// which CSP does not apply to). The harness's own observers, independent of
// the app's telemetry: the instrument shouldn't be part of the system under test.
(() => {
  const h = (window.__harness = { loaf: [], events: [] });
  const testid = (el) => {
    const t = el && el.closest ? el.closest("[data-testid]") : null;
    return t ? t.getAttribute("data-testid") : el ? el.tagName : null;
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        let script = 0;
        for (const s of e.scripts || []) script += s.duration;
        h.loaf.push({ s: e.startTime, d: e.duration, b: e.blockingDuration, sc: script });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch (_) {}
  // Probe target: a fixed 12x12 box in the corner, owned by the harness and
  // identical in both apps, with no handlers of its own. The harness clicks it
  // while a query should be running; the click's Event Timing duration is the
  // input delay a user would feel at that moment. (The app's status bar sits
  // below the table, outside the viewport, so it can't be the target.)
  const addProbe = () => {
    if (document.querySelector("[data-testid=harness-probe]")) return;
    const el = document.createElement("div");
    el.setAttribute("data-testid", "harness-probe");
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, { position: "fixed", right: "0", bottom: "0", width: "12px", height: "12px", zIndex: "2147483647" });
    document.documentElement.appendChild(el);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addProbe);
  else addProbe();
  try {
    // 16 ms is the lowest threshold Event Timing allows; durations are rounded to 8 ms.
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        h.events.push({ s: e.startTime, d: e.duration, n: e.name, i: e.interactionId || 0, t: testid(e.target), ps: e.processingStart, pe: e.processingEnd });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch (_) {}
})();
