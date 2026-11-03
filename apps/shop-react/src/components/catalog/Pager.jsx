import Pagination from "@mui/material/Pagination";
import styles from "./Catalog.module.scss";

/** @param {{ table: import("../../hooks/useProductTable.js").ProductTable }} props */
export function Pager({ table }) {
  const pages = table.getPageCount();
  if (pages <= 1) return null;
  return (
    <div className={styles.pager}>
      <Pagination count={pages} page={table.state.pagination.pageIndex + 1} onChange={(_, p) => table.setPageIndex(p - 1)} siblingCount={1} />
    </div>
  );
}
