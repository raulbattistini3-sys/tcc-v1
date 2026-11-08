import { useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { GRID } from "@shared/market.js";
import { useCatalog } from "../catalog/CatalogContext";
import { useWidth } from "../hooks/market";
import { ProductCard } from "../components/product/ProductCard";
import css from "./listing.module.scss";

/**
 * Every result scrolls as one window-virtualized grid: only the visible rows (plus overscan) are
 * rendered, and only their products are decoded from the columnar data (catalog.productAt), so a
 * 600k-row result costs the same to show as a 48-row one.
 */
export function VirtualGrid({ indices }: { indices: Uint32Array }) {
  const catalog = useCatalog();
  const [hostRef, width] = useWidth<HTMLDivElement>();
  const cols = Math.max(1, Math.floor((width + GRID.gap) / (GRID.minCardWidth + GRID.gap)));
  const rows = Math.ceil(indices.length / cols);
  const offsetRef = useRef(0);
  const [, force] = useState(0);
  useLayoutEffect(() => {
    const top = (hostRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    if (top !== offsetRef.current) {
      offsetRef.current = top;
      force((n) => n + 1);
    }
  });

  const v = useWindowVirtualizer({
    count: rows,
    estimateSize: () => GRID.rowHeight + GRID.gap,
    overscan: GRID.overscanRows,
    scrollMargin: offsetRef.current,
  });

  return (
    <div ref={hostRef} className={css.gridHost} style={{ height: v.getTotalSize() }} data-testid="results-grid">
      {v.getVirtualItems().map((row) => {
        const start = row.index * cols;
        const end = Math.min(indices.length, start + cols);
        const cards = [];
        for (let k = start; k < end; k++) {
          const i = indices[k]!;
          cards.push(<ProductCard key={i} product={catalog.productAt(i)} />);
        }
        return (
          <div
            key={row.key}
            className={css.row}
            style={{ transform: `translateY(${row.start - v.options.scrollMargin}px)`, height: GRID.rowHeight, ["--cols" as string]: cols }}
          >
            {cards}
          </div>
        );
      })}
    </div>
  );
}
