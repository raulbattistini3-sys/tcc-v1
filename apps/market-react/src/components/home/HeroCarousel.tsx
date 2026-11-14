import { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import { BANNERS, BANNER_INTERVAL_MS } from "@shared/market.js";
import { useOpenListing } from "../../hooks/market";
import css from "./home.module.scss";

/** Rotating banners: one state change every BANNER_INTERVAL_MS, the slide moved by a CSS transition. */
export function HeroCarousel() {
  const [i, setI] = useState(0);
  const open = useOpenListing();
  useEffect(() => {
    const t = setInterval(() => setI((k) => (k + 1) % BANNERS.length), BANNER_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <section className={css.hero} aria-roledescription="carrossel" aria-label="Destaques">
      <div className={css.track} style={{ transform: `translateX(${-i * 100}%)` }}>
        {BANNERS.map((b, k) => (
          <div key={b.id} className={css.slide} style={{ background: `linear-gradient(120deg, ${b.from}, ${b.to})` }} aria-hidden={k !== i}>
            <h2 className={css.heroTitle}>{b.title}</h2>
            <p>{b.subtitle}</p>
            <Button className={css.heroCta} variant="contained" color="secondary" tabIndex={k === i ? 0 : -1} onClick={() => open({ categories: [b.category] })}>
              {b.cta}
            </Button>
          </div>
        ))}
      </div>
      <div className={css.dots}>
        {BANNERS.map((b, k) => (
          <button key={b.id} className={css.dot} aria-current={k === i} aria-label={`Destaque ${k + 1}`} onClick={() => setI(k)} />
        ))}
      </div>
    </section>
  );
}
