import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { poolConfig } from "./src/env.js";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (or DATABASE_MIGRATION_URL) in apps/server/.env");
const cfg = poolConfig(url, {
  DATABASE_SSL: process.env.DATABASE_SSL as "verify" | "off" | undefined,
  DATABASE_CA_CERT: process.env.DATABASE_CA_CERT,
});

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: cfg.connectionString as string, ssl: cfg.ssl ?? false },
  strict: true,
});
