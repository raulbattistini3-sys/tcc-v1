// Session domain: who is signed in (mock, no credentials). Same as shop-react's.
import { create } from "zustand";

export type User = { id: string; name: string; initials: string };
export const DEMO_USER: User = { id: "u-1001", name: "Cliente Demo", initials: "CD" };

type SessionState = { user: User | null; signIn: () => void; signOut: () => void };

export const useSessionStore = create<SessionState>()((set) => ({
  user: null,
  signIn: () => set({ user: DEMO_USER }),
  signOut: () => set({ user: null }),
}));

/** One toast at a time ("Adicionado ao carrinho"); Angular uses MatSnackBar for the same. */
type UiState = { toast: string | null; showToast: (msg: string) => void; hideToast: () => void };
export const useUiStore = create<UiState>()((set) => ({
  toast: null,
  showToast: (toast) => set({ toast }),
  hideToast: () => set({ toast: null }),
}));
