// Provides the catalog engine (dataset, worker, scheduler), the catalog store bound to it and the page
// conditions. All three are created once before render and never change, so providing them costs no
// re-renders.
import { createContext, useContext, type ReactNode } from "react";
import type { Catalog } from "@shared/catalog.js";
import type { Conditions } from "@shared/conditions.js";
import type { CatalogStore } from "../stores/catalog.store";

type Ctx = { catalog: Catalog; store: CatalogStore; conditions: Conditions };

export const CatalogContext = createContext<Ctx | null>(null);

export function CatalogProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <CatalogContext value={value}>{children}</CatalogContext>;
}

function useCtx(): Ctx {
  const c = useContext(CatalogContext);
  if (!c) throw new Error("outside <CatalogProvider>");
  return c;
}

export const useCatalog = () => useCtx().catalog;
export const useConditions = () => useCtx().conditions;
export const useCatalogStoreApi = () => useCtx().store;
