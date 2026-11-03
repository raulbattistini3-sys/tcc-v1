// "Recomendados para você" strip, shown for signed-in users. With
// `autoplay` it is the "carrossel rodando" condition: a rAF loop that moves
// the track every frame. It writes straight to the DOM through a ref (no
// React state per frame), and the Angular carousel does exactly the same, so
// both pay the same per-frame main-thread cost and no framework re-render.

import { useEffect, useMemo, useRef } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import { formatPrice } from "@shared/catalog.js";
import { productImage } from "@shared/product-image.js";
import { catalog } from "../../catalog-instance.js";
import styles from "./Recommendations.module.scss";

const SPEED_PX_PER_MS = 0.05;

/** @param {{ autoplay: boolean }} props */
export function Recommendations({ autoplay }) {
  const items = useMemo(() => catalog().recommendations(12), []);
  const track = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    const el = track.current;
    if (!autoplay || !el) return;
    let raf = 0;
    let last = performance.now();
    let x = 0;
    /** @param {number} t */
    const frame = (t) => {
      x = (x + (t - last) * SPEED_PX_PER_MS) % (el.scrollWidth / 2);
      last = t;
      el.style.transform = `translateX(${-x}px)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [autoplay]);

  // Doubled list, so the loop wraps without a jump.
  const loop = autoplay ? [...items, ...items] : items;
  return (
    <section className={styles.strip} aria-label="Recomendados para você">
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Recomendados para você
      </Typography>
      <div className={styles.viewport}>
        <div className={styles.track} ref={track}>
          {loop.map((p, i) => (
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
