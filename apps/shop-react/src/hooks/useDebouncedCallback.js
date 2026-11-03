import { useEffect, useMemo, useRef } from "react";

/**
 * A debounced version of `fn`: the call fires `ms` after the last one, from
 * the timer itself, with no render or effect in between (Angular: RxJS
 * `debounceTime` in an rxMethod). The effect below only clears the timer on unmount.
 * @template {unknown[]} A
 * @param {(...args: A) => void} fn
 * @param {number} ms
 * @returns {(...args: A) => void}
 */
export function useDebouncedCallback(fn, ms) {
  const latest = useRef(fn);
  latest.current = fn;
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  useEffect(() => () => clearTimeout(timer.current), []);
  return useMemo(
    () =>
      (/** @type {A} */ ...args) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => latest.current(...args), ms);
      },
    [ms],
  );
}
