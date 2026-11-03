// Footer readout of the last scheduler decision, for humans; the harness reads window.__shop.
import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import { CatalogStore } from "../stores/catalog.store";
import { changeDetectionMode } from "../change-detection";

@Component({
  selector: "shop-scheduler-status",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <span class="chip">angular · {{ mode }}</span>
    @if (store.result(); as r) {
      <span class="chip" [class.worker]="r.target === 'worker'">{{ r.target }}</span>
      <span class="text">
        {{ r.decision.reason }} · resultado {{ r.totalMs | number: "1.1-1" }} ms · bloqueio {{ r.mainBlockedMs | number: "1.1-1" }} ms · previsto main
        {{ r.decision.predMainMs | number: "1.1-1" }} / worker {{ r.decision.predWorkerMs | number: "1.1-1" }} ms · orçamento {{ r.decision.budgetMs | number: "1.1-1" }} ms
      </span>
    } @else {
      <span class="text">aguardando…</span>
    }
    @if (workerError()) {
      <span class="chip warn">sem worker: {{ workerError() }}</span>
    }
  `,
  host: { "data-testid": "scheduler-status" },
  styles: `
    @use "tokens" as t;
    :host { display: flex; align-items: center; gap: t.$space; flex-wrap: wrap; padding: t.$space t.$space * 2;
      border-top: 1px solid rgb(0 0 0 / 0.08); background: #fff; font-variant-numeric: tabular-nums; }
    .chip { font-size: 13px; padding: 2px 10px; border-radius: 16px; background: rgb(0 0 0 / 0.08); }
    .chip.worker { background: t.$brand; color: #fff; }
    .chip.warn { background: t.$accent; color: #fff; }
    .text { font-size: 12px; }
  `,
})
export class SchedulerStatusComponent {
  readonly workerError = input<string | null>(null);
  protected readonly store = inject(CatalogStore);
  protected readonly mode = changeDetectionMode;
}
