import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pigment } from "@pigment-css/vite-plugin";
import { createTheme } from "@mui/material/styles";
import { fileURLToPath } from "node:url";
import { tokens } from "../shared/tokens.js";

const repo = fileURLToPath(new URL("../..", import.meta.url));

// MUI through Pigment CSS: the theme is applied at build time and every component's styles are
// extracted into a static CSS file. No Emotion runtime and no <style> injection at run time, which is
// what Angular Material's compiled Sass does too. (MUI 9 doesn't compile under Pigment; MUI 7.3 does:
// docs/markets.md.)
const theme = createTheme({
  cssVariables: true,
  palette: {
    primary: { main: tokens.brand },
    secondary: { main: tokens.accent },
    background: { default: tokens.surface },
  },
  shape: { borderRadius: tokens.radius },
  spacing: tokens.space,
  typography: { fontFamily: tokens.font },
});

// Dev: `npm run serve` at the repo root (port 5173) serves /data; Vite proxies to it.
// Build: dist/ with base /market-react/, mounted by tools/serve.mjs next to the other apps.
export default defineConfig({
  base: "/market-react/",
  plugins: [pigment({ theme, transformLibraries: ["@mui/material"] }), react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("../../src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  // Sass modules `@use "tokens"` / `@use "market"` from apps/shared/styles, like the Angular app
  css: { preprocessorOptions: { scss: { loadPaths: [fileURLToPath(new URL("../shared/styles", import.meta.url))] } } },
  worker: { format: "es" },
  server: {
    port: 5176,
    fs: { allow: [repo] },
    proxy: { "/data": "http://localhost:5173" },
  },
  build: { outDir: "dist", sourcemap: true, target: "es2023" },
});
