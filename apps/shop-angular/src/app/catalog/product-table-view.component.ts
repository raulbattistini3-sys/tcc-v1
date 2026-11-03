// A native table with Material styling. mat-table would bring its own data
// source and column model; TanStack owns both here, as it does in React (MUI Table is just styled elements).
import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { FlexRender } from "@tanstack/angular-table";
import { IconComponent } from "../icon.component";
import type { ProductTable } from "./product-catalog.component";

@Component({
  selector: "shop-product-table-view",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlexRender, IconComponent],
  template: `
    <table data-testid="product-table">
      <thead>
        @for (group of table().getHeaderGroups(); track group.id) {
          <tr>
            @for (header of group.headers; track header.id) {
              @let sorted = header.column.getIsSorted();
              <th [class.right]="align(header.column.columnDef.meta) === 'right'" [attr.aria-sort]="sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : null">
                @if (header.column.getCanSort()) {
                  <button class="sort" (click)="header.column.toggleSorting()">
                    <ng-container *flexRenderHeader="header; let value">{{ value }}</ng-container>
                    <shop-icon [name]="sorted === 'desc' ? 'arrow_downward' : 'arrow_upward'" [size]="16" [class.inactive]="!sorted" />
                  </button>
                } @else {
                  <ng-container *flexRenderHeader="header; let value">{{ value }}</ng-container>
                }
              </th>
            }
          </tr>
        }
      </thead>
      <tbody>
        @for (row of table().getRowModel().rows; track row.id) {
          <tr>
            @for (cell of row.getAllCells(); track cell.id) {
              <td [class.right]="align(cell.column.columnDef.meta) === 'right'">
                <ng-container *flexRenderCell="cell; let value">{{ value }}</ng-container>
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: "./product-table-view.component.scss",
})
export class ProductTableViewComponent {
  readonly table = input.required<ProductTable>();
  protected align(meta: unknown) {
    return (meta as { align?: string } | undefined)?.align ?? "left";
  }
}
