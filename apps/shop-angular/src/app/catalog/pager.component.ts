import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MatPaginatorModule } from "@angular/material/paginator";
import type { ProductTable } from "./product-catalog.component";

@Component({
  selector: "shop-pager",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatPaginatorModule],
  template: `
    @let t = table();
    @if (t.getPageCount() > 1) {
      <mat-paginator
        [length]="t.getRowCount()"
        [pageIndex]="t.atoms.pagination.get().pageIndex"
        [pageSize]="t.atoms.pagination.get().pageSize"
        [hidePageSize]="true"
        [showFirstLastButtons]="true"
        (page)="t.setPageIndex($event.pageIndex)"
      />
    }
  `,
  styles: `:host { display: flex; justify-content: center; padding: 24px 0; } mat-paginator { background: transparent; }`,
})
export class PagerComponent {
  readonly table = input.required<ProductTable>();
}
