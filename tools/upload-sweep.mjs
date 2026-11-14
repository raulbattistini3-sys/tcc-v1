#!/usr/bin/env node
// Sends a harness run (results/<runId>/queries.csv + run.json) to the demo-monorepo-workspace server's
// POST /sweeps. Plain Node, no dependencies. The harness calls it at the end with --post; run it by hand
// for older runs, or again after a failure:
//
//   node tools/upload-sweep.mjs results/20261104T132150Z [more run dirs...]
//   node tools/upload-sweep.mjs results/sweep-sizes/20261104T132150Z --dry-run
//
// One sweep run per (app, cond, match, data, throttle) group: those are what a sweep_runs row holds
// constant, while strategy varies per result. Nothing in the run dir is changed except two new files:
//   sweep-upload.json  exactly what is (or would be) posted, written before any request
//   uploaded.json      the server's answer per group; groups listed here are skipped next time (--force: resend)
//
// Server and token: --server / --token, else TCC_SERVER_URL / TCC_TOKEN, else
// demo-monorepo-workspace/apps/server/.env (TCC_TOKEN, PORT) on this machine.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MAX_PER_REQUEST = 50_000; // contracts: SweepUpload.results.max

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string" },
    token: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!positionals.length) {
  console.error("usage: node tools/upload-sweep.mjs <results/runId> [...] [--server URL] [--token T] [--force] [--dry-run]");
  process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEnv = readDotEnv(join(repo, "demo-monorepo-workspace/apps/server/.env"));
const server = (values.server ?? process.env.TCC_SERVER_URL ?? `http://127.0.0.1:${serverEnv.PORT || 8787}`).replace(/\/$/, "");
const token = values.token ?? process.env.TCC_TOKEN ?? serverEnv.TCC_TOKEN;

async function uploadRun(dir) {
  const csvFile = join(dir, "queries.csv");
  if (!existsSync(csvFile)) {
    console.error(`${dir}: no queries.csv`);
    return 1;
  }
  const runJson = existsSync(join(dir, "run.json")) ? JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) : {};
  const rows = parseCsv(readFileSync(csvFile, "utf8"));
  const { uploads, skipped } = buildUploads(rows, runJson);
  writeFileSync(join(dir, "sweep-upload.json"), JSON.stringify(uploads.map((u) => u.body), null, 1));
  console.log(`${dir}: ${rows.length} rows → ${uploads.length} sweep run(s)${skipped.length ? `, ${skipped.length} row(s) skipped (see sweep-upload.json's runs' meta.skipped)` : ""}`);

  if (values["dry-run"]) {
    for (const u of uploads) console.log(`  [dry run] ${u.key}: ${u.body.results.length} results`);
    return 0;
  }
  if (!token) {
    console.error("  no token: pass --token, set TCC_TOKEN, or set TCC_TOKEN in demo-monorepo-workspace/apps/server/.env");
    return 1;
  }

  const receiptFile = join(dir, "uploaded.json");
  const receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, "utf8")) : { server, groups: {} };
  let failed = 0;
  for (const u of uploads) {
    if (receipt.groups[u.key] && !values.force) {
      console.log(`  ${u.key}: already uploaded (${receipt.groups[u.key].id ?? receipt.groups[u.key].spooled}), skipping; --force to resend`);
      continue;
    }
    try {
      receipt.groups[u.key] = { ...(await send(u.body)), at: new Date().toISOString() };
      const g = receipt.groups[u.key];
      console.log(`  ${u.key}: ${g.id ? `stored as sweep ${g.id}` : `kept on the server's disk (${g.spooled}), not in the database yet: pnpm spool:replay there`} (${g.results} results)`);
    } catch (err) {
      failed++;
      console.error(`  ${u.key}: ${err.message}`);
    }
    // after each group, so an interrupted upload resumes where it stopped
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 1));
  }
  if (failed) console.error(`  ${failed} group(s) not sent; the data is in ${csvFile}. Run this again to retry them.`);
  return failed;
}

/** POST /sweeps with the first 50k results, then POST /sweeps/:id/results for the rest. */
async function send(body) {
  const first = await post("/sweeps", { run: body.run, results: body.results.slice(0, MAX_PER_REQUEST) });
  if (!first.id) {
    // 202: the server kept it on disk; appends need a run id, so a >50k run can't continue yet
    if (body.results.length > MAX_PER_REQUEST) throw new Error(`the database is down and this run has more than ${MAX_PER_REQUEST} results: retry when it is back`);
    return { spooled: first.spooled, results: body.results.length };
  }
  for (let i = MAX_PER_REQUEST; i < body.results.length; i += MAX_PER_REQUEST) {
    await post(`/sweeps/${first.id}/results`, { results: body.results.slice(i, i + MAX_PER_REQUEST) });
  }
  return { id: first.id, results: body.results.length };
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(server + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(`can't reach ${server} (${err.cause?.code ?? err.message}): is the server running? (pnpm dev:server in demo-monorepo-workspace)`);
  }
  const text = await res.text();
  if (res.status !== 201 && res.status !== 202) throw new Error(`${server}${path} answered ${res.status}: ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

// ─── CSV rows → SweepUpload bodies (packages/contracts) ─────────────────────────────────────────────

const STRATEGIES = new Set(["adaptive", "main", "worker", "fixed"]);
const OPTIONAL_MS = ["toPaintMs", "prepareMs", "filterMs", "sortMs", "predMainMs", "predWorkerMs", "budgetMs", "postMs", "queueMs", "replyMs"];
// columns that are a sweep_results column (or the group key); everything else goes to `extra`
const MAPPED = new Set([
  "runId", "commit", "browser", "app", "cond", "match", "data", "throttle",
  "sample", "queryId", "step", "strategy", "target", "reason", "explored", "state", "total",
  "computeToResultMs", "mainBlockedMs", "prepared", "sortClass", "mainBusy", "pressure", "loafCount", ...OPTIONAL_MS,
]);

function buildUploads(rows, runJson) {
  const info = runJson.info ?? {};
  const groups = new Map();
  const skipped = [];
  for (const row of rows) {
    const key = [row.app, row.cond, row.match, row.data, `x${row.throttle}`].join(" ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const uploads = [];
  for (const [key, group] of groups) {
    const r0 = group[0];
    // sort steps have no filter, so their `total` is the dataset's row count
    const sortTotals = group.filter((r) => r.step?.startsWith("sort")).map((r) => num(r.total)).filter((n) => n != null);
    const datasetRows = sortTotals.length ? Math.max(...sortTotals) : undefined;
    const groupSkipped = [];
    const results = [];
    for (const row of group) {
      const res = toResult(row, datasetRows);
      if (typeof res === "string") groupSkipped.push({ sample: row.sample, pass: row.pass, step: row.step, why: res });
      else results.push(res);
    }
    skipped.push(...groupSkipped);
    const framework = r0.app?.startsWith("angular") ? "angular" : r0.app === "react" ? "react" : undefined;
    const run = clean({
      source: "harness",
      app: "shop",
      framework,
      buildCommit: (r0.commit || info.commit)?.slice(0, 64),
      userAgent: r0.browser || info.browser ? `Chrome/${r0.browser || info.browser}` : undefined,
      cores: Number.isInteger(info.cores) && info.cores > 0 ? info.cores : undefined,
      throttling: num(r0.throttle) || 1,
      datasetUrl: r0.data?.slice(0, 512),
      datasetRows,
      condition: r0.cond?.slice(0, 32),
      notes: `harness run ${r0.runId || info.runId} (${key})`,
      meta: clean({
        harnessRunId: r0.runId || info.runId,
        appVariant: r0.app, // angular-zone is framework "angular" with zone.js
        match: r0.match,
        os: info.os,
        csp: runJson.csp,
        args: runJson.args,
        skipped: groupSkipped.length ? groupSkipped : undefined,
      }),
    });
    uploads.push({ key, body: { run, results } });
  }
  return { uploads, skipped };
}

/** One CSV row as a SweepResultInput, or why it can't be one. */
function toResult(row, size) {
  if (row.target !== "main" && row.target !== "worker") return `target "${row.target ?? ""}"`;
  const computeToResultMs = num(row.computeToResultMs);
  const mainBlockedMs = num(row.mainBlockedMs);
  if (computeToResultMs == null || computeToResultMs < 0) return `computeToResultMs "${row.computeToResultMs ?? ""}"`;
  if (mainBlockedMs == null || mainBlockedMs < 0) return `mainBlockedMs "${row.mainBlockedMs ?? ""}"`;

  const extra = {};
  for (const [k, v] of Object.entries(row)) if (!MAPPED.has(k) && v !== "") extra[k] = num(v) ?? (v === "true" ? true : v === "false" ? false : v);
  extra.pass = num(row.pass);
  extra.state = row.state;

  const out = {
    rep: int(row.sample),
    queryId: int(row.queryId),
    queryKind: row.step?.slice(0, 64),
    size,
    strategy: STRATEGIES.has(row.strategy) ? row.strategy : undefined,
    target: row.target,
    reason: row.reason?.slice(0, 64) || undefined,
    explored: row.explored === "true" ? true : row.explored === "false" ? false : undefined,
    cold: row.state ? row.state === "cold" : undefined,
    total: nonNegInt(row.total),
    computeToResultMs,
    mainBlockedMs,
    prepared: nonNegInt(row.prepared),
    sortClass: row.sortClass?.slice(0, 16) || undefined,
    pressure: row.pressure?.slice(0, 16) || undefined,
    loafCount: nonNegInt(row.loafCount),
    extra,
  };
  for (const k of OPTIONAL_MS) {
    const v = num(row[k]);
    if (v == null) continue;
    if (v >= 0) out[k] = v;
    else extra[`${k}Raw`] = v; // the contract wants ms ≥ 0; keep the odd value instead of failing the run
  }
  const busy = num(row.mainBusy);
  if (busy != null) {
    if (busy >= 0 && busy <= 1) out.mainBusy = busy;
    else extra.mainBusyRaw = busy;
  }
  return clean(out);
}

// ─── helpers ────────────────────────────────────────────────────────────────────────────────────────

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v) {
  const n = num(v);
  return n != null && Number.isInteger(n) ? n : undefined;
}
function nonNegInt(v) {
  const n = int(v);
  return n != null && n >= 0 ? n : undefined;
}
function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** RFC 4180: quoted fields, "" escapes, newlines inside quotes. Returns objects keyed by the header. */
function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...body] = records;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function readDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

// last: the constants above must be initialized before the first run is read
let failures = 0;
for (const dir of positionals) failures += await uploadRun(resolve(dir));
process.exitCode = failures ? 1 : 0;
