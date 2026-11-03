import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));

// Dev: `npm run serve` at the repo root (port 5173) serves /data; Vite proxies to it.
// Build: output goes to dist/ with base /react/, and tools/serve.mjs mounts it there,
// so both shops run behind the same server, CSP and isolation headers.
export default defineConfig({
  base: "/react/",
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("../../src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  worker: { format: "es" },
  server: {
    port: 5174,
    fs: { allow: [repo] },
    proxy: { "/data": "http://localhost:5173" },
  },
  build: { outDir: "dist", sourcemap: true, target: "es2023" },
});
