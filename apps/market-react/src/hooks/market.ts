import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router";
import { EMPTY_QUERY, type CatalogQuery, type Product } from "@shared/catalog.js";
import { paramsFromQuery, runOnChannel, spread, toSearchString } from "@shared/market.js";
import { markPainted } from "@shared/harness.js";
import type { OpSpec } from "@core/types.js";
import { useCatalog, useCatalogStoreApi, useConditions } from "../catalog/CatalogContext";
import { useCatalogStore } from "../stores/catalog.store";

/**
 * Opens the listing for a query: the store runs it first (inside this handler), then the URL follows.
 * Used by the header search, the category links and the hero's buttons.
 */
export function useOpenListing() {
  const store = useCatalogStoreApi();
  const navigate = useNavigate();
  const { searchMode } = useConditions();
  return useCallback(
    (patch: Partial<CatalogQuery>) => {
      const q: CatalogQuery = { ...EMPTY_QUERY, searchMode, ...patch };
      store.getState().setQuery(q);
      void navigate(`/lista${toSearchString(paramsFromQuery(q))}`);
    },
    [store, navigate, searchMode],
  );
}

/** After a filter action already ran the query: mirror the store's query in the URL (replace). */
export function useMirrorUrl() {
  const store = useCatalogStoreApi();
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ search: toSearchString(paramsFromQuery(store.getState().query)) }, { replace: true });
  }, [store, navigate]);
}

/**
 * n products from a spec run on its own scheduler channel (home rails, related products). The run
 * starts after mount; it isn't an interaction the harness measures.
 */
export function useChannelProducts(spec: OpSpec, channel: string, n: number, skip = -1): Product[] | null {
  const catalog = useCatalog();
  const [items, setItems] = useState<Product[] | null>(null);
  useEffect(() => {
    let live = true;
    setItems(null);
    runOnChannel(catalog, spec, channel)
      .then((ix) => {
        if (live && ix) setItems(spread(ix, n, skip).map((i) => catalog.productAt(i)));
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [catalog, spec, channel, n, skip]);
  return items;
}

// the last result marked painted: coming back to the listing re-mounts it with a result that was
// already measured, which must not be counted twice
let lastPainted = 0;

/** Marks the frame that shows each new listing result; the query itself already ran in the action. */
export function useHarnessProbe() {
  const result = useCatalogStore((s) => s.result);
  useEffect(() => {
    if (result && result.queryId > lastPainted) {
      lastPainted = result.queryId;
      markPainted(result);
    }
  }, [result]);
}

const SPEED_PX_PER_MS = 0.05;

/** rAF loop moving a track by writing style.transform, no React state per frame (as in the shops). */
export function useCarousel(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let raf = 0;
    let last = performance.now();
    let x = 0;
    const frame = (t: number) => {
      x = (x + (t - last) * SPEED_PX_PER_MS) % (el.scrollWidth / 2);
      last = t;
      el.style.transform = `translateX(${-x}px)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ref, enabled]);
}

/** Width of an element, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e ? e.contentRect.width : 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
