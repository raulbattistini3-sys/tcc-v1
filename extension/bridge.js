// ISOLATED-world content script: the only part of the extension that can hear
// the page. It shares the DOM and `window` messages with the page, but not its
// JS objects, so it can't read the scheduler directly; the bundle posts
// telemetry here instead.
//
// Anything on the page can post on these channels, so every message is
// checked and size-capped before it reaches the service worker.

const CHANNELS = { "tcc-telemetry/v1": "page-bundle", "tcc-probe/v1": "extension-main" };
const MAX_EVENTS = 500;
const MAX_EVENT_BYTES = 4096;

/** @type {chrome.runtime.Port | null} */
let port = null;

function getPort() {
  if (!port) {
    port = chrome.runtime.connect({ name: "telemetry" });
    // The service worker can be stopped at any time; reconnect on next message.
    port.onDisconnect.addListener(() => (port = null));
  }
  return port;
}

/**
 * @param {unknown} e
 * @returns {e is { source: string, type: string, ts: number, data: Record<string, unknown> }}
 */
function valid(e) {
  if (typeof e !== "object" || e === null) return false;
  const x = /** @type {Record<string, unknown>} */ (e);
  return (
    typeof x.source === "string" &&
    x.source.length <= 32 &&
    typeof x.type === "string" &&
    x.type.length <= 32 &&
    typeof x.ts === "number" &&
    Number.isFinite(x.ts) &&
    typeof x.data === "object" &&
    x.data !== null
  );
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const msg = e.data;
  if (typeof msg !== "object" || msg === null) return;
  const world = CHANNELS[/** @type {keyof typeof CHANNELS} */ (msg.channel)];
  if (!world || !Array.isArray(msg.events)) return;

  const events = [];
  for (const ev of msg.events.slice(0, MAX_EVENTS)) {
    if (!valid(ev)) continue;
    // Round-trip through JSON: drops functions, prototypes and anything exotic.
    const json = JSON.stringify(ev);
    if (json.length > MAX_EVENT_BYTES) continue;
    events.push(JSON.parse(json));
  }
  if (events.length === 0) return;

  try {
    // Origin + path only: query strings can carry tokens or personal data.
    getPort().postMessage({ world, page: location.origin + location.pathname, events });
  } catch {
    port = null;
  }
});
