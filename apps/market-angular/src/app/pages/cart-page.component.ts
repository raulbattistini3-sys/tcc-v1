import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatCardModule } from "@angular/material/card";
import { MatButton, MatIconButton } from "@angular/material/button";
import { MatDivider } from "@angular/material/divider";
import { formatPrice } from "@shared/catalog.js";
import { FREE_SHIPPING_FROM } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { CartStore } from "../stores/cart.store";
import { IconComponent } from "../icon.component";

const SHIPPING = 19.9;

@Component({
  selector: "mk-cart-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatCardModule, MatButton, MatIconButton, MatDivider, IconComponent],
  template: `
    @if (cart.lines().length === 0) {
      <div class="empty" data-testid="cart-empty">
        <p>Seu carrinho está vazio.</p>
        <a matButton="filled" routerLink="/">Ver ofertas</a>
      </div>
    } @else {
      <h1 class="heading">Carrinho</h1>
      <div class="cart">
        <mat-card appearance="outlined">
          <mat-card-content>
            @for (l of cart.lines(); track l.index) {
              <div class="line" data-testid="cart-line">
                <img class="lineImage" [src]="img(l.categoria, l.index)" alt="" />
                <div>
                  <a [routerLink]="['/produto', l.index]" class="lineName">{{ l.name }}</a>
                  <div>{{ fmt(l.price) }}</div>
                </div>
                <div class="qty">
                  <button matIconButton aria-label="Diminuir" (click)="cart.setQty(l.index, l.qty - 1)"><mk-icon name="remove" [size]="20" /></button>
                  {{ l.qty }}
                  <button matIconButton aria-label="Aumentar" (click)="cart.setQty(l.index, l.qty + 1)"><mk-icon name="add" [size]="20" /></button>
                </div>
                <button matIconButton aria-label="Remover" (click)="cart.remove(l.index)"><mk-icon name="delete" /></button>
              </div>
            }
            <button matButton (click)="cart.clear()">Esvaziar carrinho</button>
          </mat-card-content>
        </mat-card>
        <mat-card appearance="outlined">
          <mat-card-content>
            <div class="summaryRow"><span>Produtos</span><span>{{ fmt(cart.subtotal()) }}</span></div>
            <div class="summaryRow"><span>Frete</span><span>{{ shipping() === 0 ? "Grátis" : fmt(shipping()) }}</span></div>
            <mat-divider />
            <div class="summaryRow total"><span>Total</span><span data-testid="cart-total">{{ fmt(cart.subtotal() + shipping()) }}</span></div>
            <button matButton="filled" class="checkout" disabled title="Loja fictícia: não há pagamento">Finalizar compra</button>
          </mat-card-content>
        </mat-card>
      </div>
    }
  `,
  styles: `
    @use "tokens" as t;
    @use "market" as m;
    .cart { @include m.cart; }
    .line { @include m.cart-line; }
    .lineImage { width: 80px; height: 60px; object-fit: cover; border-radius: 6px; }
    .lineName { font-size: 14px; }
    .qty { @include m.qty; }
    .summaryRow { display: flex; justify-content: space-between; margin: t.$space 0; }
    .total { font-size: 20px; font-weight: 600; }
    .checkout { width: 100%; }
    .empty { padding: t.$space * 6 0; text-align: center; color: m.$muted; }
    .heading { font-size: 22px; font-weight: 600; margin: 0 0 t.$space * 2; }
  `,
})
export class CartPageComponent {
  protected readonly cart = inject(CartStore);
  protected readonly fmt = formatPrice;
  protected readonly img = productImage;
  protected readonly shipping = computed(() => {
    const s = this.cart.subtotal();
    return s === 0 || s >= FREE_SHIPPING_FROM ? 0 : SHIPPING;
  });
}
