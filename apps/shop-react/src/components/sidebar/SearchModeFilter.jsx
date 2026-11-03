import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { SEARCH_MODES } from "@shared/catalog.js";
import { useCatalogStore } from "../../stores/catalog.store.js";

/** @typedef {import("@shared/catalog.js").SearchMode} SearchMode */

// Substring scan vs inverted index (see src/compute/text-index.js).
export function SearchModeFilter() {
  const mode = useCatalogStore((s) => s.query.searchMode);
  const setSearchMode = useCatalogStore((s) => s.setSearchMode);
  return (
    <div>
      <FormLabel id="search-mode-label">Busca por</FormLabel>
      <RadioGroup aria-labelledby="search-mode-label" value={mode} onChange={(e) => setSearchMode(/** @type {SearchMode} */ (e.target.value))}>
        {SEARCH_MODES.map((m) => (
          <FormControlLabel key={m.value} value={m.value} control={<Radio size="small" />} label={m.label} data-testid={`search-mode-${m.value}`} />
        ))}
      </RadioGroup>
    </div>
  );
}
