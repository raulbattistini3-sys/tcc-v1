// Cart domain: one cart per session owner, kept in sessionStorage.
// Counterpart of cart.store.js (Zustand + persist).
import { computed, effect } from "@angular/core";
import { getState, patchState, signalStore, withComputed, withHooks, withMethods, withState } from "@ngrx/signals";
import type { Product } from "@shared/catalog.js";

export interface CartLine {
  index: number;
  name: string;
  sku: string;
  price: number;
  qty: number;
}

interface CartState {
  owner: string;
  carts: Record<string, CartLine[]>;
}

const KEY = "shop-cart:angular";
const NONE: CartLine[] = [];

function load(): CartState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CartState;
  } catch {
    // storage blocked or corrupt: start empty
  }
  return { owner: "guest", carts: {} };
}

export const CartStore = signalStore(
  { providedIn: "root" },
  withState<CartState>(load),
  // computed() memoises: the badge only re-renders when the count really changes.
  withComputed(({ owner, carts }) => {
    const lines = computed(() => carts()[owner()] ?? NONE);
    return {
      lines,
      count: computed(() => lines().reduce((n, l) => n + l.qty, 0)),
      subtotal: computed(() => lines().reduce((n, l) => n + l.qty * l.price, 0)),
    };
  }),
  withMethods((store) => {
    const update = (f: (lines: CartLine[]) => CartLine[]) =>
      patchState(store, (s) => ({ carts: { ...s.carts, [s.owner]: f(s.carts[s.owner] ?? NONE) } }));
    return {
      add: (p: Product) =>
        update((lines) =>
          lines.some((l) => l.index === p.index)
            ? lines.map((l) => (l.index === p.index ? { ...l, qty: l.qty + 1 } : l))
            : [...lines, { index: p.index, name: p.name, sku: p.sku, price: p.price, qty: 1 }],
        ),
      setQty: (index: number, qty: number) =>
        update((lines) => (qty <= 0 ? lines.filter((l) => l.index !== index) : lines.map((l) => (l.index === index ? { ...l, qty } : l)))),
      remove: (index: number) => update((lines) => lines.filter((l) => l.index !== index)),
      clear: () => update(() => []),
      switchOwner: (owner: string) => patchState(store, { owner }),
    };
  }),
  withHooks({
    onInit(store) {
      // Same as zustand/persist: write the whole state on every change.
      effect(() => {
        const state = getState(store);
        try {
          sessionStorage.setItem(KEY, JSON.stringify(state));
        } catch {
          // ignore quota / blocked storage
        }
      });
    },
  }),
);
