// The one TanStack Table instance, controlled by the catalog store.
//
// TanStack runs fully "manual": sorting, filtering and pagination are computed
// by the scheduler (main or worker) over the 600k columnar rows. TanStack only
// holds UI state and builds the row objects of the visible page. Its own row
// models would need all 600k objects on the JS heap, which is the very cost
// being measured.

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { rowPaginationFeature, rowSortingFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { COLUMNS } from "@shared/columns.js";
import { useCatalog } from "../catalog/CatalogContext.jsx";
import { useCatalogStore } from "../stores/catalog.store.js";

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

export function useProductTable() {
  const catalog = useCatalog();
  const { result, sorting, pageIndex, pageSize, setSorting, setPage } = useCatalogStore(
    useShallow((s) => ({ result: s.result, sorting: s.query.sorting, pageIndex: s.pageIndex, pageSize: s.pageSize, setSorting: s.setSorting, setPage: s.setPage })),
  );

  // Only the visible page becomes JS objects.
  const data = useMemo(() => (result ? catalog.page(result.indices, pageIndex, pageSize) : []), [catalog, result, pageIndex, pageSize]);

  return useTable({
    features,
    columns,
    data,
    getRowId: (p) => String(p.index),
    state: { sorting, pagination: { pageIndex, pageSize } },
    manualSorting: true,
    manualPagination: true,
    rowCount: result?.total ?? 0,
    // Called from the header's click handler: setSorting runs the query right there.
    onSortingChange: (u) => setSorting(typeof u === "function" ? u(sorting) : u),
    onPaginationChange: (u) => setPage((typeof u === "function" ? u({ pageIndex, pageSize }) : u).pageIndex),
  });
}
