// Page composition per experiment condition (same tree as the React App.jsx).
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatSidenavModule } from "@angular/material/sidenav";
import { ShopLayoutComponent } from "./layout/shop-layout.component";
import { HeaderComponent } from "./header/header.component";
import { FilterSidebarComponent } from "./sidebar/filter-sidebar.component";
import { ProductCatalogComponent } from "./catalog/product-catalog.component";
import { CartDrawerComponent } from "./cart/cart-drawer.component";
import { RecommendationsComponent } from "./recommendations/recommendations.component";
import { SchedulerStatusComponent } from "./status/scheduler-status.component";
import { SessionStore } from "./stores/session.store";
import { UiStore } from "./stores/ui.store";
import { CATALOG, CONDITIONS } from "./tokens";

@Component({
  selector: "shop-root",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatSidenavModule,
    ShopLayoutComponent,
    HeaderComponent,
    FilterSidebarComponent,
    ProductCatalogComponent,
    CartDrawerComponent,
    RecommendationsComponent,
    SchedulerStatusComponent,
  ],
  template: `
    @if (!conditions.chrome) {
      <!-- Baseline: the lab page. Only the table, no shop chrome. -->
      <shop-layout>
        <shop-product-catalog forceView="table" />
        <shop-scheduler-status shopFooter [workerError]="workerError" />
      </shop-layout>
    } @else {
      <mat-sidenav-container>
        <mat-sidenav position="end" mode="over" [opened]="ui.cartOpen()" (closedStart)="ui.setCartOpen(false)">
          @if (ui.cartOpen()) {
            <shop-cart-drawer />
          }
        </mat-sidenav>
        <mat-sidenav-content>
          <shop-layout [hasSidebar]="true">
            <shop-header shopHeader />
            <shop-filter-sidebar shopSidebar />
            @if (session.signedIn()) {
              <shop-recommendations [autoplay]="conditions.carousel" />
            }
            <shop-product-catalog />
            <shop-scheduler-status shopFooter [workerError]="workerError" />
          </shop-layout>
        </mat-sidenav-content>
      </mat-sidenav-container>
    }
  `,
  styles: `mat-sidenav-container { min-height: 100vh; background: transparent; }`,
})
export class AppComponent {
  protected readonly conditions = inject(CONDITIONS);
  protected readonly workerError = inject(CATALOG).app.workerError;
  protected readonly session = inject(SessionStore);
  protected readonly ui = inject(UiStore);
}
