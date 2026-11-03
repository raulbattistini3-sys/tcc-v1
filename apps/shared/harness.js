// What the Playwright (Java) harness reads from the page. It is identical in
// both apps: `window.__shop`, plus performance marks it can pull over CDP.
//
//   shop:ready                      catalog loaded, first page rendered
//   shop:query:<id>:start|result    scheduler run (catalog.js)
//   shop:query:<id>:painted         first frame after the framework rendered it

/** @typedef {import("./catalog.js").CatalogResult} CatalogResult */
/** @typedef {import("./conditions.js").Conditions} Conditions */

/**
 * @typedef {object} PaintedQuery
 * @property {number} queryId
 * @property {"main" | "worker"} target
 * @property {string} reason
 * @property {number} total
 * @property {number} computeToResultMs
 * @property {number} mainBlockedMs
 * @property {number | null} toPaintMs query start → frame after render
 */

/**
 * @typedef {object} ShopProbe
 * @property {"react" | "angular"} framework
 * @property {Conditions} conditions
 * @property {boolean} ready
 * @property {PaintedQuery[]} queries
 * @property {string | null} workerError
 * @property {object[]} log every telemetry event (decisions, results with timing breakdown, LoAF, INP)
 */

/** @returns {ShopProbe | undefined} */
const probe = () => /** @type {any} */ (globalThis).__shop;

/** @param {"react" | "angular"} framework @param {Conditions} conditions @returns {ShopProbe} */
export function installProbe(framework, conditions) {
  /** @type {ShopProbe} */
  const p = { framework, conditions, ready: false, queries: [], workerError: null, log: [] };
  /** @type {any} */ (globalThis).__shop = p;
  return p;
}

/**
 * Call right after the framework has committed the new rows. Paint follows on
 * the next rAF; the setTimeout runs once that frame has been produced.
 * @param {CatalogResult} r
 */
export function markPainted(r) {
  requestAnimationFrame(() =>
    setTimeout(() => {
      const end = performance.mark(`shop:query:${r.queryId}:painted`);
      const start = performance.getEntriesByName(`shop:query:${r.queryId}:start`)[0];
      probe()?.queries.push({
        queryId: r.queryId,
        target: r.target,
        reason: r.decision.reason,
        total: r.total,
        computeToResultMs: r.totalMs,
        mainBlockedMs: r.mainBlockedMs,
        toPaintMs: start ? end.startTime - start.startTime : null,
      });
    }, 0),
  );
}

/** @param {import("./catalog.js").Catalog} catalog */
export function markReady(catalog) {
  performance.mark("shop:ready");
  const p = probe();
  if (p) {
    p.ready = true;
    p.workerError = catalog.app.workerError;
    p.log = catalog.app.log;
  }
}
