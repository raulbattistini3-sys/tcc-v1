import { ProductCard } from "./ProductCard.jsx";
import styles from "./Catalog.module.scss";

/** @param {{ table: import("../../hooks/useProductTable.js").ProductTable }} props */
export function ProductGridView({ table }) {
  const rows = table.getRowModel().rows;
  if (rows.length === 0) return <p className={styles.empty}>Nenhum produto encontrado.</p>;
  return (
    <div className={styles.grid} data-testid="product-grid">
      {rows.map((row) => (
        <ProductCard key={row.id} product={row.original} />
      ))}
    </div>
  );
}
