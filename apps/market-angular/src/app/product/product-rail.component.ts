import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, effect, inject, input, viewChild } from "@angular/core";
import type { Product } from "@shared/catalog.js";
import { ProductCardComponent } from "./product-card.component";

const SPEED_PX_PER_MS = 0.05;

/**
 * A titled row of cards. `autoplay` moves it every frame (doubled list, rAF writing the transform,
 * outside the zone), the "carousel" condition of the experiments, as market-react's useCarousel does.
 */
@Component({
  selector: "mk-product-rail",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProductCardComponent],
  host: { "[attr.data-testid]": "testId()" },
  template: `
    <h2 class="title">{{ title() }}</h2>
    @if (products(); as list) {
      @if (autoplay()) {
        <div class="viewport">
          <div class="track" #track>
            @for (p of doubled(); track $index) {
              <mk-product-card [product]="p" />
            }
          </div>
        </div>
      } @else {
        <div class="rail">
          @for (p of list; track p.index) {
            <mk-product-card [product]="p" />
          }
        </div>
      }
    } @else {
      <div class="placeholder" aria-busy="true"></div>
    }
  `,
  styles: `
    @use "market" as m;
    :host { display: block; }
    .title { @include m.section-title; }
    .rail { @include m.rail; }
    .viewport { @include m.rail-autoplay-viewport; }
    .track { display: flex; gap: 16px; will-change: transform; }
    .track > * { flex: 0 0 200px; }
    .placeholder { height: 392px; }
  `,
})
export class ProductRailComponent {
  readonly title = input.required<string>();
  readonly products = input.required<Product[] | null>();
  readonly autoplay = input(false);
  readonly testId = input<string | null>(null);
  protected readonly doubled = computed(() => {
    const list = this.products() ?? [];
    return [...list, ...list];
  });
  private readonly track = viewChild<ElementRef<HTMLDivElement>>("track");

  constructor() {
    const zone = inject(NgZone);
    let raf = 0;
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(raf));
    effect(() => {
      const el = this.track()?.nativeElement;
      cancelAnimationFrame(raf);
      if (!el) return;
      let last = performance.now();
      let x = 0;
      const frame = (t: number) => {
        x = (x + (t - last) * SPEED_PX_PER_MS) % (el.scrollWidth / 2);
        last = t;
        el.style.transform = `translateX(${-x}px)`;
        raf = requestAnimationFrame(frame);
      };
      zone.runOutsideAngular(() => (raf = requestAnimationFrame(frame)));
    });
  }
}
