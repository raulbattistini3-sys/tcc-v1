import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { CatalogStore } from "../stores/catalog.store";
import { CATALOG } from "../tokens";

@Component({
  selector: "shop-category-facet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckboxModule],
  template: `
    <fieldset>
      <legend>Categoria</legend>
      @for (c of categories; track c) {
        <mat-checkbox [checked]="store.query().categories.includes(c)" (change)="store.toggleCategory(c)">{{ c }}</mat-checkbox>
      }
    </fieldset>
  `,
  styles: `
    fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; }
    legend { opacity: 0.7; margin-bottom: 4px; }
  `,
})
export class CategoryFacetComponent {
  protected readonly store = inject(CatalogStore);
  protected readonly categories = inject(CATALOG).categories;
}
