// Column metadata that both TanStack adapters map to their own ColumnDef.
// Keeping it here gives both tables the same columns, order and sort flags.

import { formatPrice } from "./catalog.js";

/** @typedef {import("./catalog.js").Product} Product */

/**
 * @typedef {object} ColumnMeta
 * @property {"name" | "sku" | "categoria" | "price" | "stock" | "createdAt"} id
 * @property {string} header
 * @property {boolean} sortable
 * @property {"left" | "right"} align
 * @property {(p: Product) => string} format
 */

const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

/** @type {ColumnMeta[]} */
export const COLUMNS = [
  { id: "name", header: "Produto", sortable: true, align: "left", format: (p) => p.name },
  { id: "sku", header: "SKU", sortable: true, align: "left", format: (p) => p.sku },
  { id: "categoria", header: "Categoria", sortable: true, align: "left", format: (p) => p.categoria },
  { id: "price", header: "Preço", sortable: true, align: "right", format: (p) => formatPrice(p.price) },
  { id: "stock", header: "Estoque", sortable: true, align: "right", format: (p) => String(p.stock) },
  { id: "createdAt", header: "Cadastro", sortable: true, align: "right", format: (p) => (Number.isNaN(p.createdAt) ? "—" : date.format(p.createdAt)) },
];

/** Sort options for the grid view's select; same list in both apps. */
export const SORT_OPTIONS = [
  { label: "Relevância", sorting: [] },
  { label: "Menor preço", sorting: [{ id: "price", desc: false }] },
  { label: "Maior preço", sorting: [{ id: "price", desc: true }] },
  { label: "Nome A–Z", sorting: [{ id: "name", desc: false }] },
  { label: "Mais recentes", sorting: [{ id: "createdAt", desc: true }] },
];
