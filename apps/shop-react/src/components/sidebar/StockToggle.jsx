import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import { useCatalogStore } from "../../stores/catalog.store.js";

export function StockToggle() {
  const inStock = useCatalogStore((s) => s.query.inStock);
  const setInStock = useCatalogStore((s) => s.setInStock);
  return <FormControlLabel control={<Switch checked={inStock} onChange={(e) => setInStock(e.target.checked)} />} label="Somente em estoque" />;
}
