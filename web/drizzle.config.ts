import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const appEnv = process.env.APP_ENV;
const candidates = [
  appEnv ? resolve(process.cwd(), `.env.${appEnv}`) : null,
  appEnv ? resolve(process.cwd(), `../.env.${appEnv}`) : null,
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), "../.env.local"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
].filter(Boolean) as string[];

for (const p of candidates) {
  if (existsSync(p)) {
    config({ path: p });
  }
}

const url =
  (appEnv === "preprod" ? process.env.PREPROD_DATABASE_URL : undefined) ||
  (appEnv === "prod" || appEnv === "production" ? process.env.PROD_DATABASE_URL : undefined) ||
  process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    appEnv === "preprod"
      ? "PREPROD_DATABASE_URL (or DATABASE_URL in .env.preprod) is not set"
      : "DATABASE_URL is not set"
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["app"],
  dbCredentials: { url },
});
