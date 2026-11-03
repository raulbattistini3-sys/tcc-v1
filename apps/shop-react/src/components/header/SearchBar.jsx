import { useState } from "react";
import InputBase from "@mui/material/InputBase";
import SearchIcon from "@mui/icons-material/Search";
import { SEARCH_DEBOUNCE_MS } from "@shared/catalog.js";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback.js";
import { useCatalogStore } from "../../stores/catalog.store.js";
import styles from "./SearchBar.module.scss";

// What is typed is local state: a keystroke re-renders only this component.
// The debounced callback commits to the store from its timer, and the store
// action runs the query there and then.
export function SearchBar() {
  const committed = useCatalogStore((s) => s.query.search);
  const setSearch = useCatalogStore((s) => s.setSearch);
  const commitLater = useDebouncedCallback(setSearch, SEARCH_DEBOUNCE_MS);
  const [text, setText] = useState(committed);

  // External resets ("Limpar filtros", harness) flow back into the box, during render, not in an effect.
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    setSeen(committed);
    setText(committed);
  }

  return (
    <label className={styles.search}>
      <SearchIcon fontSize="small" />
      <InputBase
        className={styles.input}
        placeholder="Buscar produtos…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commitLater(e.target.value);
        }}
        inputProps={{ "aria-label": "Buscar produtos", "data-testid": "search" }}
      />
    </label>
  );
}
