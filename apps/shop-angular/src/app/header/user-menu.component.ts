import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatMenuModule } from "@angular/material/menu";
import { SessionStore } from "../stores/session.store";

@Component({
  selector: "shop-user-menu",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatMenuModule],
  template: `
    @if (session.user(); as user) {
      <button matIconButton [matMenuTriggerFor]="menu" [attr.aria-label]="'Conta de ' + user.name">
        <span class="avatar">{{ user.initials }}</span>
      </button>
      <mat-menu #menu="matMenu">
        <button mat-menu-item disabled>{{ user.name }}</button>
        <button mat-menu-item>Meus pedidos</button>
        <button mat-menu-item (click)="session.signOut()">Sair</button>
      </mat-menu>
    } @else {
      <button matButton (click)="session.signIn()" class="sign-in">Entrar</button>
    }
  `,
  styles: `
    @use "tokens" as t;
    .avatar {
      display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%;
      background: t.$accent; color: #fff; font-size: 14px;
    }
    .sign-in { color: inherit; }
  `,
})
export class UserMenuComponent {
  protected readonly session = inject(SessionStore);
}
