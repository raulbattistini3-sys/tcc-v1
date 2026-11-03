// Catalog domain: query, page and the latest scheduler result.
// Counterpart of catalog.store.js (Zustand). The only RxJS piece is the
// search debounce, with the same 250 ms and the same semantics as the React
// useDebouncedCallback: commit only when the text differs from the committed one.
// Like the Zustand actions, every method runs the query synchronously in the
// handler that called it.
import { inject } from "@angular/core";
import { patchState, signalStore, withMethods, withState } from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { debounceTime, pipe, tap } from "rxjs";
import { EMPTY_QUERY, PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@shared/catalog.js";
import type { CatalogQuery, CatalogResult, SearchMode } from "@shared/catalog.js";
import { CATALOG } from "../tokens";

export type Sorting = CatalogQuery["sorting"];

interface CatalogState {
  query: CatalogQuery;
  searchInput: string;
  pageIndex: number;
  pageSize: number;
  result: CatalogResult | null;
  status: "loading" | "ready" | "error";
  error: string | null;
}

const initial: CatalogState = {
  query: EMPTY_QUERY,
  searchInput: "",
  pageIndex: 0,
  pageSize: PAGE_SIZE,
  result: null,
  status: "loading",
  error: null,
};

export const CatalogStore = signalStore(
  { providedIn: "root" },
  withState(initial),
  withMethods((store, catalog = inject(CATALOG)) => {
    const refresh = async () => {
      patchState(store, { status: "loading" });
      try {
        const r = await catalog.run(store.query());
        if (r) patchState(store, { result: r, status: "ready", error: null });
      } catch (err) {
        patchState(store, { status: "error", error: String(err) });
      }
    };
    const commit = (patch: Partial<CatalogQuery>) => {
      patchState(store, (s) => ({ query: { ...s.query, ...patch }, pageIndex: 0 }));
      void refresh();
    };
    const commitSearch = rxMethod<string>(
      pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        tap((search) => {
          if (search !== store.query().search) commit({ search });
        }),
      ),
    );
    return {
      refresh,
      setSearchInput(text: string) {
        patchState(store, { searchInput: text });
        commitSearch(text);
      },
      toggleCategory(c: string) {
        const cats = store.query().categories;
        commit({ categories: cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c] });
      },
      setSearchMode: (searchMode: SearchMode) => commit({ searchMode }),
      setInitialSearchMode: (searchMode: SearchMode) => patchState(store, (s) => ({ query: { ...s.query, searchMode } })),
      setPrice: (price: [number | null, number | null]) => commit({ price }),
      setInStock: (inStock: boolean) => commit({ inStock }),
      setSorting: (sorting: Sorting) => commit({ sorting }),
      setPage: (pageIndex: number) => patchState(store, { pageIndex }),
      setPageSize: (pageSize: number) => patchState(store, { pageSize }),
      clearFilters() {
        patchState(store, { searchInput: "" });
        commit({ ...EMPTY_QUERY, searchMode: store.query().searchMode, sorting: store.query().sorting });
      },
      /** Back to the initial query (harness, between passes). */
      reset() {
        patchState(store, { searchInput: "" });
        commit({ ...EMPTY_QUERY, searchMode: store.query().searchMode });
      },
    };
  }),
);
