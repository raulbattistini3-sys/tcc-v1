import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButton } from "@angular/material/button";
import { categoryLabel } from "@shared/market.js";
import { CATALOG } from "../tokens";
import { injectOpenListing } from "../market";

@Component({
  selector: "mk-category-nav",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    <nav class="nav" aria-label="Categorias">
      <div class="navInner">
        @for (c of categories; track c) {
          <button matButton (click)="open({ categories: [c] })">{{ label(c) }}</button>
        }
      </div>
    </nav>
  `,
  styles: `
    @use "market" as m;
    .nav { background: #fff; border-bottom: 1px solid m.$line; }
    .navInner { @include m.category-nav; }
    button { color: inherit; text-transform: uppercase; font-size: 13px; }
  `,
})
export class CategoryNavComponent {
  protected readonly categories = inject(CATALOG).categories;
  protected readonly label = categoryLabel;
  protected readonly open = injectOpenListing();
}
