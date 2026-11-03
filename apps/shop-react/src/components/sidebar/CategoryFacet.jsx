import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormLabel from "@mui/material/FormLabel";
import { useCatalogStore } from "../../stores/catalog.store.js";
import { catalog } from "../../catalog-instance.js";

export function CategoryFacet() {
  const selected = useCatalogStore((s) => s.query.categories);
  const toggle = useCatalogStore((s) => s.toggleCategory);
  return (
    <FormGroup>
      <FormLabel component="legend">Categoria</FormLabel>
      {catalog().categories.map((c) => (
        <FormControlLabel key={c} label={c} control={<Checkbox size="small" checked={selected.includes(c)} onChange={() => toggle(c)} />} />
      ))}
    </FormGroup>
  );
}
