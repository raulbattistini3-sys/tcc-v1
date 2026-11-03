// UI domain: drawers and the view mode. It is kept apart from the catalog,
// so opening the cart doesn't touch the components that render the product list.

import { create } from "zustand";

/**
 * @typedef {object} UiState
 * @property {"grid" | "table"} view
 * @property {boolean} cartOpen
 * @property {boolean} filtersOpen sidebar as a drawer on small screens
 * @property {(v: "grid" | "table") => void} setView
 * @property {(open: boolean) => void} setCartOpen
 * @property {(open: boolean) => void} setFiltersOpen
 */

export const useUiStore = create(
  /** @returns {UiState} */
  (set) => ({
    view: "grid",
    cartOpen: false,
    filtersOpen: false,
    setView: (view) => set({ view }),
    setCartOpen: (cartOpen) => set({ cartOpen }),
    setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
  }),
);
