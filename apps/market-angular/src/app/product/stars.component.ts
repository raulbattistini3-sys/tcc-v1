import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

const count = new Intl.NumberFormat("pt-BR");

/** Five stars filled to the rating, and the review count (drawn the same way in the React app). */
@Component({
  selector: "mk-stars",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="stars" [attr.aria-label]="label()">
      <span class="glyphs"><span class="fill" [style.width.%]="(rating() / 5) * 100"></span></span>
      {{ rating().toFixed(1) }} ({{ reviewsText() }})
    </span>
  `,
  styles: `
    @use "market" as m;
    .stars { @include m.stars; }
    .glyphs { @include m.stars-glyphs; }
    .fill { @include m.stars-fill; }
  `,
})
export class StarsComponent {
  readonly rating = input.required<number>();
  readonly reviews = input.required<number>();
  protected readonly reviewsText = computed(() => count.format(this.reviews()));
  protected readonly label = computed(() => `Nota ${this.rating()} de 5, ${this.reviews()} avaliações`);
}
