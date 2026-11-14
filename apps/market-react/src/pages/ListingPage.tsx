import { useEffect } from "react";
import { useLocation } from "react-router";
import NativeSelect from "@mui/material/NativeSelect";
import LinearProgress from "@mui/material/LinearProgress";
import { SORTS, categoryLabel, paramsFromQuery, queryFromParams, sortValue } from "@shared/market.js";
import { useCatalogStoreApi, useConditions } from "../catalog/CatalogContext";
import { useHarnessProbe, useMirrorUrl } from "../hooks/market";
import { useCatalogStore } from "../stores/catalog.store";
import { FilterSidebar } from "../listing/FilterSidebar";
import { VirtualGrid } from "../listing/VirtualGrid";
import css from "../listing/listing.module.scss";

const count = new Intl.NumberFormat("pt-BR");
const ms = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

export function ListingPage() {
  useHarnessProbe();
  const store = useCatalogStoreApi();
  const { searchMode } = useConditions();
  const location = useLocation();
  const query = useCatalogStore((s) => s.query);
  const result = useCatalogStore((s) => s.result);
  const status = useCatalogStore((s) => s.status);
  const setSorting = useCatalogStore((s) => s.setSorting);
  const mirror = useMirrorUrl();

  // Arriving from a link, a reload or back/forward: the URL decides. A handler that already ran the
  // query (header search, a filter) left the store equal to the URL, so this does nothing then.
  useEffect(() => {
    const fromUrl = queryFromParams(new URLSearchParams(location.search), searchMode);
    if (!same(paramsFromQuery(fromUrl), paramsFromQuery(store.getState().query)) || store.getState().status === "idle") store.getState().setQuery(fromUrl);
  }, [location.search, searchMode, store]);

  const heading = query.search ? `“${query.search}”` : query.categories.length === 1 ? categoryLabel(query.categories[0]!) : "Todos os produtos";
  return (
    <div className={css.layout}>
      <FilterSidebar />
      <section>
        <div className={css.head}>
          <div>
            <h1 className={css.heading}>{heading}</h1>
            <div className={css.status} data-testid="results-status">
              {result ? `${count.format(result.total)} resultados · ${ms.format(result.totalMs)} ms no ${result.target === "worker" ? "worker" : "main thread"}` : "Buscando…"}
            </div>
          </div>
          {/* native <select>: MUI's Select opens an elevated Paper (see Header); Angular uses a native one too */}
          <NativeSelect
            value={sortValue(query.sorting)}
            onChange={(e) => {
              setSorting(SORTS.find((s) => s.value === e.target.value)?.sorting ?? []);
              mirror();
            }}
            inputProps={{ "aria-label": "Ordenar por" }}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {status === "loading" && <LinearProgress />}
        {result && result.total === 0 && <p className={css.empty}>Nenhum produto encontrado. Tente outros termos ou limpe os filtros.</p>}
        {result && result.total > 0 && <VirtualGrid indices={result.indices} />}
      </section>
    </div>
  );
}
