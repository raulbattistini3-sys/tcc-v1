// Listing domain: the committed query and the latest scheduler result. Counterpart of market-react's
// catalog.store.ts (Zustand): every method runs the query synchronously in the handler that called it;
// the URL is written by the handler after the method (openListing / mirrorUrl), never read back into a
// query by an effect during an interaction.
import { inject } from "@angular/core";
import { patchState, signalStore, withMethods, withState } from "@ngrx/signals";
import { EMPTY_QUERY } from "@shared/catalog.js";
import type { CatalogQuery, CatalogResult } from "@shared/catalog.js";
import { CATALOG, CONDITIONS } from "../tokens";

interface CatalogState {
  query: CatalogQuery;
  result: CatalogResult | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

export const CatalogStore = signalStore(
  { providedIn: "root" },
  withState<CatalogState>(() => ({ query: { ...EMPTY_QUERY, searchMode: inject(CONDITIONS).searchMode }, result: null, status: "idle", error: null })),
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
      patchState(store, (s) => ({ query: { ...s.query, ...patch } }));
      void refresh();
    };
    return {
      refresh,
      /** replaces the whole query (a search from the header, a category link, the URL on navigation) */
      setQuery(q: CatalogQuery) {
        patchState(store, { query: q });
        void refresh();
      },
      toggleCategory(c: string) {
        const cats = store.query().categories;
        commit({ categories: cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c] });
      },
      setPrice: (price: [number | null, number | null]) => commit({ price }),
      setInStock: (inStock: boolean) => commit({ inStock }),
      setSorting: (sorting: CatalogQuery["sorting"]) => commit({ sorting }),
      clearFilters: () => commit({ categories: [], price: [null, null], inStock: false }),
      reset: () => commit({ ...EMPTY_QUERY, searchMode: store.query().searchMode }),
    };
  }),
);
