// Cart hooks. Each one subscribes to the narrowest slice it can, so the
// badge re-renders on a count change and not when a line's qty moves between
// equal totals, and a card's "Adicionar" button never re-renders for the cart at all.

import { useShallow } from "zustand/react/shallow";
import { selectCount, selectLines, selectSubtotal, useCartStore } from "../stores/cart.store.js";

export const useCartCount = () => useCartStore(selectCount);
export const useCartLines = () => useCartStore(selectLines);
export const useCartSubtotal = () => useCartStore(selectSubtotal);

/** Stable action references (store functions never change). */
export const useCartActions = () =>
  useCartStore(useShallow((s) => ({ add: s.add, setQty: s.setQty, remove: s.remove, clear: s.clear })));
