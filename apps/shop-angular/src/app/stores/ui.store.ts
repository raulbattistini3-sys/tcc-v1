// UI domain: drawers and view mode. Counterpart of ui.store.js (Zustand).
import { patchState, signalStore, withMethods, withState } from "@ngrx/signals";

export const UiStore = signalStore(
  { providedIn: "root" },
  withState({ view: "grid" as "grid" | "table", cartOpen: false }),
  withMethods((store) => ({
    setView: (view: "grid" | "table") => patchState(store, { view }),
    setCartOpen: (cartOpen: boolean) => patchState(store, { cartOpen }),
  })),
);
