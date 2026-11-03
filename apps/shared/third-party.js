// Simulated tag manager / analytics: long tasks the app does not control.
// It is seeded, so both frameworks get the same schedule of blocking work.
// It has the same shape as real tags: a big parse at load, periodic beacons,
// and a handler on every click, which lands inside the interaction that INP measures.

/** @param {number} ms */
function burn(ms) {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
}

/** @param {number} seed */
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/**
 * @param {{ seed?: number, loadMs?: number, everyMs?: [number, number], taskMs?: [number, number], clickMs?: number }} [o]
 * @returns {() => void} stop
 */
export function startThirdParty({ seed = 7, loadMs = 120, everyMs = [1500, 3500], taskMs = [60, 140], clickMs = 35 } = {}) {
  const rnd = prng(seed);
  const between = (/** @type {[number, number]} */ [a, b]) => a + rnd() * (b - a);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const tick = () => {
    performance.mark("3p:task");
    burn(between(taskMs));
    timer = setTimeout(tick, between(everyMs));
  };
  const onClick = () => burn(clickMs);
  // "Script evaluation", right after the app's own bootstrap.
  const boot = setTimeout(() => {
    burn(loadMs);
    timer = setTimeout(tick, between(everyMs));
  }, 0);
  document.addEventListener("click", onClick, { capture: true });
  return () => {
    clearTimeout(boot);
    clearTimeout(timer);
    document.removeEventListener("click", onClick, { capture: true });
  };
}
