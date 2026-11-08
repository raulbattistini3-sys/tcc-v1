// Session domain (mock sign-in) and the one-at-a-time toast. Counterparts of market-react's
// session.store.ts.
import { computed } from "@angular/core";
import { patchState, signalStore, withComputed, withMethods, withState } from "@ngrx/signals";

export interface User {
  id: string;
  name: string;
  initials: string;
}

export const DEMO_USER: User = { id: "u-1001", name: "Cliente Demo", initials: "CD" };

export const SessionStore = signalStore(
  { providedIn: "root" },
  withState({ user: null as User | null }),
  withComputed(({ user }) => ({ signedIn: computed(() => user() !== null) })),
  withMethods((store) => ({
    signIn: () => patchState(store, { user: DEMO_USER }),
    signOut: () => patchState(store, { user: null }),
  })),
);

/** "Adicionado ao carrinho": a plain live region in both apps (not MatSnackBar / MUI Snackbar). */
export const UiStore = signalStore(
  { providedIn: "root" },
  withState({ toast: null as string | null }),
  withMethods((store) => ({
    showToast: (toast: string) => patchState(store, { toast }),
    hideToast: () => patchState(store, { toast: null }),
  })),
);
