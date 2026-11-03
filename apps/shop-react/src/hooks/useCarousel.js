// rAF loop that scrolls a track every frame by writing `style.transform` on
// the ref, with no React state per frame (the Angular carousel does the same
// outside the zone). Both shops pay the same per-frame main-thread cost.

import { useEffect } from "react";

const SPEED_PX_PER_MS = 0.05;

/** @param {import("react").RefObject<HTMLElement | null>} ref @param {boolean} enabled */
export function useCarousel(ref, enabled) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let raf = 0;
    let last = performance.now();
    let x = 0;
    /** @param {number} t */
    const frame = (t) => {
      x = (x + (t - last) * SPEED_PX_PER_MS) % (el.scrollWidth / 2);
      last = t;
      el.style.transform = `translateX(${-x}px)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ref, enabled]);
}
