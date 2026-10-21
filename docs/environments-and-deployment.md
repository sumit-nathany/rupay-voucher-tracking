# Environments and Deployment Guide

This guide describes the dual-environment topology (Production and Pre-Production) for the RuPay Voucher Tracking system, ensuring database schema and feature changes are validated in an isolated pre-production environment prior to production rollout.

---

## 1. Environment Topology

| Environment | Purpose | Target Database | Hosting / Deployment | Access Boundary |
|---|---|---|---|---|
| **Production (`prod`)** | Live user and family data, real encrypted vouchers | Supabase Production (`ap-south-1` Mumbai, port 6543 pooler) | Vercel Production (`bom1`, `main` branch) | Live workspace members |
| **Pre-Production (`preprod`)** | Testing new features, schema migrations, automated ordering worker tests | Supabase Pre-Prod (`ap-south-1` Mumbai, port 6543 pooler) | Vercel Preview (`bom1`, feature/PR branches) | Test accounts / staging |
| **Local / Test (`local`)** | Unit and domain testing | PGlite in-memory (vitest with all migrations replayed) | Local Node / Next.js dev server | Developer machine |

### Ordering worker

The automated ordering worker is **not** part of the Vercel deployment — it is a standalone container that runs on Google Cloud Run Jobs, triggered hourly by Cloud Scheduler in `Asia/Kolkata`. It is deployed per environment:

| Environment | Worker hosting | Trigger | Database |
|---|---|---|---|
| Production | Cloud Run Job `rupay-order-worker` in `asia-south1` | Cloud Scheduler, hourly | Supabase Production (`:6543` pooler) |
| Pre-Production | Cloud Run Job `rupay-order-worker-preprod` in `asia-south1` | Cloud Scheduler, hourly | Supabase Pre-Prod (`:6543` pooler) |
| Local | `npm run batch:local` / `npm run daemon:local` from `worker/` | Manual | Local `.env.local` database |

Each execution is a batch: it orders whatever is eligible right now, records the outcome, and exits. It holds no state between runs. See `docs/automated-rupay-ordering-requirements.md` §8 for the hosting requirements and `docs/automated-rupay-ordering-implementation-plan.md` §8 for the deployment details.

---

## 2. Provisioning Supabase Pre-Production

1. **Create Project**:
   - Go to [Supabase Dashboard](https://supabase.com/dashboard).
   - Create a new project named `rupay-voucher-tracking-preprod`.
   - Select region **Mumbai (`ap-south-1`)** to match deployment latency.
2. **Lockdown Auth**:
   - Navigate to **Authentication → Providers → Email**.
   - **Disable "Allow new users to sign up"** (Public self-signup is disabled per the app's security model; users are invite-only).
3. **Retrieve Credentials**:
   - **Database Connection String**:
     Navigate to **Project Settings → Database → Connection Pooling**.
     Select Mode: **Transaction**, Port: **6543**.
     Copy the connection string (format: `postgres://postgres.[REF]:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`).
   - **API Credentials**:
     Navigate to **Project Settings → API**.
     Copy `Project URL` (`NEXT_PUBLIC_SUPABASE_URL`) and `anon public` key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. **Generate Encryption Keys**:
   Pre-prod must use distinct encryption keys from production:
   ```bash
   # Generate 32-byte base64 keys
   node -e "console.log('VOUCHER_ENCRYPTION_KEY=' + crypto.randomBytes(32).toString('base64'))"
   node -e "console.log('PORTAL_CREDENTIAL_ENCRYPTION_KEY=' + crypto.randomBytes(32).toString('base64'))"
   ```

---

## 3. Vercel Environment Variable Scoping

Vercel allows variables to be scoped by environment: **Production**, **Preview**, and **Development**.

In your Vercel Project Settings (**Settings → Environment Variables**):

| Variable | Scope: Production | Scope: Preview (Pre-Prod) |
|---|---|---|
| `DATABASE_URL` | Production pooled connection string (port 6543) | Pre-Prod pooled connection string (port 6543) |
| `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase URL | Pre-Prod Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production Supabase anon key | Pre-Prod Supabase anon key |
| `VOUCHER_ENCRYPTION_KEY` | Production encryption key (base64) | Pre-Prod encryption key (base64) |
| `PORTAL_CREDENTIAL_ENCRYPTION_KEY` | Production encryption key (base64) | Pre-Prod encryption key (base64) |

> **How it works:**
> - When code is pushed to `main`, Vercel builds a **Production** deployment using the Production database.
> - When code is pushed to any feature branch (e.g. `feat/automated-rupay-ordering`), Vercel builds a **Preview** deployment using the Pre-Prod database.

---

## 4. Local Environment Configuration

Copy `.env.preprod.example` to create your local pre-prod configuration:

```bash
cp web/.env.preprod.example web/.env.preprod
```

Populate `web/.env.preprod`:
```ini
APP_ENV=preprod
PREPROD_DATABASE_URL=postgres://postgres.<preprod_ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
DATABASE_URL=postgres://postgres.<preprod_ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
NEXT_PUBLIC_SUPABASE_URL=https://<preprod_ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
VOUCHER_ENCRYPTION_KEY=<base64-key>
PORTAL_CREDENTIAL_ENCRYPTION_KEY=<base64-key>
```

---

## 5. Running Database Migrations

All migrations live in `web/drizzle/` and run against the Supavisor pooler with `prepare: false`.

### Applying to Pre-Production
```bash
cd web
npm run db:migrate:preprod
```
*Output safely masks database credentials and reports all applied migrations.*

### Applying to Production
```bash
cd web
npm run db:migrate:prod
```

> [!IMPORTANT]
> **Zero Production Schema Risk Protocol**:
> 1. Run migrations against **Pre-Production** first: `npm run db:migrate:preprod`.
> 2. Verify all features and views on the Vercel Preview deployment connected to Pre-Production.
> 3. Only run `npm run db:migrate:prod` after Pre-Production verification passes.

---

## 6. Seeding the Reference Catalog

Migrations create tables and seed default card variants (`0002_card_variants.sql`). To seed or update the shared reference catalog (`bank_card_types`, `benefits`, `benefit_catalog_versions`):

### Seeding Pre-Production
```bash
cd web
# Dry run first to preview insertions:
npm run db:seed:preprod -- /path/to/workbook.xlsx --dry-run

# Apply seed:
npm run db:seed:preprod -- /path/to/workbook.xlsx
```

### Seeding Production
```bash
cd web
npm run db:seed:prod -- /path/to/workbook.xlsx
```

---

## 7. PostgREST Lockdown Verification

All application tables live in the custom `app` schema (`schemaFilter: ["app"]`), isolating them from Supabase's public PostgREST API.

After applying migrations to a new Supabase project (Pre-Prod or Prod), verify the lockdown:

```bash
cd web
NEXT_PUBLIC_SUPABASE_URL=https://<preprod_ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key> \
bash src/db/verify-lockdown.sh
```

**Expected output:**
```
PASS: no app table is readable or insertable via PostgREST.
```

---

## 8. Ordering Worker Hosting (Google Cloud)

The ordering worker runs as a **Google Cloud Run Job** in `asia-south1` (Mumbai), triggered **hourly** by Cloud Scheduler in `Asia/Kolkata`. Rationale and the full decision are in `docs/review-history.md` (RH#15); the requirements are in `docs/automated-rupay-ordering-requirements.md` §8 and the deployment detail in `docs/automated-rupay-ordering-implementation-plan.md` §8.

### 8.1 Google Cloud project layout

| Resource | Name (prod) | Notes |
|---|---|---|
| Project | `rupay-order-worker-prod` | Separate project per environment — never share across prod/preprod |
| Region | `asia-south1` | Next to the Supabase Mumbai database |
| Artifact Registry | `worker` | Container images, tagged with the commit SHA |
| Cloud Run Job | `rupay-order-worker` | Max tasks 1, parallelism 1, no public ingress, bounded task timeout |
| Cloud Scheduler job | `rupay-order-worker-hourly` | Timezone `Asia/Kolkata`, hourly, OIDC → the Cloud Run Job `:run` API |
| Service account | `rupay-order-worker-run` | Secret Manager read + logging only. A second account, `rupay-order-worker-scheduler`, may run the job and has **no** Secret Manager or database access. |
| Secret Manager | `WORKER_DATABASE_URL`, `PORTAL_CREDENTIAL_ENCRYPTION_KEY`, captcha key, `GEMINI_API_KEY` | Worker database URL, portal credential key, and solver keys |
| Billing budget | $5/month | Alert before the scheduler is enabled |

### 8.2 Worker environment variables

The job reads these from Secret Manager. **Never** pass secret values as plain environment variables on the command line or bake them into the image.

| Variable | Secret? | Purpose |
|---|---|---|
| `WORKER_DATABASE_URL` | yes | Supabase connection string via the `:6543` transaction pooler |
| `PORTAL_CREDENTIAL_ENCRYPTION_KEY` | yes | Decrypts per-account portal credentials stored in the database |
| `CAPSOLVER_API_KEY` / `NOPECHA_API_KEY` / `TWOCAPTCHA_API_KEY` | yes | Captcha solving — only the one in use needs to be set |
| `GEMINI_API_KEY` | yes | Audio-challenge transcription fallback |
| `HEADLESS` | no | `true` in the deployed job |
| `USE_BROWSER_RUNNER` | no | `true` for a live run. `false` selects **plan-only** mode: the worker evaluates eligibility and reports what it would order, without reserving, launching a browser, or writing an attempt. Use it to validate a deployment before it is allowed near a live portal. |

### 8.3 Cost

Cloud Run Jobs allow 240,000 vCPU-seconds and 450,000 GiB-seconds free per month. An hourly run of about five minutes at 1 vCPU / 2 GiB uses roughly 3% of each allowance, so the only billable line is container image storage above the 0.5 GB free tier: **~$0.20/month**. Set a billing budget alert at $5/month before enabling the scheduler.

### 8.4 Kill switches

Ordered from narrowest to broadest:

1. Pause a single portal account in the Automation UI.
2. `automation_settings.enabled = false` — checked before candidate selection and immediately before portal submission.
3. Pause the Cloud Scheduler job — the infrastructure-level fallback.

None of these delete attempts or alter existing tracker status or history.
