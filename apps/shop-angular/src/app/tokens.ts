import { InjectionToken } from "@angular/core";
import type { Catalog } from "@shared/catalog.js";
import type { Conditions } from "@shared/conditions.js";

// Created before bootstrap (same order as the React shop) and provided as values.
export const CATALOG = new InjectionToken<Catalog>("catalog");
export const CONDITIONS = new InjectionToken<Conditions>("conditions");
