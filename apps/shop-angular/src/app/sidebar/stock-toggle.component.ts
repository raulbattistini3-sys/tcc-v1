import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { CatalogStore } from "../stores/catalog.store";

@Component({
  selector: "shop-stock-toggle",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatSlideToggleModule],
  template: `<mat-slide-toggle [checked]="store.query().inStock" (change)="store.setInStock($event.checked)">Somente em estoque</mat-slide-toggle>`,
})
export class StockToggleComponent {
  protected readonly store = inject(CatalogStore);
}
