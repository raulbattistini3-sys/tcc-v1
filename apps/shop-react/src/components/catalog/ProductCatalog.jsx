// Catalog section: toolbar, progress, one of the two views, pager. Both views
// render from the same TanStack instance (useProductTable), as in the Angular shop.

import LinearProgress from "@mui/material/LinearProgress";
import { useProductTable } from "../../hooks/useProductTable.js";
import { useCatalogStore } from "../../stores/catalog.store.js";
import { useUiStore } from "../../stores/ui.store.js";
import { CatalogToolbar } from "./CatalogToolbar.jsx";
import { ProductGridView } from "./ProductGridView.jsx";
import { ProductTableView } from "./ProductTableView.jsx";
import { Pager } from "./Pager.jsx";

/** @param {{ forceView?: "grid" | "table" }} props */
export function ProductCatalog({ forceView }) {
  const table = useProductTable();
  const status = useCatalogStore((s) => s.status);
  const error = useCatalogStore((s) => s.error);
  const storedView = useUiStore((s) => s.view);
  const view = forceView ?? storedView;

  return (
    <section aria-label="Produtos" aria-busy={status === "loading"}>
      <CatalogToolbar table={table} showViewToggle={!forceView} />
      <LinearProgress sx={{ visibility: status === "loading" ? "visible" : "hidden", mb: 1 }} />
      {error && <p role="alert">{error}</p>}
      {view === "grid" ? <ProductGridView table={table} /> : <ProductTableView table={table} />}
      <Pager table={table} />
    </section>
  );
}
