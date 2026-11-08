import { Outlet, ScrollRestoration } from "react-router";
import { useEffect } from "react";
import { useCatalog, useConditions } from "../../catalog/CatalogContext";
import { useUiStore } from "../../stores/session.store";
import { Header } from "./Header";
import { CategoryNav } from "./CategoryNav";
import css from "./layout.module.scss";

/** "Adicionado ao carrinho": a plain live region, not MUI's Snackbar (an elevated Paper, see Header). */
function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (message === null) return;
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return (
    <div className={css.toast} role="status" aria-live="polite" data-testid="toast" hidden={message === null}>
      {message}
    </div>
  );
}

export function Layout() {
  const toast = useUiStore((s) => s.toast);
  const hide = useUiStore((s) => s.hideToast);
  const { app, rows } = useCatalog();
  const { strategy } = useConditions();
  return (
    <>
      <Header />
      <CategoryNav />
      <main className={css.main}>
        <Outlet />
      </main>
      <footer className={css.footer}>
        <div className={css.footerInner}>
          <span>TCC Market · React 19 + MUI 7 (Pigment CSS) · loja fictícia para os experimentos</span>
          <span data-testid="scheduler-status">
            {rows.toLocaleString("pt-BR")} produtos · estratégia {strategy} · {app.workerError ? `sem worker (${app.workerError})` : "worker ativo"}
          </span>
        </div>
      </footer>
      <Toast message={toast} onDone={hide} />
      <ScrollRestoration />
    </>
  );
}
