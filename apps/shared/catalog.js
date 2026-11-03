// Framework-neutral catalog. Apart from the core, this is the only code the
// React and Angular shops share. Both stores call the same `run(query)`, so the
// two apps differ only in how they render and how their state library passes
// the result on. Plain JS + JSDoc, like the core.

import { start } from "../../src/index.js";
import { dictString } from "../../src/data/columnar.js";

/** @typedef {import("../../src/types.js").OpSpec} OpSpec */
/** @typedef {import("../../src/types.js").Filter} Filter */
/** @typedef {import("../../src/types.js").Column} Column */
/** @typedef {import("../../src/types.js").Dict} Dict */
/** @typedef {import("../../src/types.js").Strategy} Strategy */
/** @typedef {import("../../src/scheduler/scheduler.js").Decision} Decision */

/**
 * What the sidebar, search bar and table headers produce. `sorting` is
 * TanStack's SortingState (`{ id, desc }[]`), so it maps 1:1.
 * @typedef {object} CatalogQuery
 * @property {string} search
 * @property {string[]} categories
 * @property {[number | null, number | null]} price
 * @property {boolean} inStock
 * @property {{ id: string, desc: boolean }[]} sorting
 */

/**
 * One product as the UI sees it. Products are decoded on demand, one page at a
 * time: 600k of these objects would create exactly the heap pressure the
 * thesis is measuring.
 * @typedef {object} Product
 * @property {number} index row in the dataset (stable key)
 * @property {string} id
 * @property {string} name
 * @property {string} sku
 * @property {string} categoria
 * @property {number} price
 * @property {number} stock
 * @property {number} icms
 * @property {number} createdAt epoch ms
 */

/**
 * @typedef {object} CatalogResult
 * @property {number} queryId
 * @property {Uint32Array} indices
 * @property {number} total
 * @property {"main" | "worker"} target
 * @property {Decision} decision
 * @property {number} totalMs
 * @property {number} mainBlockedMs
 */

/** @type {CatalogQuery} */
export const EMPTY_QUERY = { search: "", categories: [], price: [null, null], inStock: false, sorting: [] };

/** Both apps use the same debounce: a timer in the Zustand action, `debounceTime` in RxJS. */
export const SEARCH_DEBOUNCE_MS = 250;
export const PAGE_SIZE = 48;

/** Table column id → dataset column. */
/** @type {Record<string, string>} */
const COLUMN = { name: "name", sku: "sku", categoria: "categoria", price: "valor_de_venda", stock: "quantidade_em_estoque", createdAt: "data_de_cadastro" };

/**
 * @param {CatalogQuery} q
 * @param {{ comparator?: "auto" | "locale", limit?: number }} [opts]
 * @returns {OpSpec}
 */
export function toSpec(q, opts = {}) {
  /** @type {Filter[]} */
  const filters = [];
  // Cheap, selective filters go first: each later filter only scans the rows that survived.
  if (q.categories.length) filters.push({ column: "categoria", op: "in", value: q.categories });
  const [lo, hi] = q.price;
  if (lo !== null && hi !== null) filters.push({ column: "valor_de_venda", op: "between", value: [lo, hi] });
  else if (lo !== null) filters.push({ column: "valor_de_venda", op: "gte", value: lo });
  else if (hi !== null) filters.push({ column: "valor_de_venda", op: "lte", value: hi });
  if (q.inStock) filters.push({ column: "quantidade_em_estoque", op: "gte", value: 1 });
  const search = q.search.trim();
  if (search) filters.push({ column: "name", op: "contains", value: search });
  const sort = q.sorting.map((s) => ({
    column: COLUMN[s.id] ?? s.id,
    desc: s.desc,
    ...(opts.comparator === "locale" ? { comparator: /** @type {const} */ ("locale") } : {}),
  }));
  return { filters, sort, ...(opts.limit ? { limit: opts.limit } : {}) };
}

/**
 * @param {{ dataUrl: string, strategy?: Strategy, comparator?: "auto" | "locale", limit?: number, workerFactory?: () => Worker }} options
 */
export async function createCatalog(options) {
  const app = await start({ dataUrl: options.dataUrl, strategy: options.strategy, workerUrl: options.workerFactory });
  const ds = app.dataset;
  const col = (/** @type {string} */ name) => {
    const c = ds.byName.get(name);
    if (!c) throw new Error(`dataset has no column ${name}`);
    return c;
  };
  const c = {
    id: col("id"),
    name: col("name"),
    sku: col("sku"),
    categoria: col("categoria"),
    price: col("valor_de_venda"),
    stock: col("quantidade_em_estoque"),
    icms: col("icms"),
    created: col("data_de_cadastro"),
  };
  const str = (/** @type {Column} */ k, /** @type {number} */ i) => (k.dict ? (dictString(k.dict, k.values[i]) ?? "") : "");

  /** @param {number} i @returns {Product} */
  const productAt = (i) => ({
    index: i,
    id: str(c.id, i),
    name: str(c.name, i),
    sku: str(c.sku, i),
    categoria: str(c.categoria, i),
    price: c.price.values[i],
    stock: c.stock.values[i],
    icms: c.icms.values[i],
    createdAt: c.created.values[i],
  });

  // Facets: 10 categories, decoded once. Cheap, and the name dictionary is never touched.
  const catDict = /** @type {Dict} */ (c.categoria.dict);
  const categories = Array.from({ length: catDict.count }, (_, k) => dictString(catDict, k) ?? "").filter(Boolean);

  // Warm the cost model on tiny inputs, the same way the lab demo does, without decoding names on main.
  await app.scheduler.calibrate([
    { filters: [{ column: "categoria", op: "contains", value: "a" }], limit: 2000 },
    { sort: [{ column: "valor_de_venda" }], limit: 2000 },
    { sort: [{ column: "sku" }], limit: 2000 },
  ]);

  let latest = 0;
  return {
    app,
    rows: ds.rows,
    categories,
    productAt,
    /** @param {Uint32Array} indices @param {number} page @param {number} size @returns {Product[]} */
    page(indices, page, size) {
      const out = [];
      for (let k = page * size, end = Math.min(indices.length, k + size); k < end; k++) out.push(productAt(indices[k]));
      return out;
    },
    /** Fixed picks, so both apps show the same recommendations. @param {number} n @returns {Product[]} */
    recommendations(n) {
      const out = [];
      for (let k = 1; k <= n; k++) out.push(productAt((k * 2654435761) % ds.rows));
      return out;
    },
    /**
     * Resolves null when a newer query superseded this one.
     * @param {CatalogQuery} q
     * @returns {Promise<CatalogResult | null>}
     */
    async run(q) {
      const queryId = ++latest;
      performance.mark(`shop:query:${queryId}:start`);
      const r = await app.scheduler.run(toSpec(q, options), { channel: "catalog" });
      if (r.stale || queryId !== latest) return null;
      performance.mark(`shop:query:${queryId}:result`);
      return { queryId, indices: r.indices, total: r.indices.length, target: r.target, decision: r.decision, totalMs: r.timing.totalMs, mainBlockedMs: r.timing.mainBlockedMs };
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof createCatalog>>} Catalog */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** @param {number} v */
export const formatPrice = (v) => (Number.isNaN(v) ? "—" : brl.format(v));
