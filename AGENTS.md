# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A web app that tracks RuPay card benefits (Indian card network) across banks, cards, and family members — replacing an Excel tracker. It maintains a shared reference catalog of bank card type → benefits, generates a benefit instance per entitlement period (quarterly / half-yearly / annual / monthly), and tracks each instance through order → coupon received → used/sold, with voucher codes encrypted at rest.

Read before any non-trivial change:

- **REQUIREMENTS.md** — what the product must do. If it and PLAN.md disagree, REQUIREMENTS.md wins on product scope.
- **PLAN.md** — how it's built (schema, security model, build phases). Very large; read the section you need, not the whole file.
- **docs/** — per-feature requirements and implementation plans (e.g. automated RuPay ordering, portal API, zero-knowledge encryption), plus `docs/backlog.md` — the prioritized, agent-pickable improvement queue — and `docs/review-history.md` — the `RH#N` rationale index behind the subtler rules in the specs.

## Repo layout

| Path | Contents |
|---|---|
| `web/` | The Next.js 15 app. All npm work happens here. |
| `worker/` | Standalone Node worker for automated RuPay ordering. Imports web's `src/db/schema.ts` and `src/domain/` via relative paths — shared code, not a separate package. `worker/src/batch.ts` is the Cloud Run Job entry point; `worker/infra/` holds the gcloud deploy scripts; `worker/build.mjs` bundles it with esbuild. |
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

From `worker/`: `npm run dev` (tsx) / `npm run build` (esbuild bundle) + `npm start` / `npm test` / `npm run typecheck`. The deployed worker runs on Google Cloud Run Jobs — see `docs/worker-hosting-runbook.md`.

## Architecture essentials

- **Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4 + shadcn/ui, Drizzle ORM over `postgres-js`, Supabase Postgres (Mumbai) + Supabase Auth, deployed on Vercel (`bom1`).
- **Connection:** always the Supabase **transaction pooler** (port 6543) with `prepare: false` — see `web/src/db/index.ts`. Direct `:5432` exhausts Postgres under serverless.
- **The `Ctx` pattern is the core rule:** domain functions take `Ctx { userId, workspaceId, role, db, today }` as their first argument (`web/src/lib/context.ts`). Domain code must never import `@/db` (index.ts throws without `DATABASE_URL`) and never reads the session itself. `today` is `YYYY-MM-DD` in **Asia/Kolkata**.
- **Auth:** Supabase Auth, invite-only (public self-signup disabled in Supabase settings). Middleware checks a valid session; workspace membership is resolved per-request in `getCtx()` (`web/src/lib/session.ts`).
- **Tenancy:** a workspace is the tenant boundary. Isolation is enforced at the application layer — query scoping (`workspace_id` from the session only) plus composite foreign keys `(workspace_id, id)` on per-workspace tables. Not Postgres RLS.
- **Schema lockdown:** all app tables live in the non-public `app` schema (`schemaFilter: ["app"]` in drizzle.config.ts) so Supabase's PostgREST (reachable with the public anon key) sees nothing. Never create app tables in `public`.
- **Crypto:** voucher codes are AES-256-GCM encrypted (`web/src/lib/crypto.ts`) with the instance's own id as associated data; decryption only in the explicit reveal action.
- **Backend-Enforced Business Logic (Strict Rule):** Any business logic, domain rule, constraint, eligibility filter, or state transition MUST be implemented and strictly enforced on the backend (`web/src/domain/` and `web/src/actions/`), NEVER solely on the frontend UI. Frontend safeguards (such as disabled buttons, form client-side validations, conditional dropdown options, or warning banners) are purely user-experience conveniences and must never be relied upon as the security or integrity boundary. The domain layer must independently validate all inputs and database preconditions, reject invalid requests with explicit domain errors (e.g. `ValidationError`), and filter queries so that invalid or unconfigured entities cannot be saved, mapped, queued, or executed.
- **In-Place UI Editing & Drawer / Modal Stability (Strict Rule):** All edit flows across cards, drawers, dialogs, and sections must edit in place without reloading, flickering, layout shifts, or scroll jumps:
  1. *Same DOM structure & in-place field swapping:* Never unmount parent containers or switch between disparate root elements (e.g. `<div>` vs. `<form>`). Keep a single permanent container (e.g. `<form>`) and render each field row once at uniform heights (e.g. `min-h-[44px]`). In view mode, render the read-only value; in edit mode, swap to the input box (`<input>`, `<textarea>`, or native `<select>`) directly in place.
  2. *Permanently mounted action buttons:* The primary action button (`Edit` $\leftrightarrow$ `Save`) must remain permanently mounted in the DOM and simply toggle its label, styling, and `onClick` handler. Never unmount a button during its click/pointer event. Removing an element while it has active focus drops focus to `document.body`, causing Radix's focus trap to snap focus to the top close button (`scrollTop = 0`) and Radix's DismissableLayer to register a rogue outside click.
  3. *Scroll position preservation:* Capture and restore the scroll position on the `.overflow-y-auto` container across edit/cancel transitions to guarantee zero scroll movement.
  4. *Never wipe loaded entity data on transient ticks:* In drawers and modals, never set loaded entity state to `null` if the entity ID has not changed (`if (inst?.id !== instanceId) setInst(null)`). Clearing state on transient state updates unmounts the drawer body, flashes the loading spinner, and causes full-drawer reloads.
  5. *Prefer styled native `<select>` inside drawers/dialogs:* Avoid nested Radix `<Select>` portals inside dialogs and sheets to prevent portal focus-trap collisions and dismissal conflicts. Use styled native `<select>` elements for 100% reliable, instant, and flicker-free dropdowns.

## Testing

- Vitest, tests sit next to source as `*.test.ts`. `npm test` from `web/`.
- Domain/DB tests use `createTestDb()` (`web/src/test/db.ts`): a fresh PGlite in-memory Postgres per test file with **every migration in `web/drizzle/` replayed** — no `DATABASE_URL` or Supabase needed. New migration files are picked up automatically and must be valid, replayable SQL.
- Per PLAN.md's security model, every server action gets a tenant-isolation test proving workspace A cannot read, write, or reference workspace B's rows by ID — reads included; the reveal-code action is the highest priority.

## Migrations

### 1. Mandatory Invariant: Strict Backward Compatibility

> **CORE PRINCIPLE:** Every database migration MUST be 100% backward compatible with the currently running application code.
>
> If a migration is applied to production and the new UI code is **never deployed** (or is delayed, fails build, or gets rolled back), the currently live application **MUST continue to function normally without any errors or degraded behavior**.

#### Backward Compatibility Rules:
- **Additive changes only:**
  - Adding new tables, indexes, or views is always safe.
  - Adding columns: **MUST be nullable (`NULL`) or have an explicit, safe `DEFAULT`**. Never add a `NOT NULL` column without a `DEFAULT`.
- **Never make breaking changes in a single migration:**
  - **Do NOT drop** tables or columns that the currently running app queries or mutates.
  - **Do NOT rename** columns or tables directly (a rename drops the old identifier, immediately breaking running queries).
  - **Do NOT alter existing column types** in incompatible ways.
  - **Do NOT remove or rename enum values** still referenced in existing code.
  - **Do NOT add restrictive constraints** (`CHECK`, `UNIQUE`, foreign keys) that current running code paths might violate.
- **Expand-and-Contract Pattern for Schema Refactoring:**
  When renaming or deprecating columns/tables, split the work across separate releases:
  1. *Expand (Migration 1):* Add the new column/table as nullable/with default. Apply migration. (Live UI continues running unaffected).
  2. *Deploy Code (Release 1):* Deploy app code that writes to both columns and reads from new with fallback to old.
  3. *Backfill:* Backfill historical data from old column to new column.
  4. *Deploy Code (Release 2):* Deploy app code that reads and writes exclusively to the new column.
  5. *Contract (Migration 2):* In a later release after the old column is entirely unused, create a cleanup migration dropping the old column.

### 2. Migration Execution Workflow

Because all migrations are strictly backward compatible, applying them to the database does not affect the live site. However, new UI code depends on the migration having been executed in the database before querying it.

1. **Edit schema:** Modify `web/src/db/schema.ts` ensuring all changes are backward compatible.
2. **Generate migration:** Run `npm run db:generate` from `web/`.
3. **Review SQL:** Inspect the generated migration in `web/drizzle/` and verify `web/drizzle/meta/_journal.json`. Hand-written data-fix migrations also live here (e.g. `0005`, `0007`, `0008`).
4. **Run tests:** Run `npm test` from `web/` to verify that PGlite replays all migrations cleanly and all unit/tenant tests pass.
5. **Verify build:** Run `npm run build` from `web/` to guarantee no compile-time or static analysis errors.
6. **Apply to production:** Run `npm run db:migrate:prod` from `web/`.
   - Verify terminal logs confirm targeting the production project ref (`kdtkvzbkppdqjjqzinbi`), NOT preprod.
   - Verify console output confirms `All migrations applied successfully!`.
   - Because the migration is backward compatible, the live application is completely safe even if deployment takes time.
7. **Commit and push:** Push to `main` to trigger the Vercel production deployment of the new application code.

### 3. Dual-Environment Database Targets (Prod vs Preprod)

There are two separate Supabase Postgres databases:
- **Production:** Supabase project ref `kdtkvzbkppdqjjqzinbi`, default workspace `c55818d7-7fcd-49a6-a270-cb908a9a0840`. This is the live database queried by Vercel production deployments.
- **Pre-Production:** Supabase project ref `vxqexizifbzknsscicck`, default workspace `5c0f1e32-9179-47c7-8623-145ebd4fa6f8`. Used for local dev and staging.

**Critical Guardrails:**
- `web/.env.local` is frequently configured for preprod (`APP_ENV=preprod`). **Never assume `DATABASE_URL` in `.env.local` points to production.**
- Production operations must always resolve `PROD_DATABASE_URL` (or `web/.env.prod`).
- `scripts/lib/env.ts` actively guards against cross-environment pollution: targeting `prod` will fail loudly if the database URL points to preprod (`vxqexizifbzknsscicck`), and vice versa.
- When executing migration or data scripts, always inspect the masked database connection log to verify the project ref matches `postgres.kdtkvzbkppdqjjqzinbi`.

### 4. Error Visibility & Debuggability

- **Never silently swallow errors in UI server components or actions.**
- When handling exceptions in `try/catch` blocks in server components (e.g. `dashboard-content.tsx`, `benefits-content.tsx`):
  - Always log `console.error('[component]', err)`.
  - Pass the explicit error message to `<ErrorPanel message={...} />` (`e instanceof Error ? e.message : String(e)`).
  - Silent error swallowing hides database errors, schema mismatches, and connection issues behind generic messages and makes debugging in production difficult.

## Environment variables

Never committed (`.env*` is gitignored; `.env.local` exists at root and in `web/`). Web needs: `DATABASE_URL`, `PROD_DATABASE_URL`, `PREPROD_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VOUCHER_ENCRYPTION_KEY` (32-byte base64), `PORTAL_CREDENTIAL_ENCRYPTION_KEY` (automation). Worker needs: `WORKER_DATABASE_URL` (or `DATABASE_URL`), `PORTAL_CREDENTIAL_ENCRYPTION_KEY`, one captcha solver key (`CAPSOLVER_API_KEY` / `NOPECHA_API_KEY` / `TWOCAPTCHA_API_KEY`), `GEMINI_API_KEY`, plus `HEADLESS` and `USE_BROWSER_RUNNER`. Portal sessions are **not** file-based: credentials live encrypted in the database and are decrypted per account at run time. The deployed worker runs on Google Cloud Run Jobs (see `docs/environments-and-deployment.md` §8 and `docs/worker-hosting-runbook.md`).

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
- **Spec updates:** product decisions land in REQUIREMENTS.md/PLAN.md. External review rounds are **summarised, not archived**: every finding is reconciled into the spec, and the surviving "why" for each rule is kept as a row in `docs/review-history.md`, which PLAN.md and REQUIREMENTS.md cite as `RH#N`. The original round-by-round files are deleted once reconciled — git history has them. The reusable review harness is `docs/REVIEW_PROMPT.md`.
- **Feature docs:** new features get a requirements + implementation-plan pair under `docs/` before building (see `docs/automated-rupay-ordering-*.md`).
- **Backlog:** `docs/backlog.md` holds the prioritized, self-contained improvement items (reminders, work-queue triage, onboarding, resilience, a11y). Each item is written to be pickable by a single agent — read the item's "Acceptance criteria" and "Files to touch" before starting, and strike the item off when it lands.
- **In flight:** the `feat/automated-rupay-ordering` branch is building the automated ordering feature (worker, portal client, stored portal credentials) per `docs/automated-rupay-ordering-*.md`.

## RuPay Portal Order Lifecycle & 20-Min Cooldown Invariant

- `POST /api/Select/addUserTransaction` creates an order (`RUPS-*`) in `Initiated` state and locks the benefit entitlement and account for **20 minutes**.
- **Pending/Failed orders**: If 3DS OTP fails, times out, or the session aborts, the transaction remains locked in `Initiated` until the 20-minute window expires. Truztee then drops or marks it `Failure`, automatically unlocking the benefit for redemption.
- **Completed orders**: On 3DS authorization success, status transitions to `Success`. Voucher codes (`ccode`) populate immediately or within 24–48 hours.
- **Rule for agents**: Never assume an abandoned attempt burnt the benefit permanently. Always wait 20 minutes from `addUserTransaction` timestamp before retrying an interrupted order.

## Portal Entitlement Scoping: `(portal_account, card_type, period)`

- **Physical Cards vs. Portal Accounts**: Benefits are legally entitled to individual physical cards. However, the RuPay Portal enforces redemption limits at the `(portal_account, card_type, period)` level, NOT per physical card number.
- **Multi-Card Conflict**: If an account has multiple cards of the same `bank_card_type` (e.g. two Bank of India Select cards), once a benefit (e.g. Cab Services in Q4) is redeemed from that account, the portal hides/disables that benefit for all other cards of that type on that account for the rest of the period.
- **Automation Rule**: Benefit instances of the same `(bankCardTypeId, benefitId, periodStart)` can only be redeemed once per portal account per period. Additional cards of the same type must be mapped to and ordered from a separate portal account where that benefit has not yet been redeemed in that period.



