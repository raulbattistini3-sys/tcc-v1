// Bootstrap, in the same order as market-angular's main.ts (and the shops'):
// conditions → probe → catalog (data + worker + calibration) → stores → render → ready.
import "@mui/material-pigment-css/styles.css";
import "./global.scss";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createCatalog } from "@shared/catalog.js";
import { readConditions } from "@shared/conditions.js";
import { installProbe, markReady, registerReset } from "@shared/harness.js";
import { startThirdParty } from "@shared/third-party.js";
import { CatalogProvider } from "./catalog/CatalogContext";
import { createCatalogStore } from "./stores/catalog.store";
import { useCartStore } from "./stores/cart.store";
import { useSessionStore } from "./stores/session.store";
import { Layout } from "./components/layout/Layout";
import { HomePage } from "./pages/HomePage";
import { ListingPage } from "./pages/ListingPage";
import { ProductPage } from "./pages/ProductPage";
import { CartPage } from "./pages/CartPage";
import { NotFound } from "./pages/NotFound";

const conditions = readConditions();
installProbe("react", conditions);

const catalog = await createCatalog({
  dataUrl: conditions.dataUrl,
  strategy: conditions.strategy,
  comparator: conditions.comparator,
  // literal `new Worker(new URL(...))` so Vite bundles the worker and its imports
  workerFactory: () => new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module", name: "tcc-compute" }),
});

const store = createCatalogStore(catalog, conditions.searchMode);
registerReset(() => store.getState().reset());

// cross-domain wiring lives here, not inside stores: whoever signs in owns the active cart
useSessionStore.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id) useCartStore.getState().switchOwner(s.user?.id ?? "guest");
});
if (conditions.loggedIn) useSessionStore.getState().signIn();

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: "lista", element: <ListingPage /> },
        { path: "produto/:index", element: <ProductPage /> },
        { path: "carrinho", element: <CartPage /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") },
);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <CatalogProvider value={{ catalog, store, conditions }}>
      <RouterProvider router={router} />
    </CatalogProvider>
  </StrictMode>,
);

// first frame after the first render
requestAnimationFrame(() => setTimeout(() => markReady(catalog), 0));
if (conditions.thirdParty) startThirdParty({ seed: conditions.seed });
