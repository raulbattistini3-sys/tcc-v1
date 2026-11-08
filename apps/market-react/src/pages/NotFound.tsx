import { Link } from "react-router";
import Button from "@mui/material/Button";
import css from "./pages.module.scss";

export function NotFound() {
  return (
    <div className={css.empty}>
      <p>Página não encontrada.</p>
      <Button component={Link} to="/" variant="contained">
        Voltar ao início
      </Button>
    </div>
  );
}
