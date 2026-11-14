// Bootstrap, in the same order as market-react's main.tsx (and the shops'):
// conditions → probe → catalog (data + worker + calibration) → stores → render → ready.
import { ApplicationRef, effect, inject, provideAppInitializer, provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, withInMemoryScrolling } from "@angular/router";
import { createCatalog } from "@shared/catalog.js";
import { readConditions } from "@shared/conditions.js";
import { installProbe, markReady, registerReset } from "@shared/harness.js";
import { startThirdParty } from "@shared/third-party.js";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";
import { CartStore } from "./app/stores/cart.store";
import { CatalogStore } from "./app/stores/catalog.store";
import { SessionStore } from "./app/stores/session.store";
import { CATALOG, CONDITIONS } from "./app/tokens";

async function boot() {
  const conditions = readConditions();
  installProbe("angular", conditions);

  const catalog = await createCatalog({
    dataUrl: conditions.dataUrl,
    strategy: conditions.strategy,
    comparator: conditions.comparator,
    // literal `new Worker(new URL(...))` so the Angular builder bundles the worker
    workerFactory: () => new Worker(new URL("./app/compute.worker", import.meta.url), { type: "module", name: "tcc-compute" }),
  });

  const app = await bootstrapApplication(AppComponent, {
    providers: [
      // zoneless, Angular's default since v21 (as shop-angular's default build)
      provideZonelessChangeDetection(),
      // scroll to top on navigation and back to where you were on back/forward (React: <ScrollRestoration />)
      provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: "enabled" })),
      { provide: CATALOG, useValue: catalog },
      { provide: CONDITIONS, useValue: conditions },
      provideAppInitializer(() => {
        const session = inject(SessionStore);
        const cart = inject(CartStore);
        const store = inject(CatalogStore);
        // cross-domain wiring lives here, not inside stores: whoever signs in owns the active cart
        effect(() => cart.switchOwner(session.user()?.id ?? "guest"));
        if (conditions.loggedIn) session.signIn();
        registerReset(() => store.reset());
      }),
    ],
  });

  await app.injector.get(ApplicationRef).whenStable();
  markReady(catalog);
  if (conditions.thirdParty) startThirdParty({ seed: conditions.seed });
}

void boot();
