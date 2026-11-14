import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { MatCheckbox } from "@angular/material/checkbox";
import { MatSlideToggle } from "@angular/material/slide-toggle";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInput } from "@angular/material/input";
import { MatButton } from "@angular/material/button";
import { categoryLabel } from "@shared/market.js";
import { CATALOG } from "../tokens";
import { CatalogStore } from "../stores/catalog.store";
import { injectMirrorUrl } from "../market";

const toNum = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** Each control calls a store method (which runs the query), then mirrors the URL. */
@Component({
  selector: "mk-filter-sidebar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatCheckbox, MatSlideToggle, MatFormFieldModule, MatInput, MatButton],
  template: `
    <aside class="filters" aria-label="Filtros">
      <mat-card appearance="outlined">
        <mat-card-content>
          <h3 class="filterTitle">Categorias</h3>
          @for (c of categories; track c) {
            <div>
              <mat-checkbox [checked]="store.query().categories.includes(c)" (change)="toggle(c)">{{ label(c) }}</mat-checkbox>
            </div>
          }
        </mat-card-content>
      </mat-card>
      <mat-card appearance="outlined">
        <mat-card-content>
          <h3 class="filterTitle">Preço</h3>
          <form class="priceRow" (submit)="applyPrice($event)">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Mínimo</mat-label>
              <input matInput inputmode="decimal" [value]="min()" (input)="min.set($any($event.target).value)" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Máximo</mat-label>
              <input matInput inputmode="decimal" [value]="max()" (input)="max.set($any($event.target).value)" />
            </mat-form-field>
            <button matButton="outlined" type="submit">Ok</button>
          </form>
        </mat-card-content>
      </mat-card>
      <mat-card appearance="outlined">
        <mat-card-content>
          <mat-slide-toggle [checked]="store.query().inStock" (change)="setInStock($event.checked)">Somente em estoque</mat-slide-toggle>
        </mat-card-content>
      </mat-card>
      <button matButton (click)="clear()">Limpar filtros</button>
    </aside>
  `,
  styles: `
    @use "tokens" as t;
    @use "market" as m;
    .filters { @include m.filters; }
    .filterTitle { font-size: 14px; font-weight: 600; margin: 0 0 t.$space; }
    .priceRow { @include m.price-row; }
  `,
})
export class FilterSidebarComponent {
  protected readonly store = inject(CatalogStore);
  protected readonly categories = inject(CATALOG).categories;
  protected readonly label = categoryLabel;
  private readonly mirror = injectMirrorUrl();
  protected readonly min = signal(this.store.query().price[0]?.toString() ?? "");
  protected readonly max = signal(this.store.query().price[1]?.toString() ?? "");

  protected toggle(c: string) {
    this.store.toggleCategory(c);
    this.mirror();
  }
  protected applyPrice(e: Event) {
    e.preventDefault();
    this.store.setPrice([toNum(this.min()), toNum(this.max())]);
    this.mirror();
  }
  protected setInStock(on: boolean) {
    this.store.setInStock(on);
    this.mirror();
  }
  protected clear() {
    this.min.set("");
    this.max.set("");
    this.store.clearFilters();
    this.mirror();
  }
}
