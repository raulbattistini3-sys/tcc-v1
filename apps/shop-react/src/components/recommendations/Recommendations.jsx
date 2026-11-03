// "Recomendados para você", shown to signed-in users. With `autoplay` it is
// the "carrossel rodando" condition (useCarousel).

import { useMemo, useRef } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import { formatPrice } from "@shared/catalog.js";
import { productImage } from "@shared/product-image.js";
import { useCatalog } from "../../catalog/CatalogContext.jsx";
import { useCarousel } from "../../hooks/useCarousel.js";
import styles from "./Recommendations.module.scss";

/** @param {{ autoplay: boolean }} props */
export function Recommendations({ autoplay }) {
  const catalog = useCatalog();
  const track = useRef(/** @type {HTMLDivElement | null} */ (null));
  // Doubled list when it scrolls, so the loop wraps without a jump.
  const items = useMemo(() => {
    const picks = catalog.recommendations(12);
    return autoplay ? [...picks, ...picks] : picks;
  }, [catalog, autoplay]);
  useCarousel(track, autoplay);

  return (
    <section className={styles.strip} aria-label="Recomendados para você">
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Recomendados para você
      </Typography>
      <div className={styles.viewport}>
        <div className={styles.track} ref={track}>
          {items.map((p, i) => (
            <Card key={`${p.index}:${i}`} variant="outlined" className={styles.item}>
              <CardMedia component="img" height="80" image={productImage(p.categoria, p.index)} alt="" />
              <CardContent sx={{ p: 1 }}>
                <Typography variant="caption" noWrap component="div">
                  {p.name}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatPrice(p.price)}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
