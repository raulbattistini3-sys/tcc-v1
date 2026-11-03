import { useState } from "react";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useSessionStore } from "../../stores/session.store.js";

export function UserMenu() {
  const user = useSessionStore((s) => s.user);
  const signIn = useSessionStore((s) => s.signIn);
  const signOut = useSessionStore((s) => s.signOut);
  /** @type {[HTMLElement | null, (el: HTMLElement | null) => void]} */
  const [anchor, setAnchor] = useState(/** @type {HTMLElement | null} */ (null));

  if (!user) {
    return (
      <Button color="inherit" onClick={signIn}>
        Entrar
      </Button>
    );
  }
  return (
    <>
      <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={`Conta de ${user.name}`}>
        <Avatar sx={{ width: 32, height: 32, bgcolor: "secondary.main" }}>{user.initials}</Avatar>
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem disabled>{user.name}</MenuItem>
        <MenuItem onClick={() => setAnchor(null)}>Meus pedidos</MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            signOut();
          }}
        >
          Sair
        </MenuItem>
      </Menu>
    </>
  );
}
