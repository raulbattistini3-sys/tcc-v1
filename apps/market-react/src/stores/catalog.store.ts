// Listing domain: the committed query and the latest scheduler result. Same rules as shop-react's
// catalog store: a vanilla Zustand store created with the engine injected, provided by context; every
// action runs the query itself, synchronously, in the event handler that called it. The URL is written
// by the handler after the action (useListingNavigation), never read back into a query by an effect
// during an interaction.
import { createStore, useStore } from "zustand";
import { EMPTY_QUERY } from "@shared/catalog.js";
import type { Catalog, CatalogQuery, CatalogResult } from "@shared/catalog.js";
import { useCatalogStoreApi } from "../catalog/CatalogContext";

export type CatalogState = {
  query: CatalogQuery;
  result: CatalogResult | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** replaces the whole query (a search from the header, a category link, the URL on navigation) */
  setQuery: (q: CatalogQuery) => void;
  toggleCategory: (c: string) => void;
  setPrice: (range: [number | null, number | null]) => void;
  setInStock: (on: boolean) => void;
  setSorting: (sorting: CatalogQuery["sorting"]) => void;
  clearFilters: () => void;
  reset: () => void;
  refresh: () => Promise<void>;
};

export type CatalogStore = ReturnType<typeof createCatalogStore>;

export function createCatalogStore(catalog: Catalog, searchMode: CatalogQuery["searchMode"]) {
  return createStore<CatalogState>()((set, get) => {
    const refresh = async () => {
      set({ status: "loading" });
      try {
        const r = await catalog.run(get().query);
        if (r) set({ result: r, status: "ready", error: null });
      } catch (err) {
        set({ status: "error", error: String(err) });
      }
    };
    const commit = (patch: Partial<CatalogQuery>) => {
      set((s) => ({ query: { ...s.query, ...patch } }));
      void refresh();
    };
    return {
      query: { ...EMPTY_QUERY, searchMode },
      result: null,
      status: "idle",
      error: null,
      refresh,
      setQuery: (q) => {
        set({ query: q });
        void refresh();
      },
      toggleCategory: (c) => {
        const cats = get().query.categories;
        commit({ categories: cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c] });
      },
      setPrice: (price) => commit({ price }),
      setInStock: (inStock) => commit({ inStock }),
      setSorting: (sorting) => commit({ sorting }),
      clearFilters: () => commit({ categories: [], price: [null, null], inStock: false }),
      reset: () => commit({ ...EMPTY_QUERY, searchMode: get().query.searchMode }),
    };
  });
}

export function useCatalogStore<T>(selector: (s: CatalogState) => T): T {
  return useStore(useCatalogStoreApi(), selector);
}
