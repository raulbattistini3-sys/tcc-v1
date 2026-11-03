import { useState } from "react";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useSessionActions, useUser } from "../../hooks/useSession.js";

export function UserMenu() {
  const user = useUser();
  const { signIn, signOut } = useSessionActions();
  const [anchor, setAnchor] = useState(/** @type {HTMLElement | null} */ (null));

  if (!user) {
    return (
      <Button color="inherit" onClick={signIn}>
        Entrar
      </Button>
    );
  }
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={`Conta de ${user.name}`}>
        <Avatar sx={{ width: 32, height: 32, bgcolor: "secondary.main" }}>{user.initials}</Avatar>
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <MenuItem disabled>{user.name}</MenuItem>
        <MenuItem onClick={close}>Meus pedidos</MenuItem>
        <MenuItem
          onClick={() => {
            close();
            signOut();
          }}
        >
          Sair
        </MenuItem>
      </Menu>
    </>
  );
}
