import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { MatButton, MatIconButton } from "@angular/material/button";
import { MatDivider } from "@angular/material/divider";
import { map } from "rxjs";
import { formatPrice } from "@shared/catalog.js";
import { categoryLabel, installmentText, marketDetails, productDescription, relatedSpec } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { CATALOG } from "../tokens";
import { CartStore } from "../stores/cart.store";
import { UiStore } from "../stores/session.store";
import { channelProducts, injectOpenListing } from "../market";
import { StarsComponent } from "../product/stars.component";
import { ProductRailComponent } from "../product/product-rail.component";
import { IconComponent } from "../icon.component";
import { NotFoundComponent } from "./not-found.component";

@Component({
  selector: "mk-product-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButton, MatIconButton, MatDivider, StarsComponent, ProductRailComponent, IconComponent, NotFoundComponent],
  template: `
    @if (product(); as p) {
      <nav class="crumbs" aria-label="Navegação">
        <a routerLink="/">Início</a>
        <span>/</span>
        <button matButton (click)="open({ categories: [p.categoria] })">{{ label(p.categoria) }}</button>
      </nav>
      <article class="product" data-testid="product-page">
        <div class="gallery">
          <div class="thumbs">
            @for (src of images(); track $index; let k = $index) {
              <img class="thumb" [src]="src" alt="" [attr.aria-current]="k === shot()" (click)="shot.set(k)" />
            }
          </div>
          <img class="main" [src]="images()[shot()]" [alt]="p.name" />
        </div>
        <div class="buy">
          <h1 class="name">{{ p.name }}</h1>
          <div class="meta">Código {{ p.sku }} · {{ p.stock > 0 ? p.stock + " em estoque" : "sem estoque" }}</div>
          <mk-stars [rating]="details().rating" [reviews]="details().reviews" />
          <mat-divider />
          <div class="listPrice">{{ listPrice() }}</div>
          <div>
            <span class="price">{{ fmt(p.price) }}</span>
            @if (details().discountPct > 0) {
              <span class="discount">{{ details().discountPct }}% OFF</span>
            }
          </div>
          <div class="installments">{{ installments() }}</div>
          @if (details().freeShipping) {
            <div class="shipping">Frete grátis para todo o Brasil</div>
          }
          <div class="qty">
            Quantidade:
            <button matIconButton aria-label="Diminuir" [disabled]="qty() <= 1" (click)="qty.update((q) => q - 1)"><mk-icon name="remove" [size]="20" /></button>
            <span data-testid="qty">{{ qty() }}</span>
            <button matIconButton aria-label="Aumentar" [disabled]="qty() >= maxQty()" (click)="qty.update((q) => q + 1)"><mk-icon name="add" [size]="20" /></button>
          </div>
          <div class="actions">
            <button matButton="filled" [disabled]="p.stock <= 0" (click)="buyNow()">Comprar agora</button>
            <button matButton="outlined" [disabled]="p.stock <= 0" (click)="addToCart()">Adicionar ao carrinho</button>
          </div>
          <p class="description">{{ description() }}</p>
        </div>
      </article>
      <mk-product-rail [title]="'Mais em ' + label(p.categoria)" [products]="related()" testId="rail-related" />
    } @else {
      <mk-not-found />
    }
  `,
  styles: `
    @use "tokens" as t;
    @use "market" as m;
    .crumbs { display: flex; align-items: center; gap: t.$space; }
    .product { @include m.product-page; }
    .gallery { @include m.gallery; }
    .thumbs { @include m.gallery-thumbs; }
    .thumb { @include m.gallery-thumb; }
    .main { @include m.gallery-main; }
    .buy { @include m.buy-box; }
    .name { font-size: 24px; font-weight: 600; margin: 0; }
    .meta { @include m.status-line; }
    .listPrice { @include m.list-price; }
    .price { @include m.price; font-size: 32px; }
    .discount { @include m.discount; }
    .installments { @include m.installments; font-size: 14px; }
    .shipping { @include m.shipping; font-size: 14px; }
    .qty { @include m.qty; }
    .actions { display: flex; flex-wrap: wrap; gap: t.$space; }
    .description { line-height: 1.6; color: #343a40; }
  `,
})
export class ProductPageComponent {
  private readonly catalog = inject(CATALOG);
  private readonly cart = inject(CartStore);
  private readonly ui = inject(UiStore);
  private readonly router = inject(Router);
  protected readonly open = injectOpenListing();
  protected readonly label = categoryLabel;
  protected readonly fmt = formatPrice;

  private readonly index = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => Number(p.get("index")))), { initialValue: NaN });
  protected readonly product = computed(() => {
    const i = this.index();
    return Number.isInteger(i) && i >= 0 && i < this.catalog.rows ? this.catalog.productAt(i) : null;
  });
  protected readonly details = computed(() => marketDetails(this.product()!));
  protected readonly listPrice = computed(() => {
    const lp = this.details().listPrice;
    return lp !== null ? formatPrice(lp) : "";
  });
  protected readonly installments = computed(() => installmentText(this.details().installments));
  protected readonly description = computed(() => productDescription(this.product()!));
  protected readonly images = computed(() => {
    const p = this.product()!;
    return [0, 1, 2, 3].map((k) => productImage(p.categoria, p.index + k));
  });
  protected readonly maxQty = computed(() => Math.max(1, this.product()?.stock ?? 1));
  protected readonly qty = signal(1);
  protected readonly shot = signal(0);
  // same category, cheapest first, on the "related" channel (market-react: useChannelProducts)
  private readonly spec = computed(() => (this.product() ? relatedSpec(this.product()!) : null));
  protected readonly related = channelProducts(() => this.spec() ?? { filters: [], limit: 0 }, "related", 12, () => this.index());

  constructor() {
    // a new product resets the quantity and the picture (React: a key per product)
    effect(() => {
      this.index();
      untracked(() => {
        this.qty.set(1);
        this.shot.set(0);
      });
    });
  }

  protected addToCart() {
    this.cart.add(this.product()!, this.qty());
    this.ui.showToast("Adicionado ao carrinho");
  }
  protected buyNow() {
    this.cart.add(this.product()!, this.qty());
    void this.router.navigate(["/carrinho"]);
  }
}
