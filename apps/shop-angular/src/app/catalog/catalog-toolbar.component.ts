import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { MatButtonToggleModule } from "@angular/material/button-toggle";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { DecimalPipe } from "@angular/common";
import { SORT_OPTIONS } from "@shared/columns.js";
import { CatalogStore } from "../stores/catalog.store";
import { UiStore } from "../stores/ui.store";
import { IconComponent } from "../icon.component";
import type { ProductTable } from "./product-catalog.component";

@Component({
  selector: "shop-catalog-toolbar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonToggleModule, MatFormFieldModule, MatSelectModule, DecimalPipe, IconComponent],
  template: `
    <span data-testid="total">{{ total() | number: "1.0-0" : "pt-BR" }} produtos</span>
    <span class="spacer"></span>
    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sort">
      <mat-label>Ordenar por</mat-label>
      <mat-select [value]="current()" (valueChange)="table().setSorting(options[$event].sorting)">
        @for (o of options; track o.label; let i = $index) {
          <mat-option [value]="i">{{ o.label }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
    @if (showViewToggle()) {
      <mat-button-toggle-group [value]="ui.view()" (change)="ui.setView($event.value)" aria-label="Visualização" hideSingleSelectionIndicator>
        <mat-button-toggle value="grid" aria-label="Grade" data-testid="view-grid"><shop-icon name="grid_view" [size]="20" /></mat-button-toggle>
        <mat-button-toggle value="table" aria-label="Tabela" data-testid="view-table"><shop-icon name="table_rows" [size]="20" /></mat-button-toggle>
      </mat-button-toggle-group>
    }
  `,
  styles: `
    @use "tokens" as t;
    :host { display: flex; align-items: center; gap: t.$space * 2; flex-wrap: wrap; margin-bottom: t.$space; font-size: 14px; }
    .spacer { flex: 1; }
    .sort { width: 180px; }
  `,
})
export class CatalogToolbarComponent {
  readonly table = input.required<ProductTable>();
  readonly showViewToggle = input(true);
  protected readonly store = inject(CatalogStore);
  protected readonly ui = inject(UiStore);
  protected readonly options = SORT_OPTIONS;
  protected readonly total = computed(() => this.store.result()?.total ?? 0);
  protected readonly current = computed(() => {
    const s = JSON.stringify(this.table().atoms.sorting.get());
    return Math.max(0, SORT_OPTIONS.findIndex((o) => JSON.stringify(o.sorting) === s));
  });
}
