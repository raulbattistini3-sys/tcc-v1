import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
import { formatPrice } from "@shared/catalog.js";
import { categoryLabel, installmentText, marketDetails, productDescription, relatedSpec } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { useCatalog } from "../catalog/CatalogContext";
import { useChannelProducts, useOpenListing } from "../hooks/market";
import { useCartStore } from "../stores/cart.store";
import { useUiStore } from "../stores/session.store";
import { Stars } from "../components/product/Stars";
import { ProductRail } from "../components/product/ProductRail";
import { NotFound } from "./NotFound";
import css from "./pages.module.scss";

export function ProductPage() {
  const catalog = useCatalog();
  const { index } = useParams();
  const i = Number(index);
  const valid = Number.isInteger(i) && i >= 0 && i < catalog.rows;
  return valid ? <ProductView key={i} index={i} /> : <NotFound />;
}

function ProductView({ index }: { index: number }) {
  const catalog = useCatalog();
  const p = useMemo(() => catalog.productAt(index), [catalog, index]);
  const d = marketDetails(p);
  const spec = useMemo(() => relatedSpec(p), [p]);
  const related = useChannelProducts(spec, "related", 12, index);
  const add = useCartStore((s) => s.add);
  const toast = useUiStore((s) => s.showToast);
  const open = useOpenListing();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  const [shot, setShot] = useState(0);
  const images = [0, 1, 2, 3].map((k) => productImage(p.categoria, index + k));
  const inStock = p.stock > 0;

  return (
    <>
      <Breadcrumbs aria-label="Navegação">
        <Link to="/">Início</Link>
        <Button size="small" onClick={() => open({ categories: [p.categoria] })}>
          {categoryLabel(p.categoria)}
        </Button>
      </Breadcrumbs>
      <article className={css.product} data-testid="product-page">
        <div className={css.gallery}>
          <div className={css.thumbs}>
            {images.map((src, k) => (
              <img key={k} className={css.thumb} src={src} alt="" aria-current={k === shot} onClick={() => setShot(k)} />
            ))}
          </div>
          <img className={css.main} src={images[shot]} alt={p.name} />
        </div>
        <div className={css.buy}>
          <h1 className={css.name}>{p.name}</h1>
          <div className={css.meta}>
            Código {p.sku} · {inStock ? `${p.stock} em estoque` : "sem estoque"}
          </div>
          <Stars rating={d.rating} reviews={d.reviews} />
          <Divider />
          <div className={css.listPrice}>{d.listPrice !== null ? formatPrice(d.listPrice) : ""}</div>
          <div>
            <span className={css.price}>{formatPrice(p.price)}</span>
            {d.discountPct > 0 && <span className={css.discount}>{d.discountPct}% OFF</span>}
          </div>
          <div className={css.installments}>{installmentText(d.installments)}</div>
          {d.freeShipping && <div className={css.shipping}>Frete grátis para todo o Brasil</div>}
          <div className={css.qty}>
            Quantidade:
            <IconButton size="small" aria-label="Diminuir" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>
              <RemoveIcon fontSize="small" />
            </IconButton>
            <span data-testid="qty">{qty}</span>
            <IconButton size="small" aria-label="Aumentar" disabled={qty >= Math.max(1, p.stock)} onClick={() => setQty((q) => q + 1)}>
              <AddIcon fontSize="small" />
            </IconButton>
          </div>
          <div className={css.actions}>
            <Button
              variant="contained"
              disabled={!inStock}
              onClick={() => {
                add(p, qty);
                void navigate("/carrinho");
              }}
            >
              Comprar agora
            </Button>
            <Button
              variant="outlined"
              disabled={!inStock}
              onClick={() => {
                add(p, qty);
                toast("Adicionado ao carrinho");
              }}
            >
              Adicionar ao carrinho
            </Button>
          </div>
          <p className={css.description}>{productDescription(p)}</p>
        </div>
      </article>
      <ProductRail title={`Mais em ${categoryLabel(p.categoria)}`} products={related} testId="rail-related" />
    </>
  );
}
