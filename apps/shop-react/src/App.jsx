// Page composition per experiment condition. Every piece is its own
// component with its own store subscription; the layout only arranges slots.

import { ShopLayout } from "./components/layout/ShopLayout.jsx";
import { Header } from "./components/header/Header.jsx";
import { FilterSidebar } from "./components/sidebar/FilterSidebar.jsx";
import { ProductCatalog } from "./components/catalog/ProductCatalog.jsx";
import { CartDrawer } from "./components/cart/CartDrawer.jsx";
import { Recommendations } from "./components/recommendations/Recommendations.jsx";
import { SchedulerStatus } from "./components/status/SchedulerStatus.jsx";
import { useSessionStore } from "./stores/session.store.js";

/** @param {{ conditions: import("@shared/conditions.js").Conditions, workerError: string | null }} props */
export function App({ conditions, workerError }) {
  const signedIn = useSessionStore((s) => s.user !== null);
  const footer = <SchedulerStatus framework="react" workerError={workerError} />;

  // Baseline: the lab page. Only the table, no shop chrome.
  if (!conditions.chrome) {
    return (
      <ShopLayout footer={footer}>
        <ProductCatalog forceView="table" />
      </ShopLayout>
    );
  }
  return (
    <>
      <ShopLayout header={<Header />} sidebar={<FilterSidebar />} footer={footer}>
        {signedIn && <Recommendations autoplay={conditions.carousel} />}
        <ProductCatalog />
      </ShopLayout>
      {signedIn && <CartDrawer />}
    </>
  );
}
