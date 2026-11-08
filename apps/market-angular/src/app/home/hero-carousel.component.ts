import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { MatButton } from "@angular/material/button";
import { BANNERS, BANNER_INTERVAL_MS } from "@shared/market.js";
import { injectOpenListing } from "../market";

/** Rotating banners: one signal write every BANNER_INTERVAL_MS, the slide moved by a CSS transition. */
@Component({
  selector: "mk-hero-carousel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    <section class="hero" aria-roledescription="carrossel" aria-label="Destaques">
      <div class="track" [style.transform]="'translateX(' + -i() * 100 + '%)'">
        @for (b of banners; track b.id; let k = $index) {
          <div class="slide" [style.background]="'linear-gradient(120deg, ' + b.from + ', ' + b.to + ')'" [attr.aria-hidden]="k !== i()">
            <h2 class="heroTitle">{{ b.title }}</h2>
            <p>{{ b.subtitle }}</p>
            <button matButton="filled" class="heroCta" [attr.tabindex]="k === i() ? 0 : -1" (click)="open({ categories: [b.category] })">{{ b.cta }}</button>
          </div>
        }
      </div>
      <div class="dots">
        @for (b of banners; track b.id; let k = $index) {
          <button class="dot" [attr.aria-current]="k === i()" [attr.aria-label]="'Destaque ' + (k + 1)" (click)="i.set(k)"></button>
        }
      </div>
    </section>
  `,
  styles: `
    @use "tokens" as t;
    @use "market" as m;
    .hero { @include m.hero; }
    .track { @include m.hero-track; }
    .slide { @include m.hero-slide; }
    .heroTitle { @include m.hero-title; }
    .heroCta { align-self: flex-start; --mat-button-filled-container-color: #{t.$accent}; --mat-button-filled-label-text-color: #1b1f24; }
    .dots { @include m.hero-dots; }
    .dot { @include m.hero-dot; }
  `,
})
export class HeroCarouselComponent {
  protected readonly banners = BANNERS;
  protected readonly i = signal(0);
  protected readonly open = injectOpenListing();

  constructor() {
    const t = setInterval(() => this.i.update((k) => (k + 1) % BANNERS.length), BANNER_INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }
}
