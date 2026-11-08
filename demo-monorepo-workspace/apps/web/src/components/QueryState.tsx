import ui from "../ui.module.css";

/** Loading, error and empty states for a query, so each page only renders data. */
export function QueryState({ isLoading, error, empty, emptyText }: { isLoading: boolean; error: unknown; empty: boolean; emptyText: string }) {
  if (isLoading) return <p className={ui.muted}>Carregando…</p>;
  if (error) return <p className={ui.error}>{error instanceof Error ? error.message : String(error)}</p>;
  if (empty) return <p className={ui.muted}>{emptyText}</p>;
  return null;
}
