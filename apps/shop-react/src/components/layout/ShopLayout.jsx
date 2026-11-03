// Composable shell: the layout only owns the grid areas. Header, sidebar,
// content and footer are slots, so each piece can be swapped or removed per
// page condition without the layout knowing what is inside.
// Angular counterpart: <shop-layout> with <ng-content select="[slot=…]">.

import styles from "./ShopLayout.module.scss";

/**
 * @param {{ header?: import("react").ReactNode, sidebar?: import("react").ReactNode, footer?: import("react").ReactNode, children: import("react").ReactNode }} props
 */
export function ShopLayout({ header, sidebar, footer, children }) {
  return (
    <div className={sidebar ? styles.shell : `${styles.shell} ${styles.noSidebar}`}>
      {header && <header className={styles.header}>{header}</header>}
      {sidebar && <aside className={styles.sidebar}>{sidebar}</aside>}
      <main className={styles.main}>{children}</main>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}
