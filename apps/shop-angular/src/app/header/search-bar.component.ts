import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { IconComponent } from "../icon.component";
import { CatalogStore } from "../stores/catalog.store";

// Bound to `searchInput`, so a keystroke only updates this view. The debounced
// commit (RxJS), the scheduler run and the table update happen in the store.
@Component({
  selector: "shop-search-bar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <label class="search">
      <shop-icon name="search" [size]="20" />
      <input
        placeholder="Buscar produtos…"
        aria-label="Buscar produtos"
        data-testid="search"
        [value]="store.searchInput()"
        (input)="store.setSearchInput($any($event.target).value)"
      />
    </label>
  `,
  styleUrl: "./search-bar.component.scss",
})
export class SearchBarComponent {
  protected readonly store = inject(CatalogStore);
}
