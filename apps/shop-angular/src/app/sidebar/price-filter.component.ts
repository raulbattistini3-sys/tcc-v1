import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { MatSliderModule } from "@angular/material/slider";
import { formatPrice } from "@shared/catalog.js";
import { CatalogStore } from "../stores/catalog.store";

const MAX = 5000;

// The thumbs move locally (valueChange); the query is committed once, on release
// (the native change event), like MUI's onChangeCommitted.
@Component({
  selector: "shop-price-filter",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatSliderModule],
  template: `
    <label class="label">Preço: {{ fmt(lo()) }} – {{ hi() >= max ? "sem limite" : fmt(hi()) }}</label>
    <mat-slider [min]="0" [max]="max" [step]="50">
      <input matSliderStartThumb aria-label="Preço mínimo" [value]="lo()" (valueChange)="lo.set($event)" (change)="commit()" />
      <input matSliderEndThumb aria-label="Preço máximo" [value]="hi()" (valueChange)="hi.set($event)" (change)="commit()" />
    </mat-slider>
  `,
  styles: `
    :host { display: flex; flex-direction: column; }
    .label { opacity: 0.7; }
    mat-slider { width: 100%; margin: 0; }
  `,
})
export class PriceFilterComponent {
  private readonly store = inject(CatalogStore);
  protected readonly max = MAX;
  protected readonly lo = signal(0);
  protected readonly hi = signal(MAX);
  protected readonly fmt = formatPrice;

  protected commit() {
    this.store.setPrice([this.lo() > 0 ? this.lo() : null, this.hi() < MAX ? this.hi() : null]);
  }
}
