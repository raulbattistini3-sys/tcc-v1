#!/usr/bin/env node
// Quick sanity numbers for runOp on the real file, outside the browser.
// Browser numbers are the ones that count; this only checks the order of magnitude.
//   node tools/bench-node.mjs [data/produtos.bin]

import { readFile } from "node:fs/promises";
import { openColumnar } from "../src/data/columnar.js";
import { runOp, textIndexStats } from "../src/compute/compute.js";

const file = process.argv[2] ?? "data/produtos.bin";
const buf = await readFile(file);
const t0 = performance.now();
const ds = openColumnar(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.log(`opened ${ds.rows} rows in ${(performance.now() - t0).toFixed(2)} ms`);

const cases = [
  ["sort num", { sort: [{ column: "valor_de_venda", desc: true }] }],
  ["sort code (name)", { sort: [{ column: "name" }] }],
  ["sort locale (name)", { sort: [{ column: "name", comparator: "locale" }] }],
  ["filter contains", { filters: [{ column: "name", op: "contains", value: "ssd" }] }],
  ["filter token", { filters: [{ column: "name", op: "token", value: "ssd" }] }],
  ["filter prefix", { filters: [{ column: "name", op: "prefix", value: "ss" }] }],
  ["filter + sort", { filters: [{ column: "categoria", op: "contains", value: "info" }], sort: [{ column: "valor_de_custo" }] }],
];
for (const n of [10_000, 100_000, 600_034]) {
  for (const [label, spec] of cases) {
    if (label.includes("locale") && n > 100_000) continue;
    const r = runOp(ds, { ...spec, limit: n });
    console.log(
      `${String(n).padStart(7)}  ${label.padEnd(20)} prep ${r.prepareMs.toFixed(1).padStart(7)}  filter ${r.filterMs.toFixed(1).padStart(6)}  sort ${r.sortMs.toFixed(1).padStart(7)} ms  → ${r.matched} rows`,
    );
  }
}

// Filter modes, cold then warm, with heap growth. Run with --expose-gc for clean numbers.
const gc = /** @type {any} */ (globalThis).gc ?? (() => {});
const heap = () => (gc(), process.memoryUsage().heapUsed);
const nameDict = /** @type {any} */ (ds.byName.get("name")).dict;
console.log("\nfilter modes on name (600k distinct strings): first call includes building the cache it needs");
for (const [op, q] of [["contains", "mouse"], ["token", "mouse"], ["prefix", "mou"], ["contains", "sem fio"], ["token", "sem fio"], ["prefix", "se fi"]]) {
  const h0 = heap();
  const runs = [0, 1, 2, 3, 4].map(() => runOp(ds, { filters: [{ column: "name", op: /** @type {any} */ (op), value: q }] }));
  const warm = runs.slice(1).map((r) => r.filterMs).sort((a, b) => a - b)[2];
  console.log(`${op.padEnd(9)} ${JSON.stringify(q).padEnd(10)} cold prep ${runs[0].prepareMs.toFixed(0).padStart(5)} ms  cold filter ${runs[0].filterMs.toFixed(1).padStart(6)}  warm filter (median) ${warm.toFixed(1).padStart(6)} ms  heap +${((heap() - h0) / 1048576).toFixed(1)} MB  → ${runs[0].matched}`);
}
const st = textIndexStats(nameDict);
if (st) console.log(`index: ${st.terms} terms, ${st.postings} postings, ~${(st.bytes / 1048576).toFixed(1)} MB, built in ${st.buildMs.toFixed(0)} ms`);
