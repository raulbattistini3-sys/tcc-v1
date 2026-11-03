// Owns the one TanStack Table instance. Both views (cards and table) render
// from the same `table.getRowModel()`, as the Angular shop does.
//
// TanStack runs fully "manual": sorting, filtering and pagination are
// computed by the scheduler (main or worker) over the 600k columnar rows.
// TanStack only holds UI state and builds 48 row objects per page. Its own
// row models would need all 600k objects in the JS heap, which is the cost
// being measured, so it would make main and worker equal by making both slow.

import { useEffect, useMemo } from "react";
import { rowPaginationFeature, rowSortingFeature, tableFeatures, useTable } from "@tanstack/react-table";
import LinearProgress from "@mui/material/LinearProgress";
import { COLUMNS } from "@shared/columns.js";
import { markPainted } from "@shared/harness.js";
import { catalog } from "../../catalog-instance.js";
import { useCatalogStore } from "../../stores/catalog.store.js";
import { useUiStore } from "../../stores/ui.store.js";
import { CatalogToolbar } from "./CatalogToolbar.jsx";
import { ProductGridView } from "./ProductGridView.jsx";
import { ProductTableView } from "./ProductTableView.jsx";
import { Pager } from "./Pager.jsx";

/** @typedef {import("@shared/catalog.js").Product} Product */

const features = tableFeatures({ rowSortingFeature, rowPaginationFeature });

/** @type {import("@tanstack/react-table").ColumnDef<typeof features, Product, any>[]} */
const columns = COLUMNS.map((m) => ({
  id: m.id,
  accessorFn: (/** @type {Product} */ p) => p[m.id],
  header: m.header,
  cell: (/** @type {any} */ info) => m.format(info.row.original),
  enableSorting: m.sortable,
  meta: { align: m.align },
}));

/** @typedef {ReturnType<typeof useProductTable>} ProductTable */

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

function useProductTable() {
  const result = useCatalogStore((s) => s.result);
  const sorting = useCatalogStore((s) => s.query.sorting);
  const pageIndex = useCatalogStore((s) => s.pageIndex);
  const pageSize = useCatalogStore((s) => s.pageSize);
  const setSorting = useCatalogStore((s) => s.setSorting);
  const setPage = useCatalogStore((s) => s.setPage);

  // Only the visible page becomes JS objects.
  const data = useMemo(() => (result ? catalog().page(result.indices, pageIndex, pageSize) : []), [result, pageIndex, pageSize]);

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (p) => String(p.index),
    state: { sorting, pagination: { pageIndex, pageSize } },
    manualSorting: true,
    manualPagination: true,
    rowCount: result?.total ?? 0,
    onSortingChange: (u) => setSorting(typeof u === "function" ? u(sorting) : u),
    onPaginationChange: (u) => {
      const next = typeof u === "function" ? u({ pageIndex, pageSize }) : u;
      setPage(next.pageIndex);
    },
  });

  // Harness: the new rows are committed; mark the frame that shows them.
  useEffect(() => {
    if (result) markPainted(result);
  }, [result]);

  return table;
}
