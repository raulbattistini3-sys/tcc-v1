// Cart domain: one cart per session owner, in sessionStorage (shop-react's cart store, in TS).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Product } from "@shared/catalog.js";

export type CartLine = { index: number; name: string; sku: string; categoria: string; price: number; qty: number };

type CartState = {
  owner: string;
  carts: Record<string, CartLine[]>;
  add: (p: Product, qty?: number) => void;
  setQty: (index: number, qty: number) => void;
  remove: (index: number) => void;
  clear: () => void;
  switchOwner: (owner: string) => void;
};

// a shared empty array: a fresh [] per call would make the selector unstable and loop the render
const NONE: CartLine[] = [];
const linesOf = (s: CartState) => s.carts[s.owner] ?? NONE;

export const useCartStore = create<CartState>()(
  persist(
    (set) => {
      const update = (f: (lines: CartLine[]) => CartLine[]) => set((s) => ({ carts: { ...s.carts, [s.owner]: f(linesOf(s)) } }));
      return {
        owner: "guest",
        carts: {},
        add: (p, qty = 1) =>
          update((lines) =>
            lines.some((l) => l.index === p.index)
              ? lines.map((l) => (l.index === p.index ? { ...l, qty: l.qty + qty } : l))
              : [...lines, { index: p.index, name: p.name, sku: p.sku, categoria: p.categoria, price: p.price, qty }],
          ),
        setQty: (index, qty) => update((lines) => (qty <= 0 ? lines.filter((l) => l.index !== index) : lines.map((l) => (l.index === index ? { ...l, qty } : l)))),
        remove: (index) => update((lines) => lines.filter((l) => l.index !== index)),
        clear: () => update(() => []),
        switchOwner: (owner) => set({ owner }),
      };
    },
    { name: "market-cart:react", storage: createJSONStorage(() => sessionStorage) },
  ),
);

export const selectLines = (s: CartState) => linesOf(s);
export const selectCount = (s: CartState) => linesOf(s).reduce((n, l) => n + l.qty, 0);
export const selectSubtotal = (s: CartState) => linesOf(s).reduce((n, l) => n + l.qty * l.price, 0);
