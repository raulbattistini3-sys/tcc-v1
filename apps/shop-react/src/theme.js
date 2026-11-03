import { createTheme } from "@mui/material/styles";
import { tokens } from "@shared/tokens.js";

// Same brand, radius and spacing as the Angular Material M3 theme (shared tokens).
export const theme = createTheme({
  palette: {
    primary: { main: tokens.brand },
    secondary: { main: tokens.accent },
    background: { default: tokens.surface },
  },
  shape: { borderRadius: tokens.radius },
  spacing: tokens.space,
  typography: { fontFamily: tokens.font },
});
