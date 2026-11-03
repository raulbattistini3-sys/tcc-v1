import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { CategoryFacetComponent } from "./category-facet.component";
import { PriceFilterComponent } from "./price-filter.component";
import { StockToggleComponent } from "./stock-toggle.component";
import { CatalogStore } from "../stores/catalog.store";

@Component({
  selector: "shop-filter-sidebar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, CategoryFacetComponent, PriceFilterComponent, StockToggleComponent],
  template: `
    <nav aria-label="Filtros">
      <h2>Filtros</h2>
      <shop-category-facet />
      <shop-price-filter />
      <shop-stock-toggle />
      <button matButton (click)="store.clearFilters()">Limpar filtros</button>
    </nav>
  `,
  styles: `
    @use "tokens" as t;
    nav { display: flex; flex-direction: column; gap: t.$space * 3; }
    h2 { font-size: 16px; font-weight: 600; margin: 0; }
  `,
})
export class FilterSidebarComponent {
  protected readonly store = inject(CatalogStore);
}
