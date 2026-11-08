import Button from "@mui/material/Button";
import { categoryLabel } from "@shared/market.js";
import { useCatalog } from "../../catalog/CatalogContext";
import { useOpenListing } from "../../hooks/market";
import css from "./layout.module.scss";

export function CategoryNav() {
  const { categories } = useCatalog();
  const open = useOpenListing();
  return (
    <nav className={css.nav} aria-label="Categorias">
      <div className={css.navInner}>
        {categories.map((c) => (
          <Button key={c} size="small" color="inherit" onClick={() => open({ categories: [c] })}>
            {categoryLabel(c)}
          </Button>
        ))}
      </div>
    </nav>
  );
}
