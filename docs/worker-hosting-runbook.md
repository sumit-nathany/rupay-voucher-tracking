# Worker Hosting Runbook — Google Cloud Run

Operational guide for the automated ordering worker. The **decisions** behind
it are in `docs/automated-rupay-ordering-requirements.md` §8 and
`docs/automated-rupay-ordering-implementation-plan.md` §8; this file is the
"how do I actually operate it" companion.

> **Deploy with `worker/infra/` scripts, not by hand.** The scripts are
> idempotent, support `--dry-run`, and are the only thing that knows the
> resource names, the secret names, and the IAM bindings that must be right.

---

## 1. What runs where

| Piece | Where | Notes |
|---|---|---|
| Worker code | `worker/` | TypeScript. Bundled to a single file by esbuild. |
| Container image | Artifact Registry `worker` | Tagged with the commit SHA. |
| Runtime | Cloud Run Job `rupay-order-worker` | `asia-south1`. Max 1 instance, 1 task, no ingress. |
| Trigger | Cloud Scheduler `rupay-order-worker-hourly` | Hourly, `Asia/Kolkata`, created **paused**. |
| Secrets | Secret Manager | Four secrets, referenced by name. |
| Database | Supabase (`:6543` pooler) | The same database the web app uses. |

One execution = one batch sweep: evaluate every connected portal account,
order at most one benefit per eligible account, record the outcome, exit.

Each execution writes one `ordering_job_runs` row with the aggregate counts,
and each attempt it creates is linked to that row. The 24-hour cooldown lives
in the database (`app.portal_accounts.cooldown_until`), so an account that is
still cooling down is simply skipped — running more often cannot over-order.

---

## 2. One-time setup

### 2.1 Prerequisites

- `gcloud` CLI, authenticated against the account that owns the project.
- `docker` (only for a local build; CI can build instead).
- A GCP project with billing attached, in `asia-south1`.

### 2.2 Create the configuration

```bash
cd worker/infra
cp config.env.example config.env
$EDITOR config.env      # set GCP_PROJECT_ID, GCP_BILLING_ACCOUNT_ID, names
```

`config.env` is gitignored. It holds **no secret values** — only project
identifiers, resource names, and the *names* of the secrets.

### 2.3 Create the Google Cloud resources

```bash
worker/infra/setup.sh --dry-run     # read the plan first
worker/infra/setup.sh
```

This creates the project (if absent), enables the APIs, creates the Artifact
Registry repository, creates the two service accounts, grants the run account
access to the secrets, creates the (empty) secrets, and sets a $5/month
budget alert.

> The budget alert must exist **before** the scheduler is enabled —
> `REQUIREMENTS.md` §8 requires it, and the workload must not depend on
> free-tier availability for correctness.

### 2.4 Set the secret values

Each value is read from stdin, so it never lands in shell history or the
process list:

```bash
worker/infra/secret-set.sh WORKER_DATABASE_URL
worker/infra/secret-set.sh PORTAL_CREDENTIAL_ENCRYPTION_KEY --generate
worker/infra/secret-set.sh CAPSOLVER_API_KEY     # or NOPECHA_ / TWOCAPTCHA_
worker/infra/secret-set.sh GEMINI_API_KEY
```

> The encryption key **must match the environment whose database the job
> points at** — the key for the production database is not the key for
> pre-production. If the web app's `.env` for that environment also sets
> `ENCRYPTION_KEYRING` (rotated keys), give the worker the same value:
>
> ```bash
> worker/infra/secret-set.sh ENCRYPTION_KEYRING   # optional
> ```

| Secret | Value |
|---|---|
| `WORKER_DATABASE_URL` | The Supabase **transaction pooler** URL (`:6543`) for the environment the job targets. |
| `PORTAL_CREDENTIAL_ENCRYPTION_KEY` | The 32-byte base64 key that encrypts the portal credentials in the database. **Must match** the key the web app uses for that environment. |
| `CAPSOLVER_API_KEY` | One captcha solver key. The runner also accepts `NOPECHA_API_KEY` or `TWOCAPTCHA_API_KEY`. |
| `GEMINI_API_KEY` | Used to transcribe the audio challenge when no solver service is configured. |
| `ENCRYPTION_KEYRING` | **Optional.** A space-separated list of base64 keys, tried in order. Only needed if a stored portal credential was encrypted with a rotated key that is no longer the primary one — a worker holding only the primary key cannot decrypt those. The deploy scripts include it automatically when the secret exists. |

> Secret Manager's free allowance is six versions per secret per month. Each
> rotation creates a version. Rotate rarely, or delete old versions.

---

## 2.5 The short version

Once `gcloud auth login` has been done, the whole deployment is one command:

```bash
worker/infra/deploy-all.sh --dry-run web/.env.prod web/.env.local   # read it
worker/infra/deploy-all.sh web/.env.prod web/.env.local             # apply it
```

It runs setup → secrets → deploy → a plan-only validation run → and creates
the schedule **paused**. Read the validation output, then:

```bash
worker/infra/schedule.sh --enable
```

Env files are searched in order, first match wins. The first file is the
environment the job targets (database URL, encryption key, keyring); the
second supplies the solver keys, which usually live only in `.env.local`.

The individual steps below are what `deploy-all.sh` runs, and are useful on
their own when something needs re-running.

## 3. Deploy

### 3.1 From a workstation

```bash
worker/infra/deploy.sh --dry-run
worker/infra/deploy.sh
```

The build context is the **repository root** — the worker imports shared
domain code from `web/src`, so `docker build -f worker/Dockerfile .` is the
only supported form. The root `.dockerignore` keeps `.env*`, `node_modules`,
screenshots and — importantly — `worker/.browser-data/` (which holds live
portal sessions) out of the image.

### 3.2 From CI

`.github/workflows/worker-deploy.yml` builds and pushes the image on every
push to `main` that touches `worker/` or the shared `web/src` code it
imports. It authenticates with Workload Identity Federation, so no service
account key is ever stored in the repository.

To enable it, run `setup.sh` with `GITHUB_REPO=owner/repo` set, then add
these GitHub **Actions variables** (Settings → Secrets and variables →
Actions → Variables):

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | The project id |
| `GCP_REGION` | `asia-south1` |
| `WIF_PROVIDER` | `projects/<n>/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider` |
| `WIF_SERVICE_ACCOUNT` | `rupay-order-worker-ci@<project>.iam.gserviceaccount.com` |
| `AUTO_DEPLOY_WORKER` | `true` once the first manual deploy has been validated |

These must agree with `worker/infra/config.env` — the same values, entered
twice. The workflow reads the GitHub variables; the local scripts read
`config.env`.

CI updates the job's **template**; it never executes it, and it never touches
the Cloud Scheduler job. A running execution keeps the template it started
with, so a deploy can never interrupt an order in flight.

> Leave `AUTO_DEPLOY_WORKER` unset until the first manual deploy has been
> validated. With it unset, a push to `main` builds and pushes the image but
> leaves the deployed job on the old one — which means a bug fixed on `main`
> is **not** live until the job is updated. Set it to `true` once you trust
> the pipeline.

---

## 4. Validate before enabling the schedule

**Do not skip this.** The rollout sequence in
`docs/automated-rupay-ordering-implementation-plan.md` §11 requires the
schedule to be created paused and validated first.

```bash
# 1. Plan-only run: reports what it would order, places nothing.
worker/infra/run-now.sh --plan-only

# 2. Read the logs. Confirm:
#    - the job connected to the database
#    - the correct accounts were considered
#    - eligibility resolved as expected
#    - no secret, code, booking id, or card number appears in the output

# 3. Only then, a real run:
worker/infra/run-now.sh
```

The plan-only mode sets `USE_BROWSER_RUNNER=false`, which makes the worker
evaluate eligibility and report what it would order **without** reserving a
candidate, launching a browser, or writing an attempt. It uses the same
candidate selection a live run uses — the global ordering queue first, the
legacy per-account rules as a fallback — so the preview is accurate.

### 4.4 The captcha solver is required

The portal's login form is protected by a Google reCAPTCHA v2, so **every run
must solve it** — the portal's session token expires one hour after login, so
neither a fresh login nor a persisted browser profile avoids the challenge.
There is no way around it: the worker is not logged in when it starts.

The worker solves the challenge through a third-party solving service
(CapSolver, 2Captcha or NopeCHA — set whichever you have), and falls back to
the in-browser audio challenge transcribed with Gemini. The audio fallback
does **not** work from a Google Cloud IP: Google answers the audio request
with "Your computer or network may be sending automated queries", because
data-centre addresses are treated as automated traffic. A paid solver
service does not have that problem — it solves from its own infrastructure —
so it is the one that has to work.

Before the browser is opened, the worker checks that each configured solver
accepts its key and has balance, and fails immediately with a clear message
if none of them do. A run therefore costs seconds to diagnose, not ten
minutes per account.

To set a working key:

```bash
# in web/.env.local
CAPSOLVER_API_KEY=<your key>          # or NOPECHA_API_KEY / TWOCAPTCHA_API_KEY
worker/infra/set-secrets-from-env.sh web/.env.local
```

Then re-run the worker to confirm:

```bash
worker/infra/run-now.sh --no-logs
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"rupay-order-worker\"" \
  --project=rupay-order-worker-prod --limit=20 --format='value(textPayload)'
```

Look for `captcha solver capsolver: usable`.

### 4.5 Calendar dates

Eligibility is evaluated against the **Asia/Kolkata** calendar date, matching
the rest of the app (`web/src/lib/periods.ts` `today()`), not UTC. Between
00:00 and 05:30 IST the UTC date is the previous day, and an eligibility
check against the wrong date would order against the wrong entitlement
period. A regression test pins this.

### 4.1 Create the schedule (paused)

```bash
worker/infra/schedule.sh --dry-run
worker/infra/schedule.sh          # creates it and leaves it PAUSED
```

### 4.2 Enable it

```bash
worker/infra/schedule.sh --enable
worker/infra/schedule.sh --status
```

---

## 5. Operating it

### 5.1 Daily check

```bash
worker/infra/schedule.sh --status
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=rupay-order-worker" \
  --project="$GCP_PROJECT_ID" --limit=20 --format='value(timestamp,textPayload)'
```

The job run record is also visible in the Automation UI.

### 5.2 Kill switches

Narrowest first:

1. **Pause one portal account** in the Automation UI.
2. **Pause all automation** — `automation_settings.enabled = false` for the
   workspace. Checked before candidate selection and again immediately before
   portal submission.
3. **Pause the schedule** — `worker/infra/schedule.sh --disable`. The
   infrastructure-level fallback.

None of these delete attempts or alter existing tracker status or history.

### 5.3 Cost

| Item | Monthly |
|---|---|
| Cloud Run Jobs (CPU + memory) | $0.00 — inside the free allowance |
| Cloud Scheduler | $0.00 — inside the free allowance |
| Secret Manager | $0.00 — inside the 6-version allowance |
| Cloud Build | $0.00 — inside the 120 minutes/day allowance |
| Cloud Logging | $0.00 — inside the free allotment |
| Artifact Registry (~1.5 GB image) | ~$0.10–0.20 — 0.5 GB is free |
| **Total** | **~$0.20** |

An hourly run of about five minutes at 1 vCPU / 2 GiB consumes roughly 7,200
vCPU-seconds and 14,400 GiB-seconds per month — about 3% of Cloud Run's free
CPU allowance and 3% of its memory allowance.

---

## 6. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Job exits 1 immediately, "WORKER_DATABASE_URL … is required" | The secret is not wired to the job | `worker/infra/secret-set.sh WORKER_DATABASE_URL`, then re-run |
| Job exits 1, "every configured captcha solver rejected its key" | The solver key is invalid or the account has no balance | The login CAPTCHA cannot be solved without it. Get a working key and re-set it — see §4.4 |
| `401` / `403` reading a secret | The run service account lacks `secretmanager.secretAccessor` | Re-run `setup.sh`; it re-applies the binding |
| Job exits 0 but orders nothing | Every account is in its 24-hour cooldown, or automation is paused, or there is no eligible candidate | Read the log lines — each account says which. Check `automation_settings.enabled` |
| "challenge_required" / "needs_attention" | The captcha solve failed, or the portal wants an OTP | The runner stops before ordering. Re-authenticate the account in the UI. **OTP and device verification are never solved automatically.** |
| A run is still marked `submitting` | The worker died mid-flight | The next run recovers it: an expired `reserved` attempt becomes `cancelled`; an expired `submitting` attempt becomes `uncertain` and needs manual resolution in the UI. It is never retried automatically. |
| The image will not build | `web/src` is missing from the context | Build from the repository root: `docker build -f worker/Dockerfile .` |
| Chromium fails to launch in the container | Missing OS libraries or the sandbox | The image installs them via `playwright install --with-deps`. The runner adds `--no-sandbox` automatically when it is running as root on Linux. |
| A secret appears in the logs | A code path bypassed redaction | Capture the log entry, add a rule to `worker/src/lib/redact.ts`, and add a test to `worker/src/lib/redact.test.ts` |

### 6.1 Logs and secrets

Log redaction is applied once, at the console boundary
(`worker/src/lib/redact.ts`), so it covers everything the worker prints —
including output captured from the page's own console events. It removes
JWTs, RuPay order ids, cookie and authorization headers, labelled secrets,
card numbers, phone numbers, and email local parts.

It is a **safety net, not the primary defence**. The runner must still avoid
logging raw portal payloads; it no longer logs response bodies, only their
size. If you add a log line that could carry portal data, add a redaction
rule and a test at the same time.
