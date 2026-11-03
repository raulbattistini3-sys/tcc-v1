// Page conditions from the experiment design (the "Cenários de página
// e-commerce" table in "Desenho dos experimentos"). They come from the URL, so
// the Playwright harness sets them per run and both apps parse them the same way.
//
//   ?cond=empty        table only (the current lab baseline)
//   ?cond=layout       header + filter sidebar + product grid with images
//   ?cond=logged       layout + signed-in user: cart badge, recommendations, user menu (default)
//   ?cond=full         logged + third-party scripts + running carousel
//   &tp=1 &carousel=1  add either one to any preset
//   &strategy=adaptive|main|worker|fixed   &cmp=auto|locale   &data=/data/produtos.bin   &seed=7
//
// `hydration` only exists for Next; these SPAs have no hydration step.

/** @typedef {import("../../src/types.js").Strategy} Strategy */

/**
 * @typedef {object} Conditions
 * @property {"empty" | "layout" | "logged" | "full"} preset
 * @property {boolean} chrome header, sidebar, images
 * @property {boolean} loggedIn
 * @property {boolean} thirdParty
 * @property {boolean} carousel
 * @property {Strategy} strategy
 * @property {"auto" | "locale"} comparator
 * @property {string} dataUrl
 * @property {number} seed
 */

const PRESETS = /** @type {const} */ ({ empty: 0, layout: 1, logged: 2, full: 3 });
const STRATEGIES = ["adaptive", "main", "worker", "fixed"];

/** @param {string} [search] @returns {Conditions} */
export function readConditions(search = globalThis.location?.search ?? "") {
  const p = new URLSearchParams(search);
  const cond = p.get("cond") ?? "logged";
  const preset = /** @type {Conditions["preset"]} */ (cond in PRESETS ? cond : "logged");
  const level = PRESETS[preset];
  const flag = (/** @type {string} */ k) => p.get(k) === "1" || p.get(k) === "true";
  const strategy = p.get("strategy") ?? "adaptive";
  // Only same-origin paths: a `?data=` pointing elsewhere would make the page fetch whatever a link says.
  const data = p.get("data") ?? "";
  return {
    preset,
    chrome: level >= 1,
    loggedIn: level >= 2,
    thirdParty: level >= 3 || flag("tp"),
    carousel: level >= 3 || flag("carousel"),
    strategy: /** @type {Strategy} */ (STRATEGIES.includes(strategy) ? strategy : "adaptive"),
    comparator: p.get("cmp") === "locale" ? "locale" : "auto",
    dataUrl: /^\/[\w./-]+\.bin$/.test(data) && !data.includes("..") ? data : "/data/produtos.bin",
    seed: Number(p.get("seed") ?? 7) || 7,
  };
}
