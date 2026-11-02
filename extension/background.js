// Service worker: keeps per-tab telemetry and answers the popup.
// MV3 stops idle service workers, so the buffer is mirrored to
// chrome.storage.session (memory-only, cleared when the browser closes).

const MAX_EVENTS = 5000;

/**
 * @typedef {{ world: string, source: string, type: string, ts: number, data: Record<string, any> }} StoredEvent
 * @typedef {{ page: string, events: StoredEvent[] }} TabLog
 */

/** @type {Map<number, TabLog>} */
const tabs = new Map();
/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const saveTimers = new Map();

/** @param {number} tabId */
async function load(tabId) {
  let log = tabs.get(tabId);
  if (!log) {
    const key = `tab:${tabId}`;
    const stored = await chrome.storage.session.get(key);
    log = /** @type {TabLog | undefined} */ (stored[key]) ?? { page: "", events: [] };
    tabs.set(tabId, log);
  }
  return log;
}

/** @param {number} tabId */
function scheduleSave(tabId) {
  if (saveTimers.has(tabId)) return;
  saveTimers.set(
    tabId,
    setTimeout(() => {
      saveTimers.delete(tabId);
      const log = tabs.get(tabId);
      if (log) chrome.storage.session.set({ [`tab:${tabId}`]: log });
    }, 2000),
  );
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "telemetry" || port.sender?.id !== chrome.runtime.id) return;
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;
  port.onMessage.addListener(async (/** @type {{ world: string, page: string, events: Omit<StoredEvent, "world">[] }} */ msg) => {
    const log = await load(tabId);
    if (log.page !== msg.page) {
      log.page = msg.page;
      log.events = [];
    }
    for (const e of msg.events) log.events.push({ world: msg.world, ...e });
    if (log.events.length > MAX_EVENTS) log.events.splice(0, log.events.length - MAX_EVENTS);
    scheduleSave(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  chrome.storage.session.remove(`tab:${tabId}`);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || typeof msg?.tabId !== "number") return;
  (async () => {
    const log = await load(msg.tabId);
    if (msg.type === "clear") {
      log.events = [];
      scheduleSave(msg.tabId);
      sendResponse({ ok: true });
    } else if (msg.type === "get") {
      sendResponse(log);
    }
  })();
  return true; // async response
});

export {};
