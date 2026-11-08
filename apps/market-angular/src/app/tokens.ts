import { InjectionToken } from "@angular/core";
import type { Catalog } from "@shared/catalog.js";
import type { Conditions } from "@shared/conditions.js";

/** The catalog engine (dataset, worker, scheduler), created once before bootstrap. */
export const CATALOG = new InjectionToken<Catalog>("catalog");
/** Page conditions from the URL (apps/shared/conditions.js). */
export const CONDITIONS = new InjectionToken<Conditions>("conditions");
