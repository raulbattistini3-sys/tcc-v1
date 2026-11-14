import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { poolConfig, type Config } from "../env.js";

// node-postgres sends unnamed statements, so it works through Supabase's transaction pooler (port 6543)
// as is: no prepared statements to lose between transactions, and nothing here issues SET.
export function createDb(config: Config) {
  const pool = new pg.Pool({ ...poolConfig(config.DATABASE_URL, config), max: 10, idleTimeoutMillis: 30_000 });
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>["db"];
