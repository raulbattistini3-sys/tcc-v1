// The one compute function both threads run. It is pure apart from the
// per-thread string cache in columnar.js, so main-thread and worker results
// are identical and timings are comparable.

import { dictStrings, isDecoded, NULL_I32, NULL_U8 } from "../data/columnar.js";

/** @typedef {import("../types.js").Dataset} Dataset */
/** @typedef {import("../types.js").Column} Column */
/** @typedef {import("../types.js").OpSpec} OpSpec */
/** @typedef {import("../types.js").OpResult} OpResult */
/** @typedef {import("../types.js").Filter} Filter */
/** @typedef {import("../types.js").SortKey} SortKey */
/** @typedef {import("../types.js").SortClass} SortClass */

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Filters, then sorts, the first `spec.limit` rows.
 *
 * @param {Dataset} ds
 * @param {OpSpec} spec
 * @returns {OpResult}
 */
export function runOp(ds, spec) {
  const n = Math.min(spec.limit ?? ds.rows, ds.rows);
  const filters = spec.filters ?? [];
  const sort = spec.sort ?? [];

  // One-off string decoding happens here, timed apart so a cold cache doesn't
  // look like a slow device to the cost model.
  const tp = performance.now();
  let prepared = 0;
  for (const need of stringNeeds(ds, spec)) {
    if (isWarm(need)) continue;
    prepared += need.dict.count;
    if (need.kind === "lower") lowerStrings(need.dict);
    else dictStrings(need.dict);
  }
  const t0 = performance.now();
  /** @type {Uint32Array} */
  let idx;
  if (filters.length === 0) {
    idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
  } else {
    idx = applyFilter(ds, filters[0], null, n);
    for (let f = 1; f < filters.length; f++) idx = applyFilter(ds, filters[f], idx, n);
  }
  const t1 = performance.now();

  const sortClass = classifySort(ds, sort);
  if (sort.length > 0 && idx.length > 1) idx.sort(comparator(ds, sort));
  const t2 = performance.now();

  return {
    indices: idx,
    scanned: n * filters.length,
    matched: idx.length,
    prepareMs: t0 - tp,
    prepared,
    filterMs: t1 - t0,
    sortMs: t2 - t1,
    sortUnits: sortUnits(idx.length, sort.length),
    sortClass,
  };
}

/**
 * A string cache an op depends on: `lower` for contains/eq filters,
 * `decoded` for the locale comparator.
 * @typedef {{ key: string, kind: "lower" | "decoded", dict: import("../types.js").Dict }} StringNeed
 */

/**
 * Lists the string caches `spec` needs, so a caller can tell in advance how
 * much one-off decoding a thread will do.
 *
 * @param {Dataset} ds
 * @param {OpSpec} spec
 * @returns {StringNeed[]}
 */
export function stringNeeds(ds, spec) {
  /** @type {Map<string, StringNeed>} */
  const needs = new Map();
  for (const f of spec.filters ?? []) {
    const col = column(ds, f.column);
    if (col.dict) needs.set(`${col.name}:lower`, { key: `${col.name}:lower`, kind: "lower", dict: col.dict });
  }
  for (const k of spec.sort ?? []) {
    const col = column(ds, k.column);
    if (col.dict && (k.comparator === "locale" || !col.dict.sorted)) needs.set(`${col.name}:decoded`, { key: `${col.name}:decoded`, kind: "decoded", dict: col.dict });
  }
  return [...needs.values()];
}

/**
 * True when this thread already has the cache.
 *
 * @param {StringNeed} need
 */
export function isWarm(need) {
  return need.kind === "lower" ? lowerCache.has(need.dict.bytes) : isDecoded(need.dict);
}

/**
 * Work units for sorting m rows by k keys: m · log2(m) · k.
 *
 * @param {number} m
 * @param {number} keys
 */
export function sortUnits(m, keys) {
  return keys === 0 || m < 2 ? 0 : m * Math.log2(m) * keys;
}

/**
 * The most expensive comparator among the keys decides the cost class.
 *
 * @param {Dataset} ds
 * @param {SortKey[]} sort
 * @returns {SortClass}
 */
export function classifySort(ds, sort) {
  /** @type {SortClass} */
  let cls = "none";
  const rank = { none: 0, num: 1, code: 2, locale: 3 };
  for (const key of sort) {
    const col = column(ds, key.column);
    /** @type {SortClass} */
    const c = col.type !== "dict" ? "num" : key.comparator === "locale" || !col.dict?.sorted ? "locale" : "code";
    if (rank[c] > rank[cls]) cls = c;
  }
  return cls;
}

/**
 * @param {Dataset} ds
 * @param {string} name
 */
function column(ds, name) {
  const col = ds.byName.get(name);
  if (!col) throw new Error(`unknown column ${name}`);
  return col;
}

/**
 * @param {Dataset} ds
 * @param {Filter} f
 * @param {Uint32Array | null} input rows to test; null means 0..n-1
 * @param {number} n
 * @returns {Uint32Array}
 */
function applyFilter(ds, f, input, n) {
  const col = column(ds, f.column);
  const test = rowTest(col, f);
  const len = input ? input.length : n;
  const out = new Uint32Array(len);
  let m = 0;
  if (input) {
    for (let i = 0; i < len; i++) {
      const r = input[i];
      if (test(r)) out[m++] = r;
    }
  } else {
    for (let r = 0; r < len; r++) if (test(r)) out[m++] = r;
  }
  // slice gives an exactly sized buffer, which is what gets transferred back.
  return out.slice(0, m);
}

/** @type {WeakMap<Uint8Array, string[]>} */
const lowerCache = new WeakMap();

/**
 * Lowercased dictionary, decoded once per thread like `dictStrings`.
 *
 * @param {import("../types.js").Dict} dict
 */
function lowerStrings(dict) {
  let lower = lowerCache.get(dict.bytes);
  if (!lower) {
    lower = dictStrings(dict).map((s) => s.toLowerCase());
    lowerCache.set(dict.bytes, lower);
  }
  return lower;
}

/**
 * Builds a per-row predicate. For dictionary columns the string test runs once
 * per distinct value, then rows only look up a byte.
 *
 * @param {Column} col
 * @param {Filter} f
 * @returns {(row: number) => boolean}
 */
function rowTest(col, f) {
  const v = col.values;
  if (col.type === "dict") {
    if (!col.dict) throw new Error(`${col.name}: dictionary missing`);
    const strings = lowerStrings(col.dict);
    const q = String(f.value).toLowerCase();
    const eq = f.op === "eq";
    // Memo per code (0 unknown, 1 match, 2 no match): each distinct string is
    // tested once, and only if some row in range uses it. Cost follows
    // min(rows, distinct values), not the dictionary size.
    const memo = new Uint8Array(col.dict.count);
    return (r) => {
      const c = v[r];
      if (c < 0) return false;
      let m = memo[c];
      if (m === 0) {
        const s = strings[c];
        memo[c] = m = (eq ? s === q : s.includes(q)) ? 1 : 2;
      }
      return m === 1;
    };
  }

  if (col.type === "u8") {
    const want = f.value === true || f.value === 1 || f.value === "true" ? 1 : 0;
    return (r) => v[r] !== NULL_U8 && v[r] === want;
  }

  const isNull = col.type === "i32" ? (/** @type {number} */ x) => x === NULL_I32 : Number.isNaN;
  const [lo, hi] =
    f.op === "between" && Array.isArray(f.value)
      ? f.value
      : f.op === "gte"
        ? [Number(f.value), Infinity]
        : f.op === "lte"
          ? [-Infinity, Number(f.value)]
          : [Number(f.value), Number(f.value)];
  return (r) => {
    const x = v[r];
    return !isNull(x) && x >= lo && x <= hi;
  };
}

/**
 * Multi-key comparator over typed arrays. Nulls sort last in either
 * direction; ties fall back to row order so the result is deterministic.
 *
 * @param {Dataset} ds
 * @param {SortKey[]} sort
 * @returns {(a: number, b: number) => number}
 */
function comparator(ds, sort) {
  const parts = sort.map((key) => {
    const col = column(ds, key.column);
    const dir = key.desc ? -1 : 1;
    const v = col.values;
    if (col.type === "dict") {
      if (key.comparator === "locale" || !col.dict?.sorted) {
        const s = dictStrings(/** @type {import("../types.js").Dict} */ (col.dict));
        return (/** @type {number} */ a, /** @type {number} */ b) => {
          const x = v[a];
          const y = v[b];
          if (x < 0 || y < 0) return x < 0 ? (y < 0 ? 0 : 1) : -1;
          return dir * collator.compare(s[x], s[y]);
        };
      }
      return (/** @type {number} */ a, /** @type {number} */ b) => {
        const x = v[a];
        const y = v[b];
        if (x < 0 || y < 0) return x < 0 ? (y < 0 ? 0 : 1) : -1;
        return dir * (x - y);
      };
    }
    const isNull =
      col.type === "f64" ? Number.isNaN : col.type === "i32" ? (/** @type {number} */ x) => x === NULL_I32 : (/** @type {number} */ x) => x === NULL_U8;
    return (/** @type {number} */ a, /** @type {number} */ b) => {
      const x = v[a];
      const y = v[b];
      const nx = isNull(x);
      const ny = isNull(y);
      if (nx || ny) return nx ? (ny ? 0 : 1) : -1;
      return dir * (x - y);
    };
  });

  if (parts.length === 1) {
    const only = parts[0];
    return (a, b) => only(a, b) || a - b;
  }
  return (a, b) => {
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i](a, b);
      if (c !== 0) return c;
    }
    return a - b;
  };
}
