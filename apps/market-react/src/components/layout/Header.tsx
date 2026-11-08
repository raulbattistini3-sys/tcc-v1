import { useState } from "react";
import { Link } from "react-router";
import InputBase from "@mui/material/InputBase";
import IconButton from "@mui/material/IconButton";
import SearchIcon from "@mui/icons-material/Search";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { useOpenListing } from "../../hooks/market";
import { selectCount, useCartStore } from "../../stores/cart.store";
import { useSessionStore } from "../../stores/session.store";
import css from "./layout.module.scss";

export function Header() {
  const open = useOpenListing();
  const count = useCartStore(selectCount);
  const user = useSessionStore((s) => s.user);
  const [text, setText] = useState("");
  return (
    // a plain <header>, not MUI's AppBar: AppBar is an elevated Paper, which reads theme shadows at
    // run time, and Pigment's runtime theme doesn't carry them (docs/markets.md). Angular draws the same.
    <header className={css.appbar}>
      <div className={css.row}>
        <Link to="/" className={css.logo}>
          TCC Market
        </Link>
        <form
          role="search"
          className={css.search}
          onSubmit={(e) => {
            e.preventDefault();
            open({ search: text });
          }}
        >
          <InputBase
            className={css.searchInput}
            placeholder="Buscar produtos, marcas e muito mais…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputProps={{ "aria-label": "Buscar produtos", "data-testid": "search-input" }}
          />
          <IconButton type="submit" aria-label="Buscar">
            <SearchIcon />
          </IconButton>
        </form>
        <div className={css.actions}>
          {user && <span className={css.user}>Olá, {user.name.split(" ")[0]}</span>}
          <IconButton component={Link} to="/carrinho" color="inherit" aria-label={`Carrinho, ${count} itens`}>
            {/* a plain badge: Pigment can't evaluate MUI's Badge at build time (and Angular draws the same span) */}
            <span className={css.badgeHost}>
              <ShoppingCartIcon />
              {count > 0 && (
                <span className={css.badge} data-testid="cart-count">
                  {count}
                </span>
              )}
            </span>
          </IconButton>
        </div>
      </div>
    </header>
  );
}
