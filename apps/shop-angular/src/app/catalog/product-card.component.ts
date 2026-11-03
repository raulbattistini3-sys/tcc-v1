import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { formatPrice } from "@shared/catalog.js";
import type { Product } from "@shared/catalog.js";
import { productImage } from "@shared/product-image.js";
import { CartStore } from "../stores/cart.store";
import { SessionStore } from "../stores/session.store";
import { IconComponent } from "../icon.component";

// OnPush + `track row.id`: the Angular equivalent of React.memo on ProductCard.
@Component({
  selector: "shop-product-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatCardModule, IconComponent],
  template: `
    @let p = product();
    <mat-card appearance="outlined">
      <img mat-card-image [src]="image()" alt="" loading="lazy" height="120" />
      <mat-card-content>
        <div class="cat">{{ p.categoria }}</div>
        <div class="name">{{ p.name }}</div>
        <div class="price">{{ price() }}</div>
        <div class="stock" [class.out]="p.stock <= 0">{{ p.stock > 0 ? p.stock + " em estoque" : "Esgotado" }}</div>
      </mat-card-content>
      @if (session.signedIn()) {
        <mat-card-actions>
          <button matButton [disabled]="p.stock <= 0" (click)="cart.add(p)"><shop-icon name="add_shopping_cart" [size]="18" /> Adicionar</button>
        </mat-card-actions>
      }
    </mat-card>
  `,
  styleUrl: "./product-card.component.scss",
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  protected readonly cart = inject(CartStore);
  protected readonly session = inject(SessionStore);
  protected readonly image = computed(() => productImage(this.product().categoria, this.product().index));
  protected readonly price = computed(() => formatPrice(this.product().price));
}
