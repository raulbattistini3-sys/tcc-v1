// Service worker: keeps per-tab telemetry, answers the popup, injects the
// content scripts into live sites the user opted into, and streams events to
// an optional remote collector (tools/collector.mjs).
//
// MV3 stops idle service workers, so the per-tab buffer is mirrored to
// chrome.storage.session (memory-only, cleared when the browser closes).
// The upload outbox lives in memory only: it is flushed every few seconds,
// well inside the ~30 s idle window, so at most one flush interval is lost.

const MAX_EVENTS = 5000;
const OUTBOX_MAX_EVENTS = 20000;
const FLUSH_MS = 3000;
const MAX_BACKOFF_MS = 60000;
/** Origins covered by the static content_scripts in manifest.json. */
const STATIC_ORIGINS = ["http://localhost/*", "http://127.0.0.1/*"];
const SCRIPT_IDS = ["live-probe", "live-bridge"];

/**
 * @typedef {{ world: string, source: string, type: string, ts: number, data: Record<string, any> }} StoredEvent
 * @typedef {{ page: string, events: StoredEvent[] }} TabLog
 * @typedef {{ collectorUrl: string, token: string, label: string, uploadEnabled: boolean }} Settings
 * @typedef {{ tabId: number, page: string, world: string, timeOrigin: number, receivedAt: number, events: Omit<StoredEvent, "world">[] }} OutItem
 */

/** @type {Map<number, TabLog>} */
const tabs = new Map();
/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const saveTimers = new Map();

/** @type {Settings} */
let settings = { collectorUrl: "", token: "", label: "", uploadEnabled: false };
let installId = "";
const ready = (async () => {
  const s = await chrome.storage.local.get(["settings", "installId"]);
  settings = { ...settings, ...s.settings };
  installId = s.installId ?? crypto.randomUUID();
  if (!s.installId) await chrome.storage.local.set({ installId });
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
    upload.backoffMs = 0;
    upload.lastError = "";
    if (settings.uploadEnabled) scheduleFlush(0);
    else outbox.length = 0;
    // The collector origin is excluded from the live sites; re-derive them.
    syncContentScripts();
  }
});

// ---------- per-tab log ----------

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
  port.onMessage.addListener(
    async (/** @type {{ world: string, page: string, timeOrigin?: number, events: Omit<StoredEvent, "world">[] }} */ msg) => {
      const log = await load(tabId);
      if (log.page !== msg.page) {
        log.page = msg.page;
        log.events = [];
      }
      for (const e of msg.events) log.events.push({ world: msg.world, ...e });
      if (log.events.length > MAX_EVENTS) log.events.splice(0, log.events.length - MAX_EVENTS);
      scheduleSave(tabId);
      await ready;
      enqueue({ tabId, page: msg.page, world: msg.world, timeOrigin: msg.timeOrigin ?? 0, receivedAt: Date.now(), events: msg.events });
    },
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  chrome.storage.session.remove(`tab:${tabId}`);
});

// ---------- remote upload ----------

/** @type {OutItem[]} */
const outbox = [];
const upload = { sent: 0, dropped: 0, lastOkAt: 0, lastError: "", backoffMs: 0, inFlight: false };
/** @type {ReturnType<typeof setTimeout> | null} */
let flushTimer = null;

const outboxEvents = () => outbox.reduce((n, b) => n + b.events.length, 0);

/** @param {OutItem} item */
function enqueue(item) {
  if (!settings.uploadEnabled || !settings.collectorUrl) return;
  outbox.push(item);
  // Drop the oldest batches if the collector is unreachable for a long time.
  while (outbox.length > 1 && outboxEvents() > OUTBOX_MAX_EVENTS) upload.dropped += /** @type {OutItem} */ (outbox.shift()).events.length;
  scheduleFlush(FLUSH_MS);
}

/** @param {number} delay */
function scheduleFlush(delay) {
  if (flushTimer || upload.inFlight) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, Math.max(delay, upload.backoffMs));
}

/**
 * POSTs a body to the collector.
 * @param {unknown} body
 */
async function post(body) {
  const res = await fetch(settings.collectorUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${settings.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
}

const envelope = () => ({
  v: 1,
  installId,
  label: settings.label,
  ext: chrome.runtime.getManifest().version,
  ua: navigator.userAgent,
  sentAt: Date.now(),
});

async function flush() {
  if (outbox.length === 0 || !settings.uploadEnabled || !settings.collectorUrl) return;
  upload.inFlight = true;
  const batches = outbox.splice(0, outbox.length);
  try {
    await post({ ...envelope(), kind: "stream", batches });
    upload.sent += batches.reduce((n, b) => n + b.events.length, 0);
    upload.lastOkAt = Date.now();
    upload.lastError = "";
    upload.backoffMs = 0;
  } catch (err) {
    outbox.unshift(...batches);
    upload.lastError = String(/** @type {Error} */ (err).message ?? err);
    upload.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(2000, upload.backoffMs * 2));
  } finally {
    upload.inFlight = false;
  }
  if (outbox.length) scheduleFlush(FLUSH_MS);
}

// ---------- live sites: content scripts for opted-in origins ----------

/** Match pattern for the collector host, or "" when none is set. */
function collectorPattern() {
  try {
    if (!settings.collectorUrl) return "";
    const u = new URL(settings.collectorUrl);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return "";
  }
}

/** Granted origins that are neither the static localhost ones nor the collector. */
async function liveSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  const collector = collectorPattern();
  return origins.filter((o) => !STATIC_ORIGINS.includes(o) && o !== collector);
}

async function syncContentScripts() {
  await ready;
  const matches = await liveSites();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  if (matches.length === 0) return;
  // With "all sites" on, matches holds wildcards that would also cover the collector
  // and the statically injected localhost pages (double injection); exclude them.
  const collector = collectorPattern();
  const excludeMatches = [...STATIC_ORIGINS, ...(collector ? [collector] : [])];
  await chrome.scripting.registerContentScripts([
    { id: "live-probe", matches, excludeMatches, js: ["page-probe.js"], runAt: "document_start", world: "MAIN", persistAcrossSessions: true },
    { id: "live-bridge", matches, excludeMatches, js: ["bridge.js"], runAt: "document_start", world: "ISOLATED", persistAcrossSessions: true },
  ]);
}

chrome.permissions.onAdded.addListener(syncContentScripts);
chrome.permissions.onRemoved.addListener(syncContentScripts);
chrome.runtime.onInstalled.addListener(syncContentScripts);

// ---------- popup / options API ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    await ready;
    if (msg?.type === "status") {
      sendResponse({ settings, installId, upload: { ...upload, queued: outboxEvents() }, sites: await liveSites() });
      return;
    }
    if (msg?.type === "test") {
      try {
        // the extension's own state rides along, so the server's ingest_batches shows why a stream is
        // or isn't flowing (streaming off, no events from any tab, uploads failing)
        const diag = {
          uploadEnabled: settings.uploadEnabled,
          collectorUrl: settings.collectorUrl,
          upload: { ...upload, queued: outboxEvents() },
          tabs: [...tabs].map(([tabId, log]) => ({ tabId, page: log.page, events: log.events.length })),
          liveSites: await liveSites(),
        };
        await post({ ...envelope(), kind: "ping", diag });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(/** @type {Error} */ (err).message ?? err) });
      }
      return;
    }
    if (typeof msg?.tabId !== "number") return sendResponse(null);
    const log = await load(msg.tabId);
    if (msg.type === "clear") {
      log.events = [];
      scheduleSave(msg.tabId);
      sendResponse({ ok: true });
    } else if (msg.type === "get") {
      sendResponse(log);
    } else if (msg.type === "send-snapshot") {
      // Full tab log in one request, for runs where streaming was off.
      try {
        await post({ ...envelope(), kind: "snapshot", tabId: msg.tabId, page: log.page, events: log.events });
        sendResponse({ ok: true, n: log.events.length });
      } catch (err) {
        sendResponse({ ok: false, error: String(/** @type {Error} */ (err).message ?? err) });
      }
    }
  })();
  return true; // async response
});

export {};
