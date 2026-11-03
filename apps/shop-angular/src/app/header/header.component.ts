import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatToolbarModule } from "@angular/material/toolbar";
import { SearchBarComponent } from "./search-bar.component";
import { UserMenuComponent } from "./user-menu.component";
import { CartButtonComponent } from "./cart-button.component";
import { SessionStore } from "../stores/session.store";

// The header composes three independent pieces; each one reads its own store signal.
@Component({
  selector: "shop-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatToolbarModule, SearchBarComponent, UserMenuComponent, CartButtonComponent],
  template: `
    <mat-toolbar>
      <span class="brand">Loja TCC</span>
      <shop-search-bar class="search" />
      <span class="spacer"></span>
      <shop-user-menu />
      @if (session.signedIn()) {
        <shop-cart-button />
      }
    </mat-toolbar>
  `,
  styles: `
    @use "tokens" as t;
    mat-toolbar { gap: t.$space * 2; height: t.$header-height; }
    .brand { font-weight: 700; }
    .search { flex: 1; max-width: 640px; }
    .spacer { flex: 1; }
  `,
})
export class HeaderComponent {
  protected readonly session = inject(SessionStore);
}
