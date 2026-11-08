// Counterparts of market-react's hooks/market.ts: opening the listing, mirroring the URL, products from
// a channel query, and the harness's "painted" mark. Injection functions, called in a component's
// injection context.
import { DestroyRef, Injector, afterNextRender, effect, inject, signal, untracked, type Signal } from "@angular/core";
import { Router } from "@angular/router";
import { EMPTY_QUERY, type CatalogQuery, type Product } from "@shared/catalog.js";
import { paramsFromQuery, runOnChannel, spread } from "@shared/market.js";
import { markPainted } from "@shared/harness.js";
import type { OpSpec } from "@core/types.js";
import { CATALOG, CONDITIONS } from "./tokens";
import { CatalogStore } from "./stores/catalog.store";

/** The store runs the query first (inside the handler), then the URL follows. */
export function injectOpenListing() {
  const store = inject(CatalogStore);
  const router = inject(Router);
  const { searchMode } = inject(CONDITIONS);
  return (patch: Partial<CatalogQuery>) => {
    const q: CatalogQuery = { ...EMPTY_QUERY, searchMode, ...patch };
    store.setQuery(q);
    void router.navigate(["/lista"], { queryParams: paramsFromQuery(q) });
  };
}

/** After a filter method already ran the query: mirror the store's query in the URL (replace). */
export function injectMirrorUrl() {
  const store = inject(CatalogStore);
  const router = inject(Router);
  return () => void router.navigate([], { queryParams: paramsFromQuery(store.query()), replaceUrl: true });
}

/** n products from a spec run on its own scheduler channel; null while it runs. */
export function channelProducts(spec: () => OpSpec, channel: string, n: number, skip: () => number = () => -1): Signal<Product[] | null> {
  const catalog = inject(CATALOG);
  const out = signal<Product[] | null>(null);
  let run = 0;
  effect(() => {
    const s = spec();
    const k = skip();
    const mine = ++run;
    untracked(() => out.set(null));
    runOnChannel(catalog, s, channel)
      .then((ix) => {
        if (mine === run && ix) out.set(spread(ix, n, k).map((i) => catalog.productAt(i)));
      })
      .catch(() => {
        if (mine === run) out.set([]);
      });
  });
  inject(DestroyRef).onDestroy(() => (run = -1));
  return out;
}

// the last result marked painted: coming back to the listing must not count a result twice
let lastPainted = 0;

/** Marks the frame that shows each new listing result; the query itself already ran in the method. */
export function injectHarnessProbe() {
  const store = inject(CatalogStore);
  const injector = inject(Injector);
  effect(() => {
    const r = store.result();
    if (!r || r.queryId <= lastPainted) return;
    lastPainted = r.queryId;
    // after Angular has rendered it, like React's effect after commit (shop-angular does the same)
    afterNextRender(() => markPainted(r), { injector });
  });
}
