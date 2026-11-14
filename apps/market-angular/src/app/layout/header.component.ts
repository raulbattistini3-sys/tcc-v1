import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatIconButton } from "@angular/material/button";
import { IconComponent } from "../icon.component";
import { injectOpenListing } from "../market";
import { CartStore } from "../stores/cart.store";
import { SessionStore } from "../stores/session.store";

/**
 * A plain <header> with a plain search input, as market-react draws it (MUI's AppBar is an elevated
 * Paper that Pigment can't theme at run time; mat-toolbar would be the Angular equivalent, so neither
 * app uses its kit's bar).
 */
@Component({
  selector: "mk-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconButton, IconComponent],
  template: `
    <header class="appbar">
      <div class="row">
        <a routerLink="/" class="logo">TCC Market</a>
        <form role="search" class="search" (submit)="submit($event)">
          <input
            class="searchInput"
            placeholder="Buscar produtos, marcas e muito mais…"
            aria-label="Buscar produtos"
            data-testid="search-input"
            [value]="text()"
            (input)="text.set($any($event.target).value)"
          />
          <button matIconButton type="submit" aria-label="Buscar"><mk-icon name="search" /></button>
        </form>
        <div class="actions">
          @if (session.user(); as user) {
            <span class="user">Olá, {{ user.name.split(" ")[0] }}</span>
          }
          <a matIconButton routerLink="/carrinho" [attr.aria-label]="'Carrinho, ' + cart.count() + ' itens'" class="cartLink">
            <span class="badgeHost">
              <mk-icon name="shopping_cart" />
              @if (cart.count() > 0) {
                <span class="badge" data-testid="cart-count">{{ cart.count() }}</span>
              }
            </span>
          </a>
        </div>
      </div>
    </header>
  `,
  styles: `
    @use "tokens" as t;
    @use "market" as m;
    .appbar { @include m.appbar; }
    .row { @include m.header-row; }
    .logo { @include m.logo; grid-area: logo; }
    .search { @include m.search; grid-area: search; }
    .searchInput { flex: 1; border: 0; outline: 0; font: inherit; font-size: 16px; background: transparent; min-width: 0; }
    .actions { grid-area: actions; display: flex; align-items: center; gap: t.$space; justify-self: end; }
    .user { font-size: 14px; white-space: nowrap; }
    .cartLink { color: inherit; }
    .badgeHost { position: relative; display: inline-flex; }
    .badge { @include m.cart-badge; }
  `,
})
export class HeaderComponent {
  protected readonly cart = inject(CartStore);
  protected readonly session = inject(SessionStore);
  private readonly open = injectOpenListing();
  protected readonly text = signal("");

  protected submit(e: Event) {
    e.preventDefault();
    this.open({ search: this.text() });
  }
}
