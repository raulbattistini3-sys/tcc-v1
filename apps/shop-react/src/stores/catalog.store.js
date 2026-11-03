// Catalog domain: query (search, facets, sorting), page and the latest
// scheduler result. This is the store the experiment is about: when a worker
// result lands, only components that select `result` or `page` re-render.

import { create } from "zustand";
import { EMPTY_QUERY, PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@shared/catalog.js";
import { catalog } from "../catalog-instance.js";

/** @typedef {import("@shared/catalog.js").CatalogQuery} CatalogQuery */
/** @typedef {import("@shared/catalog.js").CatalogResult} CatalogResult */
/** @typedef {CatalogQuery["sorting"]} Sorting */

/**
 * @typedef {object} CatalogState
 * @property {CatalogQuery} query committed query: what the result reflects
 * @property {string} searchInput what is typed, ahead of the debounce
 * @property {number} pageIndex
 * @property {number} pageSize
 * @property {CatalogResult | null} result
 * @property {"loading" | "ready" | "error"} status
 * @property {string | null} error
 * @property {(text: string) => void} setSearchInput
 * @property {(c: string) => void} toggleCategory
 * @property {(range: [number | null, number | null]) => void} setPrice
 * @property {(on: boolean) => void} setInStock
 * @property {(sorting: Sorting) => void} setSorting
 * @property {(i: number) => void} setPage
 * @property {() => void} clearFilters
 * @property {() => Promise<void>} refresh
 */

/** @type {ReturnType<typeof setTimeout> | undefined} */
let debounce;

export const useCatalogStore = create(
  /** @returns {CatalogState} */
  (set, get) => {
    /** @param {Partial<CatalogQuery>} patch */
    const commit = (patch) => {
      set((s) => ({ query: { ...s.query, ...patch }, pageIndex: 0 }));
      void get().refresh();
    };
    return {
      query: EMPTY_QUERY,
      searchInput: "",
      pageIndex: 0,
      pageSize: PAGE_SIZE,
      result: null,
      status: "loading",
      error: null,
      setSearchInput: (text) => {
        set({ searchInput: text });
        clearTimeout(debounce);
        debounce = setTimeout(() => commit({ search: text }), SEARCH_DEBOUNCE_MS);
      },
      toggleCategory: (c) => {
        const cats = get().query.categories;
        commit({ categories: cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c] });
      },
      setPrice: (price) => commit({ price }),
      setInStock: (inStock) => commit({ inStock }),
      setSorting: (sorting) => commit({ sorting }),
      setPage: (pageIndex) => set({ pageIndex }),
      clearFilters: () => {
        clearTimeout(debounce);
        set({ searchInput: "" });
        commit({ ...EMPTY_QUERY, sorting: get().query.sorting });
      },
      refresh: async () => {
        set({ status: "loading" });
        try {
          const r = await catalog().run(get().query);
          if (r) set({ result: r, status: "ready", error: null });
        } catch (err) {
          set({ status: "error", error: String(err) });
        }
      },
    };
  },
);
