import { ChangeDetectionStrategy, Component, effect, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { CATALOG, CONDITIONS } from "./tokens";
import { UiStore } from "./stores/session.store";
import { HeaderComponent } from "./layout/header.component";
import { CategoryNavComponent } from "./layout/category-nav.component";

@Component({
  selector: "mk-root",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, HeaderComponent, CategoryNavComponent],
  template: `
    <mk-header />
    <mk-category-nav />
    <main class="main"><router-outlet /></main>
    <footer class="footer">
      <div class="footerInner">
        <span>TCC Market · Angular 22 + Angular Material · loja fictícia para os experimentos</span>
        <span data-testid="scheduler-status">{{ status }}</span>
      </div>
    </footer>
    <div class="toast" role="status" aria-live="polite" data-testid="toast" [hidden]="ui.toast() === null">{{ ui.toast() }}</div>
  `,
  styles: `
    @use "market" as m;
    :host { display: block; }
    .main { @include m.page; min-height: 70vh; }
    .footer { @include m.footer; }
    .footerInner { @include m.page; padding-top: 0; padding-bottom: 0; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
    .toast { @include m.toast; }
  `,
})
export class AppComponent {
  protected readonly ui = inject(UiStore);
  protected readonly status: string;

  constructor() {
    const { app, rows } = inject(CATALOG);
    const { strategy } = inject(CONDITIONS);
    this.status = `${rows.toLocaleString("pt-BR")} produtos · estratégia ${strategy} · ${app.workerError ? `sem worker (${app.workerError})` : "worker ativo"}`;
    // the toast hides itself after 2.5 s, like market-react's
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      clearTimeout(timer);
      if (this.ui.toast() !== null) timer = setTimeout(() => this.ui.hideToast(), 2500);
    });
  }
}
