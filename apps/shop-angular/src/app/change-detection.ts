import { provideZonelessChangeDetection } from "@angular/core";

// Default build: zoneless (Angular's default since v21). Change detection
// runs only when a signal read by a template changes. A worker message, a
// timer or a rAF tick does not trigger it by itself.
// `ng build --configuration zone` swaps in change-detection.zone.ts.
export const changeDetection = [provideZonelessChangeDetection()];
export const changeDetectionMode = "zoneless" as const;
