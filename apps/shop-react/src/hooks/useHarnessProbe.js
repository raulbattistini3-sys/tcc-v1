// Marks the frame that shows each new result. The effect runs after React
// has committed the rows (Angular: afterNextRender), so it only observes;
// the query itself already ran in the store action.

import { useEffect } from "react";
import { markPainted } from "@shared/harness.js";
import { useCatalogStore } from "../stores/catalog.store.js";

export function useHarnessProbe() {
  const result = useCatalogStore((s) => s.result);
  useEffect(() => {
    if (result) markPainted(result);
  }, [result]);
}
