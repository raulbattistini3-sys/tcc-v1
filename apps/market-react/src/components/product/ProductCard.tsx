import { memo } from "react";
import { Link } from "react-router";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardActions from "@mui/material/CardActions";
import Button from "@mui/material/Button";
import { formatPrice, type Product } from "@shared/catalog.js";
import { installmentText, marketDetails } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { useCartStore } from "../../stores/cart.store";
import { useUiStore } from "../../stores/session.store";
import { Stars } from "./Stars";
import css from "./product.module.scss";

/** One product. memo + stable props: a new result re-renders only the cards whose product changed. */
export const ProductCard = memo(function ProductCard({ product: p }: { product: Product }) {
  const add = useCartStore((s) => s.add);
  const toast = useUiStore((s) => s.showToast);
  const d = marketDetails(p);
  return (
    <Card variant="outlined" className={css.card} data-testid="product-card">
      <CardActionArea component={Link} to={`/produto/${p.index}`} className={css.area}>
        <img className={css.image} src={productImage(p.categoria, p.index)} alt="" width={200} height={150} loading="lazy" decoding="async" />
        <div className={css.body}>
          <div className={css.name}>{p.name}</div>
          <div className={css.listPrice}>{d.listPrice !== null ? formatPrice(d.listPrice) : ""}</div>
          <div>
            <span className={css.price}>{formatPrice(p.price)}</span>
            {d.discountPct > 0 && <span className={css.discount}>{d.discountPct}% OFF</span>}
          </div>
          <div className={css.installments}>{installmentText(d.installments)}</div>
          <div className={css.shipping}>{d.freeShipping ? "Frete grátis" : " "}</div>
          <Stars rating={d.rating} reviews={d.reviews} />
        </div>
      </CardActionArea>
      <CardActions>
        <Button
          size="small"
          disabled={p.stock <= 0}
          onClick={() => {
            add(p);
            toast("Adicionado ao carrinho");
          }}
        >
          {p.stock > 0 ? "Adicionar ao carrinho" : "Sem estoque"}
        </Button>
      </CardActions>
    </Card>
  );
});
