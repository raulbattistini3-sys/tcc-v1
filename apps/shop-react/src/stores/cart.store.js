// Cart domain: one cart per session owner, kept in sessionStorage. Switching
// user swaps which cart is active, and the guest cart is kept separately.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** @typedef {import("@shared/catalog.js").Product} Product */

/**
 * @typedef {object} CartLine
 * @property {number} index product row, the line key
 * @property {string} name
 * @property {string} sku
 * @property {number} price
 * @property {number} qty
 */

/**
 * @typedef {object} CartState
 * @property {string} owner user id, or "guest"
 * @property {Record<string, CartLine[]>} carts
 * @property {(p: Product) => void} add
 * @property {(index: number, qty: number) => void} setQty
 * @property {(index: number) => void} remove
 * @property {() => void} clear
 * @property {(owner: string) => void} switchOwner
 */

/** @type {CartLine[]} */
const NONE = [];
// A shared empty array: a fresh `[]` per call would make the selector unstable and loop the render.
/** @param {CartState} s */
const linesOf = (s) => s.carts[s.owner] ?? NONE;

export const useCartStore = create(
  persist(
    /** @returns {CartState} */
    (set) => {
      /** @param {(lines: CartLine[]) => CartLine[]} f */
      const update = (f) => set((s) => ({ carts: { ...s.carts, [s.owner]: f(linesOf(s)) } }));
      return {
        owner: "guest",
        carts: {},
        add: (p) =>
          update((lines) =>
            lines.some((l) => l.index === p.index)
              ? lines.map((l) => (l.index === p.index ? { ...l, qty: l.qty + 1 } : l))
              : [...lines, { index: p.index, name: p.name, sku: p.sku, price: p.price, qty: 1 }],
          ),
        setQty: (index, qty) => update((lines) => (qty <= 0 ? lines.filter((l) => l.index !== index) : lines.map((l) => (l.index === index ? { ...l, qty } : l)))),
        remove: (index) => update((lines) => lines.filter((l) => l.index !== index)),
        clear: () => update(() => []),
        switchOwner: (owner) => set({ owner }),
      };
    },
    { name: "shop-cart:react", storage: createJSONStorage(() => sessionStorage) },
  ),
);

// Selectors. Components pick one, so a qty change doesn't re-render the header's user menu.
/** @param {CartState} s */
export const selectLines = (s) => linesOf(s);
/** @param {CartState} s */
export const selectCount = (s) => linesOf(s).reduce((n, l) => n + l.qty, 0);
/** @param {CartState} s */
export const selectSubtotal = (s) => linesOf(s).reduce((n, l) => n + l.qty * l.price, 0);
