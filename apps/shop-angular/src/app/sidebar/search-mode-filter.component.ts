// Substring scan vs inverted index (see src/compute/text-index.js).
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatRadioModule } from "@angular/material/radio";
import { SEARCH_MODES } from "@shared/catalog.js";
import { CatalogStore } from "../stores/catalog.store";

@Component({
  selector: "shop-search-mode-filter",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatRadioModule],
  template: `
    <label id="search-mode-label" class="label">Busca por</label>
    <mat-radio-group aria-labelledby="search-mode-label" [value]="store.query().searchMode" (change)="store.setSearchMode($event.value)">
      @for (m of modes; track m.value) {
        <mat-radio-button [value]="m.value" [attr.data-testid]="'search-mode-' + m.value">{{ m.label }}</mat-radio-button>
      }
    </mat-radio-group>
  `,
  styles: `
    :host { display: flex; flex-direction: column; }
    .label { opacity: 0.7; }
    mat-radio-group { display: flex; flex-direction: column; }
  `,
})
export class SearchModeFilterComponent {
  protected readonly store = inject(CatalogStore);
  protected readonly modes = SEARCH_MODES;
}
