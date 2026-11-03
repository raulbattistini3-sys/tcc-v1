// The catalog engine is created once at bootstrap and never changes, so it
// is a module singleton rather than React state or context: putting it in
// context would add nothing but a provider re-render path.

/** @typedef {import("@shared/catalog.js").Catalog} Catalog */

/** @type {Catalog | null} */
let instance = null;

/** @param {Catalog} c */
export function setCatalog(c) {
  instance = c;
}

/** @returns {Catalog} */
export function catalog() {
  if (!instance) throw new Error("catalog used before bootstrap");
  return instance;
}
