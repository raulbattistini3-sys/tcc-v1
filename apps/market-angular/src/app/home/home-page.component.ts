import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { DEALS_SPEC, NEWEST_SPEC } from "@shared/market.js";
import { CATALOG, CONDITIONS } from "../tokens";
import { channelProducts } from "../market";
import { SessionStore } from "../stores/session.store";
import { HeroCarouselComponent } from "./hero-carousel.component";
import { CategoryTilesComponent } from "./category-tiles.component";
import { ProductRailComponent } from "../product/product-rail.component";

const RAIL = 12;

/**
 * The page the main thread has to paint and keep interactive while the worker answers the rails'
 * queries: hero, tiles and three rails of cards with images (as market-react's HomePage).
 */
@Component({
  selector: "mk-home-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroCarouselComponent, CategoryTilesComponent, ProductRailComponent],
  template: `
    <mk-hero-carousel />
    <mk-product-rail title="Ofertas do dia" [products]="deals()" testId="rail-deals" />
    @if (session.signedIn()) {
      <mk-product-rail title="Recomendados para você" [products]="recommended" [autoplay]="carousel" testId="rail-recommended" />
    }
    <mk-category-tiles />
    <mk-product-rail title="Novidades" [products]="newest()" testId="rail-newest" />
  `,
})
export class HomePageComponent {
  protected readonly session = inject(SessionStore);
  protected readonly carousel = inject(CONDITIONS).carousel;
  protected readonly recommended = inject(CATALOG).recommendations(RAIL);
  protected readonly deals = channelProducts(() => DEALS_SPEC, "home:deals", RAIL);
  protected readonly newest = channelProducts(() => NEWEST_SPEC, "home:newest", RAIL);
}
