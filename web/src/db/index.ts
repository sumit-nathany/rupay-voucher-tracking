import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url =
  (process.env.APP_ENV === "preprod" ? process.env.PREPROD_DATABASE_URL : undefined) ||
  process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is not set");
}

// Supabase transaction pooler (port 6543 / Supavisor) does not support
// prepared statements, so prepare must be false (PLAN.md: Connection pooling).
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const client =
  globalForDb.conn ??
  postgres(url, {
    prepare: false,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
  });

globalForDb.conn = client;

export const db = drizzle(client, { schema });
export { schema };
