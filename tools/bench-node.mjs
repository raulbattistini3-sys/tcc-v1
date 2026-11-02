#!/usr/bin/env node
// Quick sanity numbers for runOp on the real file, outside the browser.
// Browser numbers are the ones that count; this only checks the order of magnitude.
//   node tools/bench-node.mjs [data/produtos.bin]

import { readFile } from "node:fs/promises";
import { openColumnar } from "../src/data/columnar.js";
import { runOp } from "../src/compute/compute.js";

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
