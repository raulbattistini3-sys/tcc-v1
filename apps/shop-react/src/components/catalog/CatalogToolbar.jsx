import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import GridViewIcon from "@mui/icons-material/GridView";
import TableRowsIcon from "@mui/icons-material/TableRows";
import { SORT_OPTIONS } from "@shared/columns.js";
import { useCatalogStore } from "../../stores/catalog.store.js";
import { useUiStore } from "../../stores/ui.store.js";
import styles from "./Catalog.module.scss";

const nf = new Intl.NumberFormat("pt-BR");

/** @param {{ table: import("../../hooks/useProductTable.js").ProductTable, showViewToggle: boolean }} props */
export function CatalogToolbar({ table, showViewToggle }) {
  const total = useCatalogStore((s) => s.result?.total ?? 0);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const sorting = table.state.sorting;
  const current = Math.max(
    0,
    SORT_OPTIONS.findIndex((o) => JSON.stringify(o.sorting) === JSON.stringify(sorting)),
  );

  return (
    <div className={styles.toolbar}>
      <Typography variant="body2" data-testid="total">
        {nf.format(total)} produtos
      </Typography>
      <span className={styles.spacer} />
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="sort-label">Ordenar por</InputLabel>
        <Select labelId="sort-label" label="Ordenar por" value={current} onChange={(e) => table.setSorting(SORT_OPTIONS[Number(e.target.value)].sorting)}>
          {SORT_OPTIONS.map((o, i) => (
            <MenuItem key={o.label} value={i}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {showViewToggle && (
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label="Visualização">
          <ToggleButton value="grid" aria-label="Grade" data-testid="view-grid">
            <GridViewIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="table" aria-label="Tabela" data-testid="view-table">
            <TableRowsIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      )}
    </div>
  );
}
