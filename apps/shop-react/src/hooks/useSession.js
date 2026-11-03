import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../stores/session.store.js";

export const useUser = () => useSessionStore((s) => s.user);
export const useSignedIn = () => useSessionStore((s) => s.user !== null);
export const useSessionActions = () => useSessionStore(useShallow((s) => ({ signIn: s.signIn, signOut: s.signOut })));
