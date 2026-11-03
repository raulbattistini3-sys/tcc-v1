// Provides the catalog engine (dataset, worker, scheduler) and the catalog
// store bound to it. Both are created once before render and never change,
// so the context value is stable and providing it costs no re-renders.

import { createContext, useContext } from "react";

/** @typedef {import("@shared/catalog.js").Catalog} Catalog */
/** @typedef {import("../stores/catalog.store.js").CatalogStore} CatalogStore */

export const CatalogContext = createContext(/** @type {{ catalog: Catalog, store: CatalogStore } | null} */ (null));

/** @param {{ value: { catalog: Catalog, store: CatalogStore }, children: import("react").ReactNode }} props */
export function CatalogProvider({ value, children }) {
  return <CatalogContext value={value}>{children}</CatalogContext>;
}

/** @returns {Catalog} */
export function useCatalog() {
  const c = useContext(CatalogContext);
  if (!c) throw new Error("useCatalog outside <CatalogProvider>");
  return c.catalog;
}
