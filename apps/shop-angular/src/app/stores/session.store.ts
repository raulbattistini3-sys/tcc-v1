// Session domain: who is signed in. Counterpart of session.store.js (Zustand).
import { patchState, signalStore, withMethods, withState, withComputed } from "@ngrx/signals";
import { computed } from "@angular/core";

export interface User {
  id: string;
  name: string;
  initials: string;
}

export const DEMO_USER: User = { id: "u-1001", name: "Cliente Demo", initials: "CD" };

export const SessionStore = signalStore(
  { providedIn: "root" },
  withState({ user: null as User | null, locale: "pt-BR" }),
  withComputed(({ user }) => ({ signedIn: computed(() => user() !== null) })),
  withMethods((store) => ({
    /** Mock sign-in, no credentials involved. */
    signIn: () => patchState(store, { user: DEMO_USER }),
    signOut: () => patchState(store, { user: null }),
  })),
);
