import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { useCartCount } from "../../hooks/useCart.js";
import { useUiStore } from "../../stores/ui.store.js";

export function CartButton() {
  const count = useCartCount();
  const setCartOpen = useUiStore((s) => s.setCartOpen);
  return (
    <IconButton color="inherit" onClick={() => setCartOpen(true)} aria-label={`Carrinho, ${count} itens`}>
      <Badge badgeContent={count} color="secondary">
        <ShoppingCartIcon />
      </Badge>
    </IconButton>
  );
}
