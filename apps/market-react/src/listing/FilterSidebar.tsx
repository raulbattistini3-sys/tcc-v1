import { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { categoryLabel } from "@shared/market.js";
import { useCatalog } from "../catalog/CatalogContext";
import { useMirrorUrl } from "../hooks/market";
import { useCatalogStore } from "../stores/catalog.store";
import css from "./listing.module.scss";

const toNum = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** Each control calls a store action (which runs the query), then mirrors the URL. */
export function FilterSidebar() {
  const { categories } = useCatalog();
  const selected = useCatalogStore((s) => s.query.categories);
  const price = useCatalogStore((s) => s.query.price);
  const inStock = useCatalogStore((s) => s.query.inStock);
  const toggleCategory = useCatalogStore((s) => s.toggleCategory);
  const setPrice = useCatalogStore((s) => s.setPrice);
  const setInStock = useCatalogStore((s) => s.setInStock);
  const clearFilters = useCatalogStore((s) => s.clearFilters);
  const mirror = useMirrorUrl();
  const [min, setMin] = useState(price[0]?.toString() ?? "");
  const [max, setMax] = useState(price[1]?.toString() ?? "");

  return (
    <aside className={css.filters} aria-label="Filtros">
      <Card variant="outlined">
        <CardContent>
          <h3 className={css.filterTitle}>Categorias</h3>
          <FormGroup>
            {categories.map((c) => (
              <FormControlLabel
                key={c}
                control={
                  <Checkbox
                    size="small"
                    checked={selected.includes(c)}
                    onChange={() => {
                      toggleCategory(c);
                      mirror();
                    }}
                  />
                }
                label={categoryLabel(c)}
              />
            ))}
          </FormGroup>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent>
          <h3 className={css.filterTitle}>Preço</h3>
          <form
            className={css.priceRow}
            onSubmit={(e) => {
              e.preventDefault();
              setPrice([toNum(min), toNum(max)]);
              mirror();
            }}
          >
            <TextField size="small" label="Mínimo" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            <TextField size="small" label="Máximo" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            <Button type="submit" size="small" variant="outlined">
              Ok
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent>
          <FormControlLabel
            control={
              <Switch
                checked={inStock}
                onChange={(e) => {
                  setInStock(e.target.checked);
                  mirror();
                }}
              />
            }
            label="Somente em estoque"
          />
        </CardContent>
      </Card>
      <Button
        onClick={() => {
          setMin("");
          setMax("");
          clearFilters();
          mirror();
        }}
      >
        Limpar filtros
      </Button>
    </aside>
  );
}
