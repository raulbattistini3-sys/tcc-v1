// Framework-neutral pieces of the two marketplace apps (apps/market-react, apps/market-angular).
// Like catalog.js, everything both apps show or query comes from here, so the two differ only in how
// they render and how their state library passes results on. Plain JS + JSDoc.
//
// The dataset has id, name, sku, categoria, price, stock, icms and createdAt. What a marketplace card
// also shows (rating, reviews, list price, free shipping, installments) is derived deterministically
// from the row index here, so every app and every run shows the same numbers.

import { EMPTY_QUERY } from "./catalog.js";

/** @typedef {import("./catalog.js").Catalog} Catalog */
/** @typedef {import("./catalog.js").CatalogQuery} CatalogQuery */
/** @typedef {import("./catalog.js").Product} Product */
/** @typedef {import("../../src/types.js").OpSpec} OpSpec */

/** @type {Record<string, string>} */
const LABELS = {
  ELETRONICOS: "Eletrônicos",
  INFORMATICA: "Informática",
  ELETRODOMESTICOS: "Eletrodomésticos",
  CELULARES: "Celulares",
  MERCADO: "Mercado",
  CASA: "Casa",
  "COMERCIO & SEGURANCA": "Comércio e segurança",
  "LAZER E ENTRETENIMENTO": "Lazer e entretenimento",
  MODA: "Moda",
  "ESPORTE E SAUDE": "Esporte e saúde",
};

/** @param {string} name */
export const categoryLabel = (name) => LABELS[name] ?? name.charAt(0) + name.slice(1).toLowerCase();

/** 32-bit mix of a row index: the same "random" extras for a product in every app. @param {number} i */
function mix(i) {
  let h = (i + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const FREE_SHIPPING_FROM = 79;
const MAX_INSTALLMENTS = 12;
const MIN_INSTALLMENT = 20;

/**
 * @typedef {object} MarketDetails
 * @property {number} rating 3.5–5.0, one decimal
 * @property {number} reviews
 * @property {number | null} listPrice the "de R$ …" price, when the product is on sale
 * @property {number} discountPct 0 when not on sale
 * @property {boolean} freeShipping
 * @property {{ n: number, value: number } | null} installments interest-free, null when one payment
 */

/** @param {Product} p @returns {MarketDetails} */
export function marketDetails(p) {
  const h = mix(p.index);
  const onSale = h % 3 === 0;
  const discountPct = onSale ? 5 + (h % 36) : 0;
  const price = Number.isNaN(p.price) ? 0 : p.price;
  const n = Math.min(MAX_INSTALLMENTS, Math.floor(price / MIN_INSTALLMENT));
  return {
    rating: Math.round((3.5 + ((h >>> 8) % 16) / 10) * 10) / 10,
    reviews: (h >>> 12) % 4000,
    listPrice: onSale && price > 0 ? Math.round((price / (1 - discountPct / 100)) * 100) / 100 : null,
    discountPct,
    freeShipping: price >= FREE_SHIPPING_FROM || (h >>> 4) % 5 === 0,
    installments: n >= 2 ? { n, value: Math.round((price / n) * 100) / 100 } : null,
  };
}

/** A paragraph for the product page, from the product's own fields. @param {Product} p */
export function productDescription(p) {
  return (
    `${p.name}, da categoria ${categoryLabel(p.categoria)}. ` +
    `Código ${p.sku}. ${p.stock > 0 ? `${p.stock} unidades em estoque, envio em até 2 dias úteis.` : "Sem estoque no momento."} ` +
    `Compra garantida: receba o produto que está esperando ou devolvemos o dinheiro.`
  );
}

/**
 * Home page banners. Colors are design tokens, not images: the hero costs layout and paint, not image
 * decoding, the same in both apps.
 * @type {{ id: string, title: string, subtitle: string, cta: string, category: string, from: string, to: string }[]}
 */
export const BANNERS = [
  { id: "celulares", title: "Semana dos celulares", subtitle: "Até 12x sem juros e frete grátis acima de R$ 79", cta: "Ver celulares", category: "CELULARES", from: "#3b5bdb", to: "#7048e8" },
  { id: "casa", title: "Casa nova, preço novo", subtitle: "Eletrodomésticos e utilidades com até 40% off", cta: "Ver ofertas", category: "ELETRODOMESTICOS", from: "#0b7285", to: "#2b8a3e" },
  { id: "informatica", title: "Monte seu setup", subtitle: "Notebooks, monitores e periféricos", cta: "Ver informática", category: "INFORMATICA", from: "#212529", to: "#495057" },
  { id: "moda", title: "Coleção de verão", subtitle: "Moda e acessórios a partir de R$ 29", cta: "Ver moda", category: "MODA", from: "#c2255c", to: "#f08c00" },
];
export const BANNER_INTERVAL_MS = 5000;

// ─── Listing URL ⇄ query ──────────────────────────────────────────────────────────────────────────
// /lista?q=…&cat=A&cat=B&min=10&max=200&estoque=1&ordem=menor-preco

/** @type {{ value: string, label: string, sorting: CatalogQuery["sorting"] }[]} */
export const SORTS = [
  { value: "relevancia", label: "Mais relevantes", sorting: [] },
  { value: "menor-preco", label: "Menor preço", sorting: [{ id: "price", desc: false }] },
  { value: "maior-preco", label: "Maior preço", sorting: [{ id: "price", desc: true }] },
  { value: "recentes", label: "Mais recentes", sorting: [{ id: "createdAt", desc: true }] },
  { value: "nome", label: "Nome (A–Z)", sorting: [{ id: "name", desc: false }] },
];

/** @param {CatalogQuery["sorting"]} sorting */
export const sortValue = (sorting) => SORTS.find((s) => JSON.stringify(s.sorting) === JSON.stringify(sorting))?.value ?? "relevancia";

/** @param {string | null} v */
const num = (v) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * @param {URLSearchParams} params
 * @param {import("./catalog.js").SearchMode} searchMode
 * @returns {CatalogQuery}
 */
export function queryFromParams(params, searchMode) {
  return {
    ...EMPTY_QUERY,
    searchMode,
    search: params.get("q") ?? "",
    categories: params.getAll("cat"),
    price: [num(params.get("min")), num(params.get("max"))],
    inStock: params.get("estoque") === "1",
    sorting: SORTS.find((s) => s.value === params.get("ordem"))?.sorting ?? [],
  };
}

/** @param {CatalogQuery} q @returns {Record<string, string | string[]>} */
export function paramsFromQuery(q) {
  /** @type {Record<string, string | string[]>} */
  const out = {};
  if (q.search.trim()) out.q = q.search.trim();
  if (q.categories.length) out.cat = q.categories;
  if (q.price[0] !== null) out.min = String(q.price[0]);
  if (q.price[1] !== null) out.max = String(q.price[1]);
  if (q.inStock) out.estoque = "1";
  const ordem = sortValue(q.sorting);
  if (ordem !== "relevancia") out.ordem = ordem;
  return out;
}

/** @param {Record<string, string | string[]>} p */
export function toSearchString(p) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) for (const x of Array.isArray(v) ? v : [v]) s.append(k, x);
  const str = s.toString();
  return str ? `?${str}` : "";
}

// ─── Queries outside the listing ──────────────────────────────────────────────────────────────────
// The listing goes through catalog.run (channel "catalog"), which drops superseded results. The home
// rails and the product page's related products run on their own channels, so they never make a
// listing result stale or the other way around.

/**
 * Runs a spec on its own scheduler channel. Resolves null when a newer run on the same channel
 * superseded it.
 * @param {Catalog} catalog
 * @param {OpSpec} spec
 * @param {string} channel
 * @returns {Promise<Uint32Array | null>}
 */
export async function runOnChannel(catalog, spec, channel) {
  const r = await catalog.app.scheduler.run(spec, { channel });
  return r.stale ? null : r.indices;
}

/** "Ofertas do dia": in stock, most expensive first among a slice; every k-th, for variety. */
export const DEALS_SPEC = /** @type {OpSpec} */ ({
  filters: [{ column: "quantidade_em_estoque", op: "gte", value: 1 }],
  sort: [{ column: "valor_de_venda", desc: true }],
  limit: 50_000,
});

/** Same category, cheapest first. @param {Product} p @returns {OpSpec} */
export const relatedSpec = (p) => ({
  filters: [{ column: "categoria", op: "in", value: [p.categoria] }],
  sort: [{ column: "valor_de_venda", desc: false }],
  limit: 200_000,
});

/**
 * Picks n spread-out rows of a result, skipping one index.
 * @param {Uint32Array} indices @param {number} n @param {number} [skip]
 * @returns {number[]}
 */
export function spread(indices, n, skip = -1) {
  const out = [];
  const step = Math.max(1, Math.floor(indices.length / (n + 1)));
  for (let k = 0; k < indices.length && out.length < n; k += step) if (indices[k] !== skip) out.push(/** @type {number} */ (indices[k]));
  return out;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** @param {MarketDetails["installments"]} i */
export const installmentText = (i) => (i ? `em ${i.n}x ${brl.format(i.value)} sem juros` : "à vista");

/** Grid geometry both apps use: same card size, same rows, so the same cards are on screen. */
export const GRID = { minCardWidth: 220, rowHeight: 392, gap: 16, overscanRows: 2 };

/** "Novidades": most recently registered first. */
export const NEWEST_SPEC = /** @type {OpSpec} */ ({ sort: [{ column: "data_de_cadastro", desc: true }], limit: 50_000 });
