# Worker scheduler: current state and fix path

**2026-10-23 — status of the Google Cloud ordering worker's "wake-up" schedule**

## TL;DR

The worker is *designed* to wake up **hourly** (`SCHEDULE="every 1 hours"`,
`Asia/Kolkata`, Cloud Scheduler job `rupay-order-worker-hourly`). **It currently
never wakes up on its own** — the schedule cannot exist because the worker's GCP
project itself was never created or deployed. The only scheduled thing is the
manual trigger: `worker/infra/run-now.sh`.

## What was verified (read-only, 2026-10-23)

| Check | Result |
|---|---|
| `gcloud scheduler jobs list` — project `rupay-solver-prod` | The **Cloud Scheduler API is not enabled** there at all |
| `gcloud run jobs list` — project `rupay-solver-prod` | **No Cloud Run Jobs exist** |
| `gcloud run services list` — project `rupay-solver-prod` | Only `recaptcha-solver` (the external CAPTCHA solver service) + artifact repo `solver` |
| Looked-for project `rupay-order-worker-prod` | **Does not exist** |

### Naming clarification (not a bug)

`worker/infra/config.env` sets `GCP_PROJECT_ID=rupay-order-worker-prod`, and the
docs (`docs/environments-and-deployment.md` §8, `docs/worker-hosting-runbook.md`)
use the same project id. That is **consistent** — the confusion was mine. The
live GCP project (`rupay-solver-prod`) belongs to the **ReCaptcha Solver
service**, a separate concern the worker only *calls* via `CAPTCHA_SERVICE_URL`
(AGENTS.md: "the worker never solves CAPTCHAs itself").

- **Never deploy the worker into `rupay-solver-prod`** — mixing both on one
  project would blur billing and the service-account permission boundary the
  runbook depends on (scheduler SA has no secrets access, run SA has no
  database access).
- "Fix" therefore means **creating and deploying the worker project** as the
  runbook describes — not renaming anything.

### Is the missing schedule actually a problem?

No, while the automation feature is not in production use. The runbook
deliberately lands in this state: deploy → validate a manual run → then `--enable`
the schedule. Enabling the scheduler **before** that is explicitly forbidden by
the runbook and REQUIREMENTS §8 (budget alert must exist first).

The cost docs expect an hourly run's steady state to be ~$0.20/month, so the
hourly cadence itself is safe to keep once deployment happens.

## Fix path (when the scheduled runs are wanted)

Follow `docs/worker-hosting-runbook.md` §2–§4; the essential sequence:

1. **Config** — `config.env` already names the right new project id; verify
   `GCP_BILLING_ACCOUNT_ID` is set (it may still be REPLACE_ME).
2. **Create resources** — `worker/infra/setup.sh --dry-run`, then
   `worker/infra/setup.sh`. This runs in a project that does not yet exist:
   it creates the project, enables APIs, creates the Artifact Registry repo,
   the two service accounts, the empty secrets, and the **$5/month budget
   alert** (must exist before the scheduler goes on).
3. **Secrets** — `worker/infra/secret-set.sh` for `WORKER_DATABASE_URL`
   (production pooler `:6543` URL), `PORTAL_CREDENTIAL_ENCRYPTION_KEY`
   (**must match** the web app's production key),
   `RECAPTCHA_SOLVER_KEY`, `GEMINI_API_KEY`.
4. **Deploy + validate** — `worker/infra/deploy-all.sh web/.env.prod
   web/.env.local`: deploy, then a plan-only validation run; the schedule is
   created **PAUSED**.
5. **Enable the hourly schedule** — only after a manual run has been
   validated: `worker/infra/schedule.sh --enable`.
6. **CI (optional)** — if `setup.sh` ran with `GITHUB_REPO=`, add the
   Workload-Identity variables to GitHub Actions per runbook §3.2 and set
   `AUTO_DEPLOY_WORKER=true` after the first validated manual deploy.

### Verification commands (all read-only)

```bash
cd worker/infra
./schedule.sh --status                       # exists? paused or resumed?
gcloud run jobs list --project=rupay-order-worker-prod --region=asia-south1
gcloud run jobs list --project=rupay-solver-prod --format='table(name,region)'   # must stay empty
```

Each enabled run wakes hourly, ~5 minutes of work, max 1 instance, 30-minute
task timeout (`TASK_TIMEOUT=1800`).
