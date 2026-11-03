// "Recomendados para você", same as the React component: with autoplay a rAF
// loop moves the track every frame by writing the DOM directly, with no
// signal write per frame. It runs outside the Angular zone, so in the zone.js
// build the carousel doesn't trigger change detection 60 times a second. The
// zone vs zoneless difference measured is then only worker messages and events.
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, input, viewChild } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { formatPrice } from "@shared/catalog.js";
import { productImage } from "@shared/product-image.js";
import { CATALOG } from "../tokens";

const SPEED_PX_PER_MS = 0.05;

@Component({
  selector: "shop-recommendations",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule],
  template: `
    <h2>Recomendados para você</h2>
    <div class="viewport">
      <div class="track" #track>
        @for (p of loop; track $index) {
          <mat-card appearance="outlined" class="item">
            <img [src]="img(p.categoria, p.index)" alt="" height="80" />
            <div class="body">
              <div class="name">{{ p.name }}</div>
              <div class="price">{{ fmt(p.price) }}</div>
            </div>
          </mat-card>
        }
      </div>
    </div>
  `,
  styleUrl: "./recommendations.component.scss",
})
export class RecommendationsComponent {
  readonly autoplay = input(false);
  private readonly items = inject(CATALOG).recommendations(12);
  protected loop = this.items;
  protected readonly img = productImage;
  protected readonly fmt = formatPrice;
  private readonly track = viewChild.required<ElementRef<HTMLDivElement>>("track");

  constructor() {
    const zone = inject(NgZone);
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (!this.autoplay()) return;
      const el = this.track().nativeElement;
      let raf = 0;
      let last = performance.now();
      let x = 0;
      const frame = (t: number) => {
        x = (x + (t - last) * SPEED_PX_PER_MS) % (el.scrollWidth / 2);
        last = t;
        el.style.transform = `translateX(${-x}px)`;
        raf = requestAnimationFrame(frame);
      };
      zone.runOutsideAngular(() => (raf = requestAnimationFrame(frame)));
      destroy.onDestroy(() => cancelAnimationFrame(raf));
    });
  }

  ngOnInit() {
    // Doubled list, so the loop wraps without a jump (React does the same).
    if (this.autoplay()) this.loop = [...this.items, ...this.items];
  }
}
