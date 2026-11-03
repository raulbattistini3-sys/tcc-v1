// Bootstrap, in the same order as the Angular shop's main.ts:
// conditions → probe → catalog (data + worker + calibration) → stores → render → first query.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider } from "@mui/material/styles";
import { EMPTY_QUERY, createCatalog } from "@shared/catalog.js";
import { readConditions } from "@shared/conditions.js";
import { installProbe, markReady, registerReset } from "@shared/harness.js";
import { startThirdParty } from "@shared/third-party.js";
import { CatalogProvider } from "./catalog/CatalogContext.jsx";
import { createCatalogStore } from "./stores/catalog.store.js";
import { useCartStore } from "./stores/cart.store.js";
import { useSessionStore } from "./stores/session.store.js";
import { theme } from "./theme.js";
import { App } from "./App.jsx";

const conditions = readConditions();
installProbe("react", conditions);

const catalog = await createCatalog({
  dataUrl: conditions.dataUrl,
  strategy: conditions.strategy,
  comparator: conditions.comparator,
  // Literal `new Worker(new URL(...))` so Vite bundles the worker and its imports.
  workerFactory: () => new Worker(new URL("./compute.worker.js", import.meta.url), { type: "module", name: "tcc-compute" }),
});

// Initial state from the URL (Angular: the app initializer).
const store = createCatalogStore(catalog, {
  query: { ...EMPTY_QUERY, searchMode: conditions.searchMode },
  ...(conditions.chrome ? {} : { pageSize: 100 }),
});
registerReset(() => store.getState().reset());

// Cross-domain wiring lives here, not inside stores: whoever signs in owns the active cart.
useSessionStore.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id) useCartStore.getState().switchOwner(s.user?.id ?? "guest");
});
if (conditions.loggedIn) useSessionStore.getState().signIn();

// Strict CSP: emotion's <style> tags carry the server's per-response nonce.
// Without a server substitution (vite dev) the placeholder stays and is ignored.
const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute("content");
const emotionCache = createCache({ key: "mui", nonce: nonce && nonce !== "__CSP_NONCE__" ? nonce : undefined, prepend: true });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <CacheProvider value={emotionCache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <CatalogProvider value={{ catalog, store }}>
          <App conditions={conditions} workerError={catalog.app.workerError} />
        </CatalogProvider>
      </ThemeProvider>
    </CacheProvider>
  </StrictMode>,
);

await store.getState().refresh();
markReady(catalog);
if (conditions.thirdParty) startThirdParty({ seed: conditions.seed });
