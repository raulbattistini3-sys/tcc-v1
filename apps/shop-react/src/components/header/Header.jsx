import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { SearchBar } from "./SearchBar.jsx";
import { UserMenu } from "./UserMenu.jsx";
import { CartButton } from "./CartButton.jsx";
import { useSessionStore } from "../../stores/session.store.js";

// The header composes three independent pieces; each one subscribes to its own store slice.
export function Header() {
  const signedIn = useSessionStore((s) => s.user !== null);
  return (
    <AppBar position="static" elevation={0}>
      <Toolbar sx={{ gap: 2 }}>
        <Typography variant="h6" component="span" noWrap sx={{ fontWeight: 700 }}>
          Loja TCC
        </Typography>
        <Box sx={{ flex: 1, maxWidth: 640 }}>
          <SearchBar />
        </Box>
        <Box sx={{ flex: 1 }} />
        <UserMenu />
        {signedIn && <CartButton />}
      </Toolbar>
    </AppBar>
  );
}
