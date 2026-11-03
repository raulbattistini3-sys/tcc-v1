import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import { formatPrice } from "@shared/catalog.js";
import { selectLines, selectSubtotal, useCartStore } from "../../stores/cart.store.js";
import { useUiStore } from "../../stores/ui.store.js";

export function CartDrawer() {
  const open = useUiStore((s) => s.cartOpen);
  const setOpen = useUiStore((s) => s.setCartOpen);
  return (
    <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
      <Stack sx={{ width: 360, p: 2, height: "100%" }} spacing={2}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">Carrinho</Typography>
          <IconButton onClick={() => setOpen(false)} aria-label="Fechar carrinho">
            <CloseIcon />
          </IconButton>
        </Stack>
        {/* Lines live in their own component: the drawer frame doesn't re-render on qty changes. */}
        {open && <CartLines />}
      </Stack>
    </Drawer>
  );
}

function CartLines() {
  const lines = useCartStore(selectLines);
  const subtotal = useCartStore(selectSubtotal);
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);
  const clear = useCartStore((s) => s.clear);

  if (lines.length === 0) return <Typography color="text.secondary">Seu carrinho está vazio.</Typography>;
  return (
    <>
      <List dense sx={{ flex: 1, overflowY: "auto" }}>
        {lines.map((l) => (
          <ListItem
            key={l.index}
            secondaryAction={
              <IconButton edge="end" aria-label={`Remover ${l.name}`} onClick={() => remove(l.index)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            }
          >
            <ListItemText primary={l.name} secondary={`${l.sku} · ${formatPrice(l.price)}`} />
            <TextField
              type="number"
              size="small"
              value={l.qty}
              onChange={(e) => setQty(l.index, Number(e.target.value))}
              sx={{ width: 72, mr: 4 }}
              slotProps={{ htmlInput: { min: 0, "aria-label": `Quantidade de ${l.name}` } }}
            />
          </ListItem>
        ))}
      </List>
      <Typography variant="subtitle1">Subtotal: {formatPrice(subtotal)}</Typography>
      <Stack direction="row" spacing={1}>
        <Button variant="contained" fullWidth disabled>
          Finalizar compra
        </Button>
        <Button onClick={clear}>Esvaziar</Button>
      </Stack>
    </>
  );
}
