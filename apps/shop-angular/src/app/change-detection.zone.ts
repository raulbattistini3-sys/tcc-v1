import { provideZoneChangeDetection } from "@angular/core";

// Control build: zone.js patches every async API, so each worker message,
// timer and event schedules an app-wide change detection pass. This is the
// "small, publishable detail" from the experiment design.
export const changeDetection = [provideZoneChangeDetection({ eventCoalescing: true })];
export const changeDetectionMode = "zone" as const;
