import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatCardModule } from "@angular/material/card";
import { MatButton } from "@angular/material/button";
import { MatRipple } from "@angular/material/core";
import { formatPrice, type Product } from "@shared/catalog.js";
import { installmentText, marketDetails } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { CartStore } from "../stores/cart.store";
import { UiStore } from "../stores/session.store";
import { StarsComponent } from "./stars.component";

/**
 * One product. OnPush + `track product.index` in the lists: a new result re-renders only the cards
 * whose product changed (React: memo). The anchor with matRipple is the counterpart of MUI's
 * CardActionArea (which ripples too).
 */
@Component({
  selector: "mk-product-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButton, MatRipple, RouterLink, StarsComponent],
  host: { "data-testid": "product-card" },
  template: `
    <mat-card appearance="outlined" class="card">
      <a class="area" matRipple [routerLink]="['/produto', product().index]">
        <img class="image" [src]="image()" alt="" width="200" height="150" loading="lazy" decoding="async" />
        <div class="body">
          <div class="name">{{ product().name }}</div>
          <div class="listPrice">{{ listPrice() }}</div>
          <div>
            <span class="price">{{ price() }}</span>
            @if (details().discountPct > 0) {
              <span class="discount">{{ details().discountPct }}% OFF</span>
            }
          </div>
          <div class="installments">{{ installments() }}</div>
          <div class="shipping">{{ details().freeShipping ? "Frete grátis" : " " }}</div>
          <mk-stars [rating]="details().rating" [reviews]="details().reviews" />
        </div>
      </a>
      <mat-card-actions>
        <button matButton [disabled]="product().stock <= 0" (click)="add()">{{ product().stock > 0 ? "Adicionar ao carrinho" : "Sem estoque" }}</button>
      </mat-card-actions>
    </mat-card>
  `,
  styles: `
    @use "market" as m;
    :host { display: block; min-width: 0; }
    .card { @include m.card; }
    .area { flex: 1; display: flex; flex-direction: column; color: inherit; text-decoration: none; position: relative; overflow: hidden; }
    .image { @include m.card-image; }
    .body { @include m.card-body; }
    .name { @include m.card-name; }
    .listPrice { @include m.list-price; }
    .price { @include m.price; }
    .discount { @include m.discount; }
    .installments { @include m.installments; }
    .shipping { @include m.shipping; }
  `,
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  private readonly cart = inject(CartStore);
  private readonly ui = inject(UiStore);
  protected readonly details = computed(() => marketDetails(this.product()));
  protected readonly image = computed(() => productImage(this.product().categoria, this.product().index));
  protected readonly price = computed(() => formatPrice(this.product().price));
  protected readonly listPrice = computed(() => {
    const lp = this.details().listPrice;
    return lp !== null ? formatPrice(lp) : "";
  });
  protected readonly installments = computed(() => installmentText(this.details().installments));

  protected add() {
    this.cart.add(this.product());
    this.ui.showToast("Adicionado ao carrinho");
  }
}
