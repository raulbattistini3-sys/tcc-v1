// Bootstrap, in the same order as the React shop's main.jsx:
// conditions → probe → catalog (data + worker + calibration) → stores → render → first query.
import { ApplicationRef, effect, inject, provideAppInitializer } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { registerLocaleData } from "@angular/common";
import localePt from "@angular/common/locales/pt";
import { createCatalog } from "@shared/catalog.js";
import { readConditions } from "@shared/conditions.js";
import { installProbe, markReady } from "@shared/harness.js";
import { startThirdParty } from "@shared/third-party.js";
import { AppComponent } from "./app/app.component";
import { changeDetection } from "./app/change-detection";
import { CartStore } from "./app/stores/cart.store";
import { CatalogStore } from "./app/stores/catalog.store";
import { SessionStore } from "./app/stores/session.store";
import { CATALOG, CONDITIONS } from "./app/tokens";

registerLocaleData(localePt, "pt-BR");

// An async function, not top-level await: zone.js builds reject TLA, and both
// builds must run the same bootstrap code.
async function boot() {
  const conditions = readConditions();
  installProbe("angular", conditions);

  const catalog = await createCatalog({
    dataUrl: conditions.dataUrl,
    strategy: conditions.strategy,
    comparator: conditions.comparator,
    // Literal `new Worker(new URL(...))` so the Angular builder bundles the worker.
    workerFactory: () => new Worker(new URL("./app/compute.worker", import.meta.url), { type: "module", name: "tcc-compute" }),
  });

  const app = await bootstrapApplication(AppComponent, {
    providers: [
      ...changeDetection,
      { provide: CATALOG, useValue: catalog },
      { provide: CONDITIONS, useValue: conditions },
      provideAppInitializer(() => {
        const session = inject(SessionStore);
        const cart = inject(CartStore);
        const store = inject(CatalogStore);
        // Cross-domain wiring lives here, not inside stores: whoever signs in owns the active cart.
        effect(() => cart.switchOwner(session.user()?.id ?? "guest"));
        if (conditions.loggedIn) session.signIn();
        if (!conditions.chrome) store.setPageSize(100);
      }),
    ],
  });

  await app.injector.get(CatalogStore).refresh();
  await app.injector.get(ApplicationRef).whenStable();
  markReady(catalog);
  if (conditions.thirdParty) startThirdParty({ seed: conditions.seed });
}

void boot();
