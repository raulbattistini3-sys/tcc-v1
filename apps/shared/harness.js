// What the Playwright (Java) harness reads from the page. It is identical in
// both apps: `window.__shop`, plus performance marks it can pull over CDP.
//
//   shop:ready                      catalog loaded, first page rendered
//   shop:query:<id>:start|result    scheduler run (catalog.js)
//   shop:query:<id>:painted         first frame after the framework rendered it

/** @typedef {import("./catalog.js").CatalogResult} CatalogResult */
/** @typedef {import("./conditions.js").Conditions} Conditions */

/**
 * One row per query that reached the screen. Everything the harness needs
 * about a query is here, joined by queryId, so it never has to match log events.
 * Times are page-clock ms (performance.now()).
 * @typedef {object} PaintedQuery
 * @property {number} queryId
 * @property {"main" | "worker"} target
 * @property {string} reason
 * @property {boolean} explored
 * @property {number} total rows in the result
 * @property {number} computeToResultMs scheduler run: time to result
 * @property {number} mainBlockedMs scheduler run: main-thread time it took
 * @property {number} prepareMs one-off string decoding / index build inside the run
 * @property {number} prepared strings decoded in that step
 * @property {number} filterMs
 * @property {number} sortMs
 * @property {string} sortClass
 * @property {number} predMainMs
 * @property {number} predWorkerMs
 * @property {number} budgetMs
 * @property {number} mainBusy
 * @property {string} pressure
 * @property {number | null} postMs worker runs: main thread inside postMessage
 * @property {number | null} queueMs worker runs
 * @property {number | null} replyMs worker runs: compute end → page received
 * @property {number | null} startAt query start (mark)
 * @property {number} paintedAt first frame after render
 * @property {number | null} toPaintMs paintedAt - startAt
 */

/**
 * @typedef {object} ShopProbe
 * @property {"react" | "angular"} framework
 * @property {Conditions} conditions
 * @property {boolean} ready
 * @property {PaintedQuery[]} queries
 * @property {string | null} workerError
 * @property {object[]} log every telemetry event (decisions, results with timing breakdown, LoAF, INP)
 * @property {() => void} reset back to the initial query (empty search, no facets, no sort, page 0).
 *   Not a user interaction: the harness calls it between passes and does not measure it.
 */

/** @returns {ShopProbe | undefined} */
const probe = () => /** @type {any} */ (globalThis).__shop;

/** @param {"react" | "angular"} framework @param {Conditions} conditions @returns {ShopProbe} */
export function installProbe(framework, conditions) {
  /** @type {ShopProbe} */
  const p = { framework, conditions, ready: false, queries: [], workerError: null, log: [], reset: () => {} };
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
      const d = r.decision;
      const w = r.workerTiming;
      probe()?.queries.push({
        queryId: r.queryId,
        target: r.target,
        reason: d.reason,
        explored: d.explored,
        total: r.total,
        computeToResultMs: r.totalMs,
        mainBlockedMs: r.mainBlockedMs,
        prepareMs: r.stats.prepareMs,
        prepared: r.stats.prepared,
        filterMs: r.stats.filterMs,
        sortMs: r.stats.sortMs,
        sortClass: r.stats.sortClass,
        predMainMs: d.predMainMs,
        predWorkerMs: d.predWorkerMs,
        budgetMs: d.budgetMs,
        mainBusy: d.mainBusy,
        pressure: d.pressure,
        postMs: w?.postMs ?? null,
        queueMs: w?.queueMs ?? null,
        replyMs: w?.replyMs ?? null,
        startAt: start ? start.startTime : null,
        paintedAt: end.startTime,
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

/** Each app registers how to return to the initial query. @param {() => void} fn */
export function registerReset(fn) {
  const p = probe();
  if (p) p.reset = fn;
}
