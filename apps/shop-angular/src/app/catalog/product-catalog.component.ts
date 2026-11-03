// Owns the one TanStack Table instance; both views render from
// table.getRowModel(). Same "manual" setup as the React shop: the scheduler
// computes filter/sort over the columnar rows, and TanStack holds UI state and
// the 48 row objects of the visible page.
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, computed, effect, inject, input } from "@angular/core";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { injectTable, rowPaginationFeature, rowSortingFeature, tableFeatures } from "@tanstack/angular-table";
import type { ColumnDef } from "@tanstack/angular-table";
import { COLUMNS } from "@shared/columns.js";
import { markPainted } from "@shared/harness.js";
import type { Product } from "@shared/catalog.js";
import { CatalogStore } from "../stores/catalog.store";
import { UiStore } from "../stores/ui.store";
import { CATALOG } from "../tokens";
import { CatalogToolbarComponent } from "./catalog-toolbar.component";
import { ProductGridViewComponent } from "./product-grid-view.component";
import { ProductTableViewComponent } from "./product-table-view.component";
import { PagerComponent } from "./pager.component";

export const features = tableFeatures({ rowSortingFeature, rowPaginationFeature });

const columns: ColumnDef<typeof features, Product, any>[] = COLUMNS.map((m) => ({
  id: m.id,
  accessorFn: (p: Product) => p[m.id],
  header: m.header,
  cell: (info: any) => m.format(info.row.original),
  enableSorting: m.sortable,
  meta: { align: m.align },
}));

export type ProductTable = ReturnType<typeof createProductTable>;

function createProductTable() {
  const store = inject(CatalogStore);
  const catalog = inject(CATALOG);
  // Only the visible page becomes JS objects (React: useMemo with the same deps).
  const data = computed(() => {
    const r = store.result();
    return r ? catalog.page(r.indices, store.pageIndex(), store.pageSize()) : [];
  });
  return injectTable(() => ({
    features,
    columns,
    data: data(),
    getRowId: (p: Product) => String(p.index),
    state: { sorting: store.query().sorting, pagination: { pageIndex: store.pageIndex(), pageSize: store.pageSize() } },
    manualSorting: true,
    manualPagination: true,
    rowCount: store.result()?.total ?? 0,
    onSortingChange: (u) => store.setSorting(typeof u === "function" ? u(store.query().sorting) : u),
    onPaginationChange: (u) => {
      const prev = { pageIndex: store.pageIndex(), pageSize: store.pageSize() };
      store.setPage((typeof u === "function" ? u(prev) : u).pageIndex);
    },
  }));
}

@Component({
  selector: "shop-product-catalog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressBarModule, CatalogToolbarComponent, ProductGridViewComponent, ProductTableViewComponent, PagerComponent],
  template: `
    <section aria-label="Produtos" [attr.aria-busy]="store.status() === 'loading'">
      <shop-catalog-toolbar [table]="table" [showViewToggle]="!forceView()" />
      <mat-progress-bar mode="indeterminate" [class.hidden]="store.status() !== 'loading'" />
      @if (store.error(); as error) {
        <p role="alert">{{ error }}</p>
      }
      @if (view() === "grid") {
        <shop-product-grid-view [table]="table" />
      } @else {
        <shop-product-table-view [table]="table" />
      }
      <shop-pager [table]="table" />
    </section>
  `,
  styles: `
    mat-progress-bar { margin-bottom: 8px; }
    .hidden { visibility: hidden; }
  `,
})
export class ProductCatalogComponent {
  readonly forceView = input<"grid" | "table" | undefined>(undefined);
  protected readonly store = inject(CatalogStore);
  private readonly ui = inject(UiStore);
  protected readonly table = createProductTable();
  protected readonly view = computed(() => this.forceView() ?? this.ui.view());

  constructor() {
    const injector = inject(Injector);
    // Harness: after the DOM shows the new rows, mark the frame (React: useEffect on result).
    effect(() => {
      const r = this.store.result();
      if (r) afterNextRender(() => markPainted(r), { injector });
    });
  }
}
