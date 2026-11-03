import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { formatPrice } from "@shared/catalog.js";
import { CartStore } from "../stores/cart.store";
import { UiStore } from "../stores/ui.store";
import { IconComponent } from "../icon.component";

// Rendered inside a mat-sidenav (position end, mode over). Lines only exist while it is open.
@Component({
  selector: "shop-cart-drawer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, IconComponent],
  template: `
    <div class="head">
      <h2>Carrinho</h2>
      <button matIconButton (click)="ui.setCartOpen(false)" aria-label="Fechar carrinho"><shop-icon name="close" /></button>
    </div>
    @if (cart.lines().length === 0) {
      <p class="muted">Seu carrinho está vazio.</p>
    } @else {
      <ul>
        @for (l of cart.lines(); track l.index) {
          <li>
            <div class="text">
              <div>{{ l.name }}</div>
              <div class="muted">{{ l.sku }} · {{ fmt(l.price) }}</div>
            </div>
            <input type="number" min="0" [value]="l.qty" (change)="cart.setQty(l.index, +$any($event.target).value)" [attr.aria-label]="'Quantidade de ' + l.name" />
            <button matIconButton (click)="cart.remove(l.index)" [attr.aria-label]="'Remover ' + l.name"><shop-icon name="delete" [size]="20" /></button>
          </li>
        }
      </ul>
      <p class="subtotal">Subtotal: {{ fmt(cart.subtotal()) }}</p>
      <div class="actions">
        <button matButton="filled" disabled>Finalizar compra</button>
        <button matButton (click)="cart.clear()">Esvaziar</button>
      </div>
    }
  `,
  styles: `
    @use "tokens" as t;
    :host { display: flex; flex-direction: column; gap: t.$space * 2; width: 360px; padding: t.$space * 2; box-sizing: border-box; height: 100%; }
    .head { display: flex; align-items: center; justify-content: space-between; }
    h2 { margin: 0; font-size: 20px; font-weight: 500; }
    ul { list-style: none; margin: 0; padding: 0; flex: 1; overflow-y: auto; }
    li { display: flex; align-items: center; gap: t.$space; padding: t.$space 0; font-size: 14px; }
    .text { flex: 1; min-width: 0; }
    input { width: 56px; padding: 6px; font: inherit; }
    .muted { opacity: 0.7; font-size: 12px; }
    .subtotal { font-weight: 500; margin: 0; }
    .actions { display: flex; gap: t.$space; }
  `,
})
export class CartDrawerComponent {
  protected readonly cart = inject(CartStore);
  protected readonly ui = inject(UiStore);
  protected readonly fmt = formatPrice;
}
