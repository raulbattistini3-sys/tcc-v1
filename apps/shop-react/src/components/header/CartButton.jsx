import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { selectCount, useCartStore } from "../../stores/cart.store.js";
import { useUiStore } from "../../stores/ui.store.js";

// Selects a number, not the lines: changing a line's name or price wouldn't re-render the badge.
export function CartButton() {
  const count = useCartStore(selectCount);
  const setCartOpen = useUiStore((s) => s.setCartOpen);
  return (
    <IconButton color="inherit" onClick={() => setCartOpen(true)} aria-label={`Carrinho, ${count} itens`}>
      <Badge badgeContent={count} color="secondary">
        <ShoppingCartIcon />
      </Badge>
    </IconButton>
  );
}
