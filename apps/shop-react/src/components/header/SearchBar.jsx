import InputBase from "@mui/material/InputBase";
import SearchIcon from "@mui/icons-material/Search";
import styles from "./SearchBar.module.scss";
import { useCatalogStore } from "../../stores/catalog.store.js";

// Controlled by `searchInput`, so every keystroke re-renders only this
// component. The debounced commit, the scheduler run and the table update
// happen in the store.
export function SearchBar() {
  const value = useCatalogStore((s) => s.searchInput);
  const setSearchInput = useCatalogStore((s) => s.setSearchInput);
  return (
    <label className={styles.search}>
      <SearchIcon fontSize="small" />
      <InputBase
        className={styles.input}
        placeholder="Buscar produtos…"
        value={value}
        onChange={(e) => setSearchInput(e.target.value)}
        inputProps={{ "aria-label": "Buscar produtos", "data-testid": "search" }}
      />
    </label>
  );
}
