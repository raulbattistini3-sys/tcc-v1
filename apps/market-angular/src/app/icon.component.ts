// Inline SVG icons (Material Symbols paths, Apache-2.0), as in shop-angular: mat-icon's ligature font
// would need a Google Fonts stylesheet, and MUI's icons are SVG too, so both apps paint the same kind.
import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

const PATHS = {
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14",
  shopping_cart:
    "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2M1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
  remove: "M19 13H5v-2h14z",
  delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z",
} as const;

export type IconName = keyof typeof PATHS;

@Component({
  selector: "mk-icon",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "aria-hidden": "true" },
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="currentColor"><path [attr.d]="d()" /></svg>`,
  styles: `:host { display: inline-flex; line-height: 0; }`,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(24);
  protected readonly d = computed(() => PATHS[this.name()]);
}
