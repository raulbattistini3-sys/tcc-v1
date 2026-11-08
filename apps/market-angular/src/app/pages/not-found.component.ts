import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatButton } from "@angular/material/button";

@Component({
  selector: "mk-not-found",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButton],
  template: `
    <div class="empty">
      <p>Página não encontrada.</p>
      <a matButton="filled" routerLink="/">Voltar ao início</a>
    </div>
  `,
  styles: `
    @use "market" as m;
    .empty { padding: 48px 0; text-align: center; color: m.$muted; }
  `,
})
export class NotFoundComponent {}
