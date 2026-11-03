// Catalog domain: the committed query, the page and the latest scheduler result.
//
// Zustand's store-in-context pattern: a vanilla store is created per app
// with the catalog engine injected (createCatalogStore), provided by
// <CatalogProvider>, and read with the useCatalogStore(selector) hook.
//
// Actions run the query themselves, synchronously inside the event handler
// that called them, the same as the Angular SignalStore methods. There is no
// effect between the interaction and the compute: with the main-thread
// strategy the work lands inside the interaction, in both shops, at the same point.

import { useContext } from "react";
import { createStore, useStore } from "zustand";
import { EMPTY_QUERY, PAGE_SIZE } from "@shared/catalog.js";
import { CatalogContext } from "../catalog/CatalogContext.jsx";

/** @typedef {import("@shared/catalog.js").Catalog} Catalog */
/** @typedef {import("@shared/catalog.js").CatalogQuery} CatalogQuery */
/** @typedef {import("@shared/catalog.js").CatalogResult} CatalogResult */
/** @typedef {import("@shared/catalog.js").SearchMode} SearchMode */
/** @typedef {CatalogQuery["sorting"]} Sorting */

/**
 * @typedef {object} CatalogState
 * @property {CatalogQuery} query what the latest result reflects (or is about to)
 * @property {number} pageIndex
 * @property {number} pageSize
 * @property {CatalogResult | null} result
 * @property {"loading" | "ready" | "error"} status
 * @property {string | null} error
 * @property {(text: string) => void} setSearch committed (already debounced) search text
 * @property {(mode: SearchMode) => void} setSearchMode
 * @property {(c: string) => void} toggleCategory
 * @property {(range: [number | null, number | null]) => void} setPrice
 * @property {(on: boolean) => void} setInStock
 * @property {(sorting: Sorting) => void} setSorting
 * @property {(i: number) => void} setPage
 * @property {() => void} clearFilters keeps search mode and sorting
 * @property {() => void} reset back to the initial query (harness, between passes)
 * @property {() => Promise<void>} refresh
 */

/** @typedef {ReturnType<typeof createCatalogStore>} CatalogStore */

/**
 * @param {Catalog} catalog
 * @param {Partial<Pick<CatalogState, "query" | "pageSize">>} [initial]
 */
export function createCatalogStore(catalog, initial = {}) {
  return createStore(
    /** @returns {CatalogState} */
    (set, get) => {
      const refresh = async () => {
        set({ status: "loading" });
        try {
          const r = await catalog.run(get().query);
          if (r) set({ result: r, status: "ready", error: null });
        } catch (err) {
          set({ status: "error", error: String(err) });
        }
      };
      /** @param {Partial<CatalogQuery>} patch */
      const commit = (patch) => {
        set((s) => ({ query: { ...s.query, ...patch }, pageIndex: 0 }));
        void refresh();
      };
      return {
        query: EMPTY_QUERY,
        pageIndex: 0,
        pageSize: PAGE_SIZE,
        result: null,
        status: "loading",
        error: null,
        ...initial,
        refresh,
        setSearch: (search) => {
          if (search !== get().query.search) commit({ search });
        },
        setSearchMode: (searchMode) => commit({ searchMode }),
        toggleCategory: (c) => {
          const cats = get().query.categories;
          commit({ categories: cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c] });
        },
        setPrice: (price) => commit({ price }),
        setInStock: (inStock) => commit({ inStock }),
        setSorting: (sorting) => commit({ sorting }),
        setPage: (pageIndex) => set({ pageIndex }),
        clearFilters: () => commit({ ...EMPTY_QUERY, searchMode: get().query.searchMode, sorting: get().query.sorting }),
        reset: () => commit({ ...EMPTY_QUERY, searchMode: get().query.searchMode }),
      };
    },
  );
}

/**
 * @template T
 * @param {(s: CatalogState) => T} selector
 * @returns {T}
 */
export function useCatalogStore(selector) {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalogStore outside <CatalogProvider>");
  return useStore(ctx.store, selector);
}
