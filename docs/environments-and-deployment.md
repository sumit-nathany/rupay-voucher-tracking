# Environments and Deployment Guide

This guide describes the dual-environment topology (Production and Pre-Production) for the RuPay Voucher Tracking system, ensuring database schema and feature changes are validated in an isolated pre-production environment prior to production rollout.

---

## 1. Environment Topology

| Environment | Purpose | Target Database | Hosting / Deployment | Access Boundary |
|---|---|---|---|---|
| **Production (`prod`)** | Live user and family data, real encrypted vouchers | Supabase Production (`ap-south-1` Mumbai, port 6543 pooler) | Vercel Production (`bom1`, `main` branch) | Live workspace members |
| **Pre-Production (`preprod`)** | Testing new features, schema migrations, automated ordering worker tests | Supabase Pre-Prod (`ap-south-1` Mumbai, port 6543 pooler) | Vercel Preview (`bom1`, feature/PR branches) | Test accounts / staging |
| **Local / Test (`local`)** | Unit and domain testing | PGlite in-memory (vitest with all migrations replayed) | Local Node / Next.js dev server | Developer machine |

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
