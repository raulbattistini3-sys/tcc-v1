import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { ProductCardComponent } from "./product-card.component";
import type { ProductTable } from "./product-catalog.component";

@Component({
  selector: "shop-product-grid-view",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProductCardComponent],
  template: `
    @let rows = table().getRowModel().rows;
    @if (rows.length === 0) {
      <p class="empty">Nenhum produto encontrado.</p>
    } @else {
      <div class="grid" data-testid="product-grid">
        @for (row of rows; track row.id) {
          <shop-product-card [product]="row.original" />
        }
      </div>
    }
  `,
  styles: `
    @use "tokens" as t;
    .grid { @include t.product-grid; }
    .empty { padding: t.$space * 6 0; text-align: center; opacity: 0.7; }
  `,
})
export class ProductGridViewComponent {
  readonly table = input.required<ProductTable>();
}
