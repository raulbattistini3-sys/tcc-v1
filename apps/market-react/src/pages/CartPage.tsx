import { Link } from "react-router";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { formatPrice } from "@shared/catalog.js";
import { FREE_SHIPPING_FROM } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { selectLines, selectSubtotal, useCartStore } from "../stores/cart.store";
import css from "./pages.module.scss";

const SHIPPING = 19.9;

export function CartPage() {
  const lines = useCartStore(selectLines);
  const subtotal = useCartStore(selectSubtotal);
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);
  const clear = useCartStore((s) => s.clear);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING;

  if (lines.length === 0) {
    return (
      <div className={css.empty} data-testid="cart-empty">
        <p>Seu carrinho está vazio.</p>
        <Button component={Link} to="/" variant="contained">
          Ver ofertas
        </Button>
      </div>
    );
  }
  return (
    <>
      <h1 className={css.heading}>Carrinho</h1>
      <div className={css.cart}>
        <Card variant="outlined">
          <CardContent>
            {lines.map((l) => (
              <div key={l.index} className={css.line} data-testid="cart-line">
                <img className={css.lineImage} src={productImage(l.categoria, l.index)} alt="" />
                <div>
                  <Link to={`/produto/${l.index}`} className={css.lineName}>
                    {l.name}
                  </Link>
                  <div>{formatPrice(l.price)}</div>
                </div>
                <div className={css.qty}>
                  <IconButton size="small" aria-label="Diminuir" onClick={() => setQty(l.index, l.qty - 1)}>
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                  {l.qty}
                  <IconButton size="small" aria-label="Aumentar" onClick={() => setQty(l.index, l.qty + 1)}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                </div>
                <IconButton aria-label="Remover" onClick={() => remove(l.index)}>
                  <DeleteIcon />
                </IconButton>
              </div>
            ))}
            <Button onClick={clear}>Esvaziar carrinho</Button>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <div className={css.summaryRow}>
              <span>Produtos</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div className={css.summaryRow}>
              <span>Frete</span>
              <span>{shipping === 0 ? "Grátis" : formatPrice(shipping)}</span>
            </div>
            <Divider />
            <div className={`${css.summaryRow} ${css.total}`}>
              <span>Total</span>
              <span data-testid="cart-total">{formatPrice(subtotal + shipping)}</span>
            </div>
            <Button variant="contained" fullWidth disabled title="Loja fictícia: não há pagamento">
              Finalizar compra
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
