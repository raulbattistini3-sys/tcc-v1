import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatBadgeModule } from "@angular/material/badge";
import { MatButtonModule } from "@angular/material/button";
import { IconComponent } from "../icon.component";
import { CartStore } from "../stores/cart.store";
import { UiStore } from "../stores/ui.store";

// Reads the `count` computed, not the lines (same as the selectCount selector in React).
@Component({
  selector: "shop-cart-button",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatBadgeModule, MatButtonModule, IconComponent],
  template: `
    <button matIconButton (click)="ui.setCartOpen(true)" [attr.aria-label]="'Carrinho, ' + cart.count() + ' itens'">
      <shop-icon name="shopping_cart" [matBadge]="cart.count()" [matBadgeHidden]="cart.count() === 0" />
    </button>
  `,
  styles: `button { color: inherit; }`,
})
export class CartButtonComponent {
  protected readonly cart = inject(CartStore);
  protected readonly ui = inject(UiStore);
}
