#!/usr/bin/env node
// Converts the pgcopy export into the TCC1 columnar file the browser loads.
//
//   node tools/build-columnar.mjs [input] [output] [--limit N]
//
// input: compact.zip (holding dados.json), dados.json, or a folder of CSVs is
// not supported, only the JSON shape agrupar.rs writes:
//   { "categorias": [...], "produtos": [...], ... }
//
// Why: 180 MB of JSON costs seconds of JSON.parse on the main thread and
// ~10× that in heap as JS objects. The columnar file is ~100 MB of typed
// arrays the page opens with zero parsing and can hand to a worker whole.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { encodeColumnar, NULL_I32, NULL_U8 } from "../src/data/columnar.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const limit = Number(flag("--limit") ?? Infinity);
const input = resolve(args[0] ?? "additional-scripts/pgcopy/export/compact.zip");
const output = resolve(args[1] ?? "data/produtos.bin");

const t0 = performance.now();
const raw = await readFile(input);
const json = input.toLowerCase().endsWith(".zip") ? unzipFirst(raw, "dados.json") : raw;
console.log(`read ${mb(raw.length)} → ${mb(json.length)} JSON in ${ms(t0)}`);

const t1 = performance.now();
const dados = JSON.parse(json.toString("utf8"));
console.log(`JSON.parse ${ms(t1)} (this is what the page would pay on its main thread)`);

const categorias = new Map((dados.categorias ?? []).map((c) => [c.id, c.nome]));
/** @type {Record<string, unknown>[]} */
const produtos = (dados.produtos ?? []).slice(0, limit);
const rows = produtos.length;
if (rows === 0) throw new Error("no produtos in input");

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const int = (v) => (v === null || v === undefined || v === "" ? NULL_I32 : Math.trunc(Number(v)));
const bool = (v) => (v === null || v === undefined ? NULL_U8 : v === true || v === "t" || v === "true" ? 1 : 0);
const str = (v) => (v === null || v === undefined ? null : String(v));
// Timestamps have no zone in the export; read them as UTC so every machine agrees.
const ts = (v) => (v ? Date.parse(String(v).replace(" ", "T") + (/[zZ]|[+-]\d\d(:?\d\d)?$/.test(String(v)) ? "" : "Z")) : NaN);
const col = (name, f) => produtos.map((p) => f(p[name]));

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const t2 = performance.now();
const buffer = encodeColumnar(
  rows,
  [
    { name: "name", type: "dict", strings: col("name", str), compare: collator.compare },
    { name: "sku", type: "dict", strings: col("sku", str), compare: byCode },
    { name: "categoria", type: "dict", strings: produtos.map((p) => str(categorias.get(p.categoria_id) ?? p.categoria_id)), compare: collator.compare },
    { name: "valor_de_custo", type: "f64", values: col("valor_de_custo", num) },
    { name: "valor_de_venda", type: "f64", values: col("valor_de_venda", num) },
    { name: "icms", type: "f64", values: col("icms", num) },
    { name: "quantidade_em_estoque", type: "i32", values: col("quantidade_em_estoque", int) },
    { name: "data_de_cadastro", type: "f64", values: col("data_de_cadastro", ts) },
    { name: "ativo", type: "u8", values: col("ativo", bool) },
    // ids last: never displayed, only kept so results can be joined back.
    { name: "id", type: "dict", strings: col("id", str), compare: byCode },
  ],
  { source: input.replace(/\\/g, "/").split("/").slice(-2).join("/"), table: "produtos", builtAt: new Date().toISOString() },
);
console.log(`encoded ${rows} rows in ${ms(t2)} (dictionaries sorted with pt-BR collation)`);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, new Uint8Array(buffer));
console.log(`wrote ${output} (${mb(buffer.byteLength)}) total ${ms(t0)}`);

/**
 * Minimal ZIP reader: finds `name` through the central directory and
 * inflates it. Enough for archives made by Explorer, 7-Zip or `zip`.
 */
function unzipFirst(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (entry.split("/").at(-1) !== name) continue;
    if (csize === 0xffffffff || local === 0xffffffff) throw new Error("zip64 archives are not supported");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
    throw new Error(`unsupported zip compression method ${method}`);
  }
  throw new Error(`${name} not found in zip`);
}

function mb(n) {
  return `${(n / 1048576).toFixed(1)} MB`;
}
function ms(since) {
  return `${((performance.now() - since) / 1000).toFixed(2)}s`;
}
