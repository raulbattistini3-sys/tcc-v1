// Session domain: who is signed in. The design doc suggested Context for
// this; it lives in Zustand here so that every domain has the same shape and
// a sign-in re-renders only the components that read `user`.

import { create } from "zustand";

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} name
 * @property {string} initials
 */

/**
 * @typedef {object} SessionState
 * @property {User | null} user
 * @property {string} locale
 * @property {() => void} signIn mock sign-in, no credentials involved
 * @property {() => void} signOut
 */

/** @type {User} */
export const DEMO_USER = { id: "u-1001", name: "Cliente Demo", initials: "CD" };

export const useSessionStore = create(
  /** @returns {SessionState} */
  (set) => ({
    user: null,
    locale: "pt-BR",
    signIn: () => set({ user: DEMO_USER }),
    signOut: () => set({ user: null }),
  }),
);
