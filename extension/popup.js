// Popup: summarises the active tab's telemetry. The attribution table is the
// threat-to-validity check: it shows how much main-thread blocking came from
// extension scripts (this one included) rather than from the page.

/** @typedef {{ world: string, source: string, type: string, ts: number, data: Record<string, any> }} StoredEvent */

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabId = /** @type {number} */ (tab?.id);

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {HTMLElement} table
 * @param {string[]} head
 * @param {(string | number)[][]} rows
 */
function fill(table, head, rows) {
  const tr = (/** @type {(string | number)[]} */ cells, /** @type {"td" | "th"} */ tag) => {
    const r = document.createElement("tr");
    for (const c of cells) {
      const el = document.createElement(tag);
      el.textContent = typeof c === "number" ? (Number.isInteger(c) ? String(c) : c.toFixed(1)) : c;
      if (typeof c === "number") el.className = "num";
      r.append(el);
    }
    return r;
  };
  table.replaceChildren(tr(head, "th"), ...rows.map((r) => tr(r, "td")));
}

/** @param {string} url */
function originOf(url) {
  if (!url) return "(no script / rendering)";
  try {
    const u = new URL(url);
    return u.protocol === "chrome-extension:" ? `extension ${u.host.slice(0, 8)}…` : u.origin;
  } catch {
    return url.slice(0, 40);
  }
}

async function refresh() {
  /** @type {{ page: string, events: StoredEvent[] }} */
  const log = await chrome.runtime.sendMessage({ type: "get", tabId });
  $("page").textContent = log.page
    ? `${log.page} · ${log.events.length} events`
    : "No telemetry from this tab yet. If the site is enabled, reload the tab: the probe sends one page event after load, " +
      "then long frames (> 50 ms) and slow interactions (≥ 16 ms) as they happen.";

  // Count each frame once: prefer the bundle's copy, fall back to the probe's.
  const frames = log.events.filter((e) => e.type === "frame");
  const fromBundle = frames.some((e) => e.world === "page-bundle");
  /** @type {Map<string, number>} */
  const byOrigin = new Map();
  for (const f of frames) {
    if (fromBundle && f.world !== "page-bundle") continue;
    const scripts = /** @type {{ url: string, duration: number }[]} */ (f.data.scripts ?? []);
    const total = scripts.reduce((s, x) => s + x.duration, 0) || 1;
    if (scripts.length === 0) byOrigin.set(originOf(""), (byOrigin.get(originOf("")) ?? 0) + f.data.blockingDuration);
    // Split each frame's blocking time across its scripts by their duration.
    for (const s of scripts) {
      const o = originOf(s.url);
      byOrigin.set(o, (byOrigin.get(o) ?? 0) + (f.data.blockingDuration * s.duration) / total);
    }
  }
  fill($("attribution"), ["origin", "blocking ms"], [...byOrigin].sort((a, b) => b[1] - a[1]).map(([o, ms]) => [o, ms]));

  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const e of log.events) {
    const k = `${e.world} · ${e.source}/${e.type}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  fill($("counts"), ["world · source/type", "n"], [...counts].sort());

  const results = log.events.filter((e) => e.source === "scheduler" && e.type === "result").slice(-12).reverse();
  fill(
    $("decisions"),
    ["target", "rows", "pred ms", "actual ms", "blocked ms"],
    results.map((e) => [e.data.target, e.data.n, e.data.predMs, e.data.totalMs, e.data.mainBlockedMs]),
  );
}

/** Shows whether this tab's origin is covered and how the upload is doing. */
async function status() {
  const st = await chrome.runtime.sendMessage({ type: "status" });
  const u = st.upload;
  $("upload").textContent = !st.settings.uploadEnabled
    ? "Streaming is off: tick “Stream events to the collector” in Settings and Save. (Test connection works without it.)"
    : u.lastError
      ? `Upload failing: ${u.lastError} · ${u.queued} queued`
      : `Uploading to ${st.settings.collectorUrl} · ${u.sent} sent, ${u.queued} queued${u.dropped ? `, ${u.dropped} dropped` : ""}`;

  let pattern = "";
  try {
    const url = new URL(tab?.url ?? "");
    if (url.protocol === "http:" || url.protocol === "https:") pattern = `${url.protocol}//${url.hostname}/*`;
  } catch {}
  const covered = pattern !== "" && (await chrome.permissions.contains({ origins: [pattern] }));
  $("site").hidden = pattern === "" || covered;
  $("enable-site").onclick = async () => {
    // The background listens for permissions.onAdded and registers the content scripts.
    if (await chrome.permissions.request({ origins: [pattern] })) {
      $("site").textContent = "Enabled. Reload the tab to start collecting.";
    }
  };
}

$("refresh").addEventListener("click", () => (refresh(), status()));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("send").addEventListener("click", async () => {
  const r = await chrome.runtime.sendMessage({ type: "send-snapshot", tabId });
  $("upload").textContent = r.ok ? `Sent ${r.n} events to the collector.` : `Send failed: ${r.error}`;
});
$("clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear", tabId });
  refresh();
});
$("export").addEventListener("click", async () => {
  const log = await chrome.runtime.sendMessage({ type: "get", tabId });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(log, null, 1)], { type: "application/json" }));
  a.download = "tcc-telemetry.json";
  a.click();
});

refresh();
status();

export {};
