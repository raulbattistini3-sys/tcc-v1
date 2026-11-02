// Demo page: a virtual table over the produtos dataset, driven by the scheduler.

import { start, cellText } from "../src/index.js";

/** @typedef {import("../src/types.js").OpSpec} OpSpec */
/** @typedef {import("../src/types.js").SortKey} SortKey */
/** @typedef {import("../src/types.js").Strategy} Strategy */
/** @typedef {import("../src/scheduler/scheduler.js").RunOutcome} RunOutcome */

const COLUMNS = ["name", "sku", "categoria", "valor_de_custo", "valor_de_venda", "icms", "quantidade_em_estoque", "data_de_cadastro"];
const ROW_H = 28;

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ (document.getElementById(id));

const dataUrl = new URLSearchParams(location.search).get("data") ?? "/data/produtos.bin";
const app = await start({ dataUrl }).catch((err) => {
  $("status").textContent = `Could not load ${dataUrl}: ${err}. Run "npm run data" first.`;
  throw err;
});
const { dataset, scheduler, signals, worker, workerError } = app;

$("status").textContent = [
  `${dataset.rows.toLocaleString("pt-BR")} rows, ${(dataset.buffer.byteLength / 1048576).toFixed(1)} MB in ${app.loadMs.toFixed(0)} ms`,
  worker ? `worker: ${worker.mode}, hand-off ${worker.handoffMs.toFixed(1)} ms on main, open ${worker.initMs.toFixed(1)} ms` : `no worker (${workerError})`,
  `crossOriginIsolated: ${globalThis.crossOriginIsolated === true}`,
].join(" · ");

// ---------- jank meter: moved by rAF, so it stalls exactly when the main thread does
{
  const ball = $("ball");
  let last = performance.now();
  let frames = 0;
  let long = 0;
  let windowStart = last;
  /** @param {number} t */
  const tick = (t) => {
    const dt = t - last;
    last = t;
    if (dt > 50) long++;
    frames++;
    if (t - windowStart >= 1000) {
      $("fps").textContent = `${Math.round((frames * 1000) / (t - windowStart))} fps`;
      $("dropped").textContent = `${long} long frames`;
      frames = 0;
      windowStart = t;
    }
    const w = /** @type {HTMLElement} */ (ball.parentElement).clientWidth - 40;
    const x = ((t / 4) % (2 * w)) - w;
    ball.style.transform = `translateX(${Math.abs(x)}px)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- synthetic background load on the main thread
/** @type {ReturnType<typeof setInterval> | undefined} */
let loadTimer;
select("load").addEventListener("change", () => setLoad(Number(select("load").value)));
/** @param {number} pct busy share of every 100 ms */
function setLoad(pct) {
  clearInterval(loadTimer);
  if (pct <= 0) return;
  loadTimer = setInterval(() => {
    const end = performance.now() + pct;
    while (performance.now() < end) {
      /* busy */
    }
  }, 100);
}

// ---------- table state
/** @type {SortKey[]} */
let sort = [{ column: "valor_de_venda", desc: true }];
/** @type {Uint32Array} */
let view = new Uint32Array(0);

function spec() {
  /** @type {OpSpec} */
  const s = { limit: Number(select("rows").value), sort: sort.map((k) => ({ ...k, comparator: /** @type {"auto" | "locale"} */ (select("comparator").value) })) };
  const q = input("filter").value.trim();
  if (q) s.filters = [{ column: select("filterCol").value, op: "contains", value: q }];
  return s;
}

/** @param {string} [channel] */
async function refresh(channel = "table") {
  scheduler.configure({ strategy: /** @type {Strategy} */ (select("strategy").value) });
  const r = await scheduler.run(spec(), { channel });
  if (r.stale) return;
  const t0 = performance.now();
  view = r.indices;
  render();
  showLast(r, performance.now() - t0);
  showModel();
}

// ---------- header
const thead = $("thead");
for (const c of COLUMNS) {
  const cell = document.createElement("div");
  cell.dataset.col = c;
  cell.title = "Click to sort, shift-click to add a key";
  thead.append(cell);
  cell.addEventListener("click", (e) => {
    const existing = sort.find((k) => k.column === c);
    if (e.shiftKey) {
      if (existing) existing.desc = !existing.desc;
      else sort.push({ column: c });
    } else {
      sort = [{ column: c, desc: existing && sort.length === 1 ? !existing.desc : false }];
    }
    paintHeader();
    refresh();
  });
}
function paintHeader() {
  for (const cell of /** @type {NodeListOf<HTMLElement>} */ (thead.querySelectorAll("div"))) {
    const i = sort.findIndex((k) => k.column === cell.dataset.col);
    const arrow = i < 0 ? "" : sort[i].desc ? " ↓" : " ↑";
    cell.textContent = `${cell.dataset.col}${arrow}${i >= 0 && sort.length > 1 ? i + 1 : ""}`;
  }
}

// ---------- virtual body: only the visible rows touch the DOM or decode strings
const viewport = $("viewport");
const tbody = $("tbody");
const spacer = $("spacer");
viewport.addEventListener("scroll", () => render(), { passive: true });
function render() {
  spacer.style.height = `${view.length * ROW_H}px`;
  const first = Math.floor(viewport.scrollTop / ROW_H);
  const count = Math.ceil(viewport.clientHeight / ROW_H) + 2;
  tbody.style.transform = `translateY(${first * ROW_H}px)`;
  const cols = COLUMNS.map((c) => /** @type {import("../src/types.js").Column} */ (dataset.byName.get(c)));
  const frag = document.createDocumentFragment();
  for (let i = first; i < Math.min(view.length, first + count); i++) {
    const row = view[i];
    const tr = document.createElement("div");
    tr.className = "tr";
    for (const col of cols) {
      const td = document.createElement("div");
      td.textContent = cellText(col, row);
      tr.append(td);
    }
    frag.append(tr);
  }
  tbody.replaceChildren(frag);
}

// ---------- panels
/**
 * @param {HTMLElement} dl
 * @param {[string, string | number, string?][]} rows
 */
function kv(dl, rows) {
  dl.replaceChildren(
    ...rows.flatMap(([k, v, cls]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = typeof v === "number" ? v.toFixed(v < 10 ? 2 : 0) : v;
      if (cls) dd.className = cls;
      return [dt, dd];
    }),
  );
}

/**
 * @param {Extract<RunOutcome, { stale: false }>} r
 * @param {number} applyMs
 */
function showLast(r, applyMs) {
  const d = r.decision;
  /** @type {[string, string | number, string?][]} */
  const rows = [
    ["target", `${r.target} (${d.reason})`, `target-${r.target}`],
    ["rows in / out", `${d.estimate.n.toLocaleString("pt-BR")} / ${r.stats.matched.toLocaleString("pt-BR")}`],
    ["sort class", r.stats.sortClass],
    ["predicted main / worker", `${d.predMainMs.toFixed(1)} / ${d.predWorkerMs.toFixed(1)} ms`],
    ["budget (busy, pressure)", `${d.budgetMs.toFixed(1)} ms (${(d.mainBusy * 100).toFixed(0)}%, ${d.pressure})`],
    ["time to result", r.timing.totalMs],
    ["main thread blocked", r.timing.mainBlockedMs],
    ["prepare (cold decode)", `${r.stats.prepareMs.toFixed(1)} ms, ${r.stats.prepared.toLocaleString("pt-BR")} strings`],
    ["cold main / worker", `${d.coldMain.toLocaleString("pt-BR")} / ${d.coldWorker.toLocaleString("pt-BR")}`],
    ["filter / sort", `${r.stats.filterMs.toFixed(1)} / ${r.stats.sortMs.toFixed(1)} ms`],
    ["render", applyMs],
  ];
  const w = r.timing.worker;
  if (w) rows.push(["post → recv → queue", `${w.postMs.toFixed(2)} · ${w.toWorkerMs.toFixed(2)} · ${w.queueMs.toFixed(2)}`], ["reply wait", w.replyMs]);
  kv($("last"), rows);
}

function showModel() {
  const s = scheduler.model.snapshot();
  /** @param {number} x */
  const sci = (x) => x.toExponential(2);
  kv($("model"), [
    ["k_prep main / worker", `${sci(s.main.prep)} / ${sci(s.worker.prep)}`],
    ["k_scan main / worker", `${sci(s.main.scan)} / ${sci(s.worker.scan)}`],
    ["k_sort num", `${sci(s.main.sort_num)} / ${sci(s.worker.sort_num)}`],
    ["k_sort code", `${sci(s.main.sort_code)} / ${sci(s.worker.sort_code)}`],
    ["k_sort locale", `${sci(s.main.sort_locale)} / ${sci(s.worker.sort_locale)}`],
    ["worker overhead", s.overheadMs],
    ["INP-like p98", signals.inp() ?? "–"],
  ]);
}

// ---------- controls
for (const id of ["rows", "strategy", "comparator", "filterCol"]) select(id).addEventListener("change", () => refresh());
// Typing fires many runs; stale worker replies are dropped by request id.
input("filter").addEventListener("input", () => refresh("filter"));

// ---------- benchmark sweep: one CSV row per run, the format the charts are built from
/** @type {Record<string, unknown>[]} */
let results = [];
$("bench").addEventListener("click", async () => {
  const btn = /** @type {HTMLButtonElement} */ ($("bench"));
  btn.disabled = true;
  results = [];
  const sizes = [1000, 10000, 50000, 100000, 250000, dataset.rows];
  /** @type {Strategy[]} */
  const strategies = ["main", "worker", "fixed", "adaptive"];
  const reps = Math.max(1, Number(input("reps").value));
  const base = spec();
  const total = sizes.length * strategies.length * reps;
  let done = 0;
  for (const n of sizes) {
    for (const strategy of strategies) {
      for (let rep = 0; rep < reps; rep++) {
        const s = { ...base, limit: n };
        const tStart = performance.now();
        const r = await scheduler.run(s, { channel: "bench", strategy });
        const tEnd = performance.now();
        // LoAF entries arrive after the frame ends; wait for them before reading TBT.
        await new Promise((res) => setTimeout(res, 120));
        if (!r.stale) {
          const tbt = signals.blockingBetween(tStart, tEnd);
          results.push({
            device: input("device").value,
            throttle: input("throttle").value,
            commit: input("commit").value,
            load_pct: Number(select("load").value),
            strategy,
            rep,
            n,
            matched: r.stats.matched,
            sort_class: r.stats.sortClass,
            target: r.target,
            reason: r.decision.reason,
            total_ms: r.timing.totalMs,
            main_blocked_ms: r.timing.mainBlockedMs,
            tbt_ms: tbt,
            filter_ms: r.stats.filterMs,
            sort_ms: r.stats.sortMs,
            prepare_ms: r.stats.prepareMs,
            prepared: r.stats.prepared,
            cold_main: r.decision.coldMain,
            cold_worker: r.decision.coldWorker,
            post_ms: r.timing.worker?.postMs ?? "",
            queue_ms: r.timing.worker?.queueMs ?? "",
            reply_ms: r.timing.worker?.replyMs ?? "",
            queued_behind: r.timing.worker?.queuedBehind ?? "",
            pred_main_ms: r.decision.predMainMs,
            pred_worker_ms: r.decision.predWorkerMs,
            budget_ms: r.decision.budgetMs,
            main_busy: r.decision.mainBusy,
            pressure: r.decision.pressure,
            cross_origin_isolated: globalThis.crossOriginIsolated === true,
            init_mode: worker?.mode ?? "none",
            ua: navigator.userAgent,
          });
        }
        $("benchStatus").textContent = `${++done}/${total}  n=${n} ${strategy}`;
      }
    }
  }
  $("benchStatus").textContent = `done: ${results.length} runs`;
  /** @type {HTMLButtonElement} */ ($("csv")).disabled = false;
  btn.disabled = false;
});

$("csv").addEventListener("click", () => {
  const cols = Object.keys(results[0] ?? {});
  /** @param {unknown} v */
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(","), ...results.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  download(`bench-${input("device").value}-${input("throttle").value}-load${select("load").value}.csv`, csv, "text/csv");
});
$("telemetry").addEventListener("click", () => download("telemetry.json", JSON.stringify(app.log), "application/json"));

/**
 * @param {string} name
 * @param {string} text
 * @param {string} type
 */
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- go: calibrate on small inputs, then show the table
paintHeader();
const calib = [
  { limit: 50000, sort: [{ column: "valor_de_venda" }] },
  { limit: 50000, sort: [{ column: "name" }] },
  // categoria has 10 strings: warms the filter path without decoding 600k names on the main thread.
  { limit: 50000, filters: [/** @type {const} */ ({ column: "categoria", op: "contains", value: "a" })] },
];
await scheduler.calibrate(calib);
await refresh();
