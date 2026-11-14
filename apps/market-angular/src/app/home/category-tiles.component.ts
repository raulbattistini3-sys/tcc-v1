import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { MatRipple } from "@angular/material/core";
import { categoryLabel } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { CATALOG } from "../tokens";
import { injectOpenListing } from "../market";

@Component({
  selector: "mk-category-tiles",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatRipple],
  template: `
    <section>
      <h2 class="title">Categorias</h2>
      <div class="tiles">
        @for (c of categories; track c) {
          <mat-card appearance="outlined">
            <button class="tile" matRipple (click)="open({ categories: [c] })">
              <img class="tileImage" [src]="img(c, 0)" alt="" width="72" height="72" />
              {{ label(c) }}
            </button>
          </mat-card>
        }
      </div>
    </section>
  `,
  styles: `
    @use "market" as m;
    .title { @include m.section-title; }
    .tiles { @include m.tiles; }
    .tile { @include m.tile; width: 100%; border: 0; background: none; cursor: pointer; font-family: inherit; color: inherit; position: relative; overflow: hidden; }
    .tileImage { @include m.tile-image; }
  `,
})
export class CategoryTilesComponent {
  protected readonly categories = inject(CATALOG).categories;
  protected readonly label = categoryLabel;
  protected readonly img = productImage;
  protected readonly open = injectOpenListing();
}
