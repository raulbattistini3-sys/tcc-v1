import css from "./product.module.scss";

const count = new Intl.NumberFormat("pt-BR");

/** Five stars filled to the rating, and the review count (drawn the same way in the Angular app). */
export function Stars({ rating, reviews }: { rating: number; reviews: number }) {
  return (
    <span className={css.stars} aria-label={`Nota ${rating} de 5, ${reviews} avaliações`}>
      <span className={css.glyphs}>
        <span className={css.fill} style={{ width: `${(rating / 5) * 100}%` }} />
      </span>
      {rating.toFixed(1)} ({count.format(reviews)})
    </span>
  );
}
