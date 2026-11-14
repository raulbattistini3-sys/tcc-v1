import { useRef } from "react";
import type { Product } from "@shared/catalog.js";
import { useCarousel } from "../../hooks/market";
import { ProductCard } from "./ProductCard";
import css from "./product.module.scss";

/**
 * A titled row of cards. `autoplay` moves it every frame (doubled list, rAF), the "carousel" page
 * condition of the experiments; otherwise it scrolls by hand.
 */
export function ProductRail({ title, products, autoplay = false, testId }: { title: string; products: Product[] | null; autoplay?: boolean; testId?: string }) {
  const track = useRef<HTMLDivElement>(null);
  useCarousel(track, autoplay && products !== null);
  return (
    <section data-testid={testId}>
      <h2 className={css.title}>{title}</h2>
      {products === null ? (
        <div className={css.placeholder} aria-busy="true" />
      ) : autoplay ? (
        <div className={css.viewport}>
          <div className={css.track} ref={track}>
            {[...products, ...products].map((p, i) => (
              <ProductCard key={`${p.index}:${i}`} product={p} />
            ))}
          </div>
        </div>
      ) : (
        <div className={css.rail}>
          {products.map((p) => (
            <ProductCard key={p.index} product={p} />
          ))}
        </div>
      )}
    </section>
  );
}
