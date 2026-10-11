# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A web app that tracks RuPay card benefits (Indian card network) across banks, cards, and family members — replacing an Excel tracker. It maintains a shared reference catalog of bank card type → benefits, generates a benefit instance per entitlement period (quarterly / half-yearly / annual / monthly), and tracks each instance through order → coupon received → used/sold, with voucher codes encrypted at rest.

Read before any non-trivial change:

- **REQUIREMENTS.md** — what the product must do. If it and PLAN.md disagree, REQUIREMENTS.md wins on product scope.
- **PLAN.md** — how it's built (schema, security model, build phases). Very large; read the section you need, not the whole file.
- **docs/** — per-feature requirements and implementation plans (e.g. automated RuPay ordering, portal API, zero-knowledge encryption).

## Repo layout

| Path | Contents |
|---|---|
| `web/` | The Next.js 15 app. All npm work happens here. |
| `worker/` | Standalone Node worker for automated RuPay ordering (in flight). Imports web's `src/db/schema.ts` and `src/domain/` via relative paths — shared code, not a separate package. |
| `web/src/domain/` | Core business logic. Pure functions over a `Ctx`, no session/env reads. |
| `web/src/actions/` | Server Actions — the only write path for the UI. |
| `web/src/app/(app)/` | Authenticated pages (dashboard, benefits, cards, holders, overrides, admin, automation). |
| `web/src/lib/` | Session/context, crypto, periods, portal client, Supabase client. |
| `web/scripts/` | One-off ops scripts run with `npx tsx scripts/<name>/run.ts` (seed-catalog, portal-import, excel-import, data fixes). |
| `catalog-lists/` | Reference lists used when curating the shared catalog. |

## Commands

From `web/`:

```bash
npm run dev               # Next.js dev server
npm run build             # production build
npm test                  # vitest run (single pass, node env)
npm run lint              # eslint
npm run db:generate       # drizzle-kit generate — after editing src/db/schema.ts
npm run db:migrate:prod   # apply pending migrations to live production DB (uses pooler with prepare: false)
npm run db:migrate:preprod# apply pending migrations to preprod DB
```

From `worker/`: `npm run dev` (tsx) / `npm run build` (tsc) + `npm start`.

## Architecture essentials

- **Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4 + shadcn/ui, Drizzle ORM over `postgres-js`, Supabase Postgres (Mumbai) + Supabase Auth, deployed on Vercel (`bom1`).
- **Connection:** always the Supabase **transaction pooler** (port 6543) with `prepare: false` — see `web/src/db/index.ts`. Direct `:5432` exhausts Postgres under serverless.
- **The `Ctx` pattern is the core rule:** domain functions take `Ctx { userId, workspaceId, role, db, today }` as their first argument (`web/src/lib/context.ts`). Domain code must never import `@/db` (index.ts throws without `DATABASE_URL`) and never reads the session itself. `today` is `YYYY-MM-DD` in **Asia/Kolkata**.
- **Auth:** Supabase Auth, invite-only (public self-signup disabled in Supabase settings). Middleware checks a valid session; workspace membership is resolved per-request in `getCtx()` (`web/src/lib/session.ts`).
- **Tenancy:** a workspace is the tenant boundary. Isolation is enforced at the application layer — query scoping (`workspace_id` from the session only) plus composite foreign keys `(workspace_id, id)` on per-workspace tables. Not Postgres RLS.
- **Schema lockdown:** all app tables live in the non-public `app` schema (`schemaFilter: ["app"]` in drizzle.config.ts) so Supabase's PostgREST (reachable with the public anon key) sees nothing. Never create app tables in `public`.
- **Crypto:** voucher codes are AES-256-GCM encrypted (`web/src/lib/crypto.ts`) with the instance's own id as associated data; decryption only in the explicit reveal action.

## Testing

- Vitest, tests sit next to source as `*.test.ts`. `npm test` from `web/`.
- Domain/DB tests use `createTestDb()` (`web/src/test/db.ts`): a fresh PGlite in-memory Postgres per test file with **every migration in `web/drizzle/` replayed** — no `DATABASE_URL` or Supabase needed. New migration files are picked up automatically and must be valid, replayable SQL.
- Per PLAN.md's security model, every server action gets a tenant-isolation test proving workspace A cannot read, write, or reference workspace B's rows by ID — reads included; the reveal-code action is the highest priority.

## Migrations (CRITICAL: Database Migrations Precede UI Deployment)

> **MANDATORY RULE:** Whenever you create or modify migrations or schema: **YOU MUST RUN `npm run db:migrate:prod` BEFORE COMMITTING/PUSHING TO `main`**.
>
> **Why this matters:**
> - Pushing or merging to `main` triggers an automatic Vercel production deployment.
> - Vercel builds (`next build`) compile and deploy application code, but **do NOT execute database migrations**.
> - Local vitest tests run on an ephemeral in-memory PGlite database which automatically replays `drizzle/` files; passing unit tests do **NOT** mean the live production database has the updated tables or columns!
> - If code touching new tables or columns is deployed before the production DB is migrated, live queries crash with `relation "app.<table_name>" does not exist` or `column "<col>" does not exist`.

### Migration Step-by-Step Checklist

1. **Edit schema:** Modify `web/src/db/schema.ts`.
2. **Generate migration:** Run `npm run db:generate` from `web/`.
3. **Review SQL:** Inspect the newly generated migration file in `web/drizzle/` and verify `web/drizzle/meta/_journal.json`. Hand-written data-fix migrations also live here (e.g. `0005`, `0007`, `0008`).
4. **Run tests:** Run `npm test` from `web/` to verify that PGlite replays all migrations cleanly and unit/tenant tests pass.
5. **APPLY TO PRODUCTION:** Run `npm run db:migrate:prod` from `web/`.
   - Verify console output confirms `All migrations applied successfully!`.
   - If there is any migration hash discrepancy or error, resolve it immediately before proceeding.
6. **Verify build:** Run `npm run build` from `web/` to ensure no compile-time or static analysis errors.
7. **Commit and push:** Only after steps 4, 5, and 6 succeed, commit and push changes to git.

## Environment variables

Never committed (`.env*` is gitignored; `.env.local` exists at root and in `web/`). Web needs: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VOUCHER_ENCRYPTION_KEY` (32-byte base64), `PORTAL_CREDENTIAL_ENCRYPTION_KEY` (automation). Worker needs: `WORKER_DATABASE_URL` (or `DATABASE_URL`) and `PORTAL_USER_ID` / `PORTAL_JWT_FILE` / `PORTAL_SESSIONID_FILE` for portal sessions.

## Security non-negotiables

- `*.xlsx` and `.env*` are never committed — the source workbook contains live card codes/PINs.
- Voucher codes and booking IDs never appear in logs, errors, test output, or script output; voucher codes are masked in the UI unless explicitly revealed.
- All data access is server-side (Server Actions / Route Handlers → Drizzle). The browser never queries the database.
- `workspaceId` always comes from the session, never from caller input.
- Don't weaken the composite FKs or move tables into `public`.
- Encryption keys are server-only env vars — never `NEXT_PUBLIC_*`.

## Conventions

- **Commits:** conventional commits with a scope, lowercase, imperative — `feat(benefits): …`, `fix(catalog): …`, `refactor(domain): …`, `docs: …`. Common scopes: benefits, cards, holders, catalog, instances, domain, ui, filters, migration.
- **Branches:** `feat/…` / `fix/…` off `main`; PRs target `main`.
- **Deployments:** Never deploy to production manually (`npx vercel --prod` is not needed). Pushing or merging to `main` automatically triggers Vercel production deployment via git integration. Because Vercel does NOT run migrations, whenever schema or migration files change, you MUST run `npm run db:migrate:prod` before pushing code to `main`! Deploying UI code ahead of DB migrations crashes live pages.
- **Spec updates:** product decisions land in REQUIREMENTS.md/PLAN.md. External review rounds produce `Review Feedback vX.md` at the root; once findings are reconciled into the specs, those files are deleted.
- **Feature docs:** new features get a requirements + implementation-plan pair under `docs/` before building (see `docs/automated-rupay-ordering-*.md`).
- **In flight:** the `feat/automated-rupay-ordering` branch is building the automated ordering feature (worker, portal client, stored portal credentials) per `docs/automated-rupay-ordering-*.md`.
