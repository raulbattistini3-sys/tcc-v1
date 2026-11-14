import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInput } from "@angular/material/input";
import { MatProgressBar } from "@angular/material/progress-bar";
import { SORTS, categoryLabel, paramsFromQuery, queryFromParams, sortValue } from "@shared/market.js";
import { CONDITIONS } from "../tokens";
import { CatalogStore } from "../stores/catalog.store";
import { injectHarnessProbe, injectMirrorUrl } from "../market";
import { FilterSidebarComponent } from "./filter-sidebar.component";
import { VirtualGridComponent } from "./virtual-grid.component";

const count = new Intl.NumberFormat("pt-BR");
const ms = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

@Component({
  selector: "mk-listing-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInput, MatProgressBar, FilterSidebarComponent, VirtualGridComponent],
  template: `
    <div class="layout">
      <mk-filter-sidebar />
      <section>
        <div class="head">
          <div>
            <h1 class="heading">{{ heading() }}</h1>
            <div class="status" data-testid="results-status">{{ statusText() }}</div>
          </div>
          <!-- native select, as market-react's NativeSelect -->
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sort">
            <select matNativeControl aria-label="Ordenar por" [value]="sort()" (change)="setSort($any($event.target).value)">
              @for (s of sorts; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
          </mat-form-field>
        </div>
        @if (store.status() === "loading") {
          <mat-progress-bar mode="indeterminate" />
        }
        @if (store.result(); as r) {
          @if (r.total === 0) {
            <p class="empty">Nenhum produto encontrado. Tente outros termos ou limpe os filtros.</p>
          } @else {
            <mk-virtual-grid [indices]="r.indices" />
          }
        }
      </section>
    </div>
  `,
  styles: `
    @use "tokens" as t;
    @use "market" as m;
    .layout { @include m.listing; }
    .head { @include m.results-head; }
    .heading { margin: 0; font-size: 22px; font-weight: 600; }
    .status { @include m.status-line; }
    .empty { padding: t.$space * 6 0; text-align: center; color: m.$muted; }
    .sort { width: 200px; }
  `,
})
export class ListingPageComponent {
  protected readonly store = inject(CatalogStore);
  protected readonly sorts = SORTS;
  private readonly mirror = injectMirrorUrl();
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);

  protected readonly sort = computed(() => sortValue(this.store.query().sorting));
  protected readonly heading = computed(() => {
    const q = this.store.query();
    return q.search ? `“${q.search}”` : q.categories.length === 1 ? categoryLabel(q.categories[0]!) : "Todos os produtos";
  });
  protected readonly statusText = computed(() => {
    const r = this.store.result();
    return r ? `${count.format(r.total)} resultados · ${ms.format(r.totalMs)} ms no ${r.target === "worker" ? "worker" : "main thread"}` : "Buscando…";
  });

  constructor() {
    injectHarnessProbe();
    const { searchMode } = inject(CONDITIONS);
    // Arriving from a link, a reload or back/forward: the URL decides. A handler that already ran the
    // query left the store equal to the URL, so this does nothing then (market-react's effect, same rule).
    effect(() => {
      const map = this.params();
      if (!map) return;
      const sp = new URLSearchParams();
      for (const k of map.keys) for (const v of map.getAll(k)) sp.append(k, v);
      const fromUrl = queryFromParams(sp, searchMode);
      untracked(() => {
        if (!same(paramsFromQuery(fromUrl), paramsFromQuery(this.store.query())) || this.store.status() === "idle") this.store.setQuery(fromUrl);
      });
    });
  }

  protected setSort(value: string) {
    this.store.setSorting(SORTS.find((s) => s.value === value)?.sorting ?? []);
    this.mirror();
  }
}
