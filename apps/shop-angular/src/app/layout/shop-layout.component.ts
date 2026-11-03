// Composable shell: the layout only owns the grid areas. Header, sidebar,
// content and footer are projected slots. React counterpart: <ShopLayout header sidebar footer>.
import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "shop-layout",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "shell", "[class.no-sidebar]": "!hasSidebar()" },
  template: `
    <header class="header"><ng-content select="[shopHeader]" /></header>
    @if (hasSidebar()) {
      <aside class="sidebar"><ng-content select="[shopSidebar]" /></aside>
    }
    <main class="main"><ng-content /></main>
    <footer class="footer"><ng-content select="[shopFooter]" /></footer>
  `,
  styleUrl: "./shop-layout.component.scss",
})
export class ShopLayoutComponent {
  readonly hasSidebar = input(false);
}
