import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { CategoryFacet } from "./CategoryFacet.jsx";
import { PriceFilter } from "./PriceFilter.jsx";
import { StockToggle } from "./StockToggle.jsx";
import { SearchModeFilter } from "./SearchModeFilter.jsx";
import { useCatalogStore } from "../../stores/catalog.store.js";

export function FilterSidebar() {
  const clearFilters = useCatalogStore((s) => s.clearFilters);
  return (
    <Stack spacing={3} component="nav" aria-label="Filtros">
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        Filtros
      </Typography>
      <SearchModeFilter />
      <CategoryFacet />
      <PriceFilter />
      <StockToggle />
      <Button variant="text" onClick={clearFilters}>
        Limpar filtros
      </Button>
    </Stack>
  );
}
