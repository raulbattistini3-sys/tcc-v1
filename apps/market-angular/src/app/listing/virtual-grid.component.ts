import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterEveryRender, afterNextRender, computed, inject, input, signal, viewChild } from "@angular/core";
import { injectWindowVirtualizer } from "@tanstack/angular-virtual";
import { GRID } from "@shared/market.js";
import type { Product } from "@shared/catalog.js";
import { CATALOG } from "../tokens";
import { ProductCardComponent } from "../product/product-card.component";

/**
 * Every result scrolls as one window-virtualized grid (TanStack Virtual, as in market-react): only the
 * visible rows plus overscan are rendered, and only their products are decoded from the columnar data.
 */
@Component({
  selector: "mk-virtual-grid",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProductCardComponent],
  template: `
    <div #host class="gridHost" [style.height.px]="v.getTotalSize()" data-testid="results-grid">
      @for (row of v.getVirtualItems(); track row.key) {
        <div class="row" [style.transform]="'translateY(' + (row.start - v.options().scrollMargin) + 'px)'" [style.height.px]="rowHeight" [style.--cols]="cols()">
          @for (p of rowProducts(row.index); track p.index) {
            <mk-product-card [product]="p" />
          }
        </div>
      }
    </div>
  `,
  styles: `
    @use "market" as m;
    .gridHost { position: relative; width: 100%; }
    .row { @include m.grid-row; }
  `,
})
export class VirtualGridComponent {
  readonly indices = input.required<Uint32Array>();
  private readonly catalog = inject(CATALOG);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>("host");
  private readonly width = signal(0);
  private readonly offset = signal(0);
  protected readonly rowHeight = GRID.rowHeight;
  protected readonly cols = computed(() => Math.max(1, Math.floor((this.width() + GRID.gap) / (GRID.minCardWidth + GRID.gap))));
  private readonly rows = computed(() => Math.ceil(this.indices().length / this.cols()));

  protected readonly v = injectWindowVirtualizer(() => ({
    count: this.rows(),
    estimateSize: () => GRID.rowHeight + GRID.gap,
    overscan: GRID.overscanRows,
    scrollMargin: this.offset(),
  }));

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host().nativeElement;
      const ro = new ResizeObserver(([e]) => this.width.set(e ? e.contentRect.width : 0));
      ro.observe(el);
      destroy.onDestroy(() => ro.disconnect());
    });
    // where the grid starts on the page (the virtualizer's scroll margin), kept current like React's layout effect
    afterEveryRender(() => {
      const top = this.host().nativeElement.getBoundingClientRect().top + window.scrollY;
      if (top !== this.offset()) this.offset.set(top);
    });
  }

  protected rowProducts(row: number): Product[] {
    const ix = this.indices();
    const cols = this.cols();
    const out: Product[] = [];
    for (let k = row * cols, end = Math.min(ix.length, k + cols); k < end; k++) out.push(this.catalog.productAt(ix[k]!));
    return out;
  }
}
