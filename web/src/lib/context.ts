import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '@/db/schema';

// Shared contract for every domain function. Core logic takes a Ctx as its
// first argument instead of reading the session itself, so it can be tested
// against a local Postgres without Supabase Auth. The session layer builds Ctx
// from the authenticated user; nothing else may construct one.
// Driver-agnostic so tests can use PGlite while production uses postgres-js.
// Never import '@/db' (index.ts) from core logic: it throws without DATABASE_URL.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Ctx {
  userId: string;
  workspaceId: string; // always from the session, never from caller input
  role: 'admin' | 'member';
  db: Database;
  today: string; // 'YYYY-MM-DD' in Asia/Kolkata, computed once per request
}

export class AuthzError extends Error {}
export class NotFoundError extends Error {}
