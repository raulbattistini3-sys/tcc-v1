import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormLabel from "@mui/material/FormLabel";
import { useCatalogStore } from "../../stores/catalog.store.js";
import { useCatalog } from "../../catalog/CatalogContext.jsx";

export function CategoryFacet() {
  const selected = useCatalogStore((s) => s.query.categories);
  const toggle = useCatalogStore((s) => s.toggleCategory);
  const { categories } = useCatalog();
  return (
    <FormGroup>
      <FormLabel component="legend">Categoria</FormLabel>
      {categories.map((c, i) => (
        <FormControlLabel key={c} label={c} data-testid={`category-${i}`} control={<Checkbox size="small" checked={selected.includes(c)} onChange={() => toggle(c)} />} />
      ))}
    </FormGroup>
  );
}
