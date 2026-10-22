#!/usr/bin/env bash
#
# One-time Google Cloud setup for the ordering worker.
#
# Creates everything the worker needs, in dependency order:
#
#   1. the project and its APIs
#   2. Artifact Registry
#   3. two service accounts (run + schedule)
#   4. Secret Manager secrets (empty — values are set separately)
#   5. a billing budget with alerts
#
# Idempotent: re-running it updates what exists and skips what does not.
#
# Usage:
#   worker/infra/setup.sh --dry-run     # print the commands
#   worker/infra/setup.sh               # apply them
#
# See ../../docs/worker-hosting-runbook.md for the full procedure.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

echo "==> Project: ${GCP_PROJECT_ID} (${GCP_REGION})"

if [[ "$DRY_RUN" == "0" ]]; then
  echo "==> Ensuring the project exists"
  gcloud projects describe "$GCP_PROJECT_ID" >/dev/null 2>&1 || {
    echo "    creating project"
    # Billing is attached in a separate step: current gcloud versions no
    # longer accept --billing-account on `projects create`.
    gcloud projects create "$GCP_PROJECT_ID" --name="RuPay ordering worker"
  }
  gcloud config set project "$GCP_PROJECT_ID"

  echo "==> Attaching the billing account"
  gcloud billing projects link "$GCP_PROJECT_ID" \
    --billing-account="$GCP_BILLING_ACCOUNT_ID"
fi

echo "==> Enabling APIs"
for api in \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  billingbudgets.googleapis.com \
  iamcredentials.googleapis.com
do
  run gcloud services enable "$api" --project="$GCP_PROJECT_ID"
done

echo "==> Artifact Registry repository '${REPOSITORY}'"
if [[ "$DRY_RUN" == "0" ]]; then
  gcloud artifacts repositories describe "$REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" >/dev/null 2>&1 || {
    gcloud artifacts repositories create "$REPOSITORY" \
      --repository-format=docker \
      --location="$GCP_REGION" \
      --description="Ordering worker images" \
      --project="$GCP_PROJECT_ID"
  }
fi

echo "==> Secret Manager secrets (created empty; set their values with secret-set.sh)"
# The secrets must exist before the IAM bindings below — binding to a
# secret that does not exist yet fails with a 404.
for secret in "$SECRET_WORKER_DATABASE_URL" "$SECRET_PORTAL_KEY" "${SECRET_CAPTCHA_SERVICE_KEY:-RECAPTCHA_SOLVER_KEY}" "$SECRET_GEMINI" "${SECRET_ENCRYPTION_KEYRING:-ENCRYPTION_KEYRING}"; do
  if gcloud secrets describe "$secret" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    echo "    secret $secret already exists"
  else
    run gcloud secrets create "$secret" --replication-policy=automatic --project="$GCP_PROJECT_ID"
  fi
done

echo "==> Service accounts"
for sa in "$RUN_SA" "$SCHEDULER_SA"; do
  # Idempotent: creating a service account that already exists is a conflict,
  # so only create it when it is missing. `describe` needs the full email
  # address, not the short name.
  if gcloud iam service-accounts describe "${sa}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
      --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    echo "    service account $sa already exists"
  else
    run gcloud iam service-accounts create "$sa" \
      --display-name="Ordering worker: $sa" \
      --project="$GCP_PROJECT_ID"
  fi

  # The run service account may read the worker's secrets.
  if [[ "$sa" == "$RUN_SA" ]]; then
    for secret in "$SECRET_WORKER_DATABASE_URL" "$SECRET_PORTAL_KEY" "${SECRET_CAPTCHA_SERVICE_KEY:-RECAPTCHA_SOLVER_KEY}" "$SECRET_GEMINI" "${SECRET_ENCRYPTION_KEYRING:-ENCRYPTION_KEYRING}"; do
      run gcloud secrets add-iam-policy-binding "$secret" \
        --member="serviceAccount:${sa}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor" \
        --project="$GCP_PROJECT_ID"
    done
  fi

  # Both may act as the Cloud Run job's identity.
  run gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --member="serviceAccount:${sa}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.jobUser" \
    --project="$GCP_PROJECT_ID" 2>/dev/null || true
done

echo "==> Billing budget (${BUDGET_AMOUNT_USD} USD/month)"
if [[ "$DRY_RUN" == "0" ]]; then
  # Budgets live on the billing account, not the project, so both are needed.
  budget_id="$(gcloud billing budgets list \
    --billing-account="$GCP_BILLING_ACCOUNT_ID" \
    --filter="displayName='${BUDGET_DISPLAY_NAME}'" --format='value(name)' 2>/dev/null | head -1)"

  if [[ -z "$budget_id" ]]; then
    threshold_args=()
    IFS=',' read -ra _thresholds <<< "$BUDGET_ALERT_THRESHOLDS"
    for t in "${_thresholds[@]}"; do
      threshold_args+=(--threshold-rule="percent=${t}")
    done
    gcloud billing budgets create \
      --billing-account="$GCP_BILLING_ACCOUNT_ID" \
      --display-name="$BUDGET_DISPLAY_NAME" \
      --budget-amount="$BUDGET_AMOUNT_USD" \
      --filter-projects="projects/${GCP_PROJECT_ID}" \
      "${threshold_args[@]}"
  else
    echo "    budget already exists: $budget_id"
  fi
fi

echo
echo "Setup complete. Next:"
echo "  1. Set the secret values:        worker/infra/secret-set.sh"
echo "  2. Build and deploy the image:   worker/infra/deploy.sh"
echo "  3. Create the schedule (paused): worker/infra/schedule.sh"
echo "  4. Validate a single run:        worker/infra/run-now.sh"

# ── Workload Identity Federation for GitHub Actions ──────────────────────────
# Lets the CI workflow authenticate to Google Cloud without holding a service
# account key. Optional: only needed if you want CI to deploy the image.
if [[ -n "${GITHUB_REPO:-}" ]]; then
  echo
  echo "==> Workload Identity Federation for ${GITHUB_REPO}"
  WIF_POOL="github-actions-pool"
  WIF_PROVIDER="github-actions-provider"

  run gcloud iam workload-identity-pools create "$WIF_POOL" \
    --project="$GCP_PROJECT_ID" \
    --location=global \
    --display-name="GitHub Actions pool"

  run gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
    --project="$GCP_PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$WIF_POOL" \
    --display-name="GitHub Actions provider" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"

  # The CI identity needs to push images and update the job — not read secrets.
  CI_SA="rupay-order-worker-ci"
  run gcloud iam service-accounts create "$CI_SA" \
    --display-name="Ordering worker CI" \
    --project="$GCP_PROJECT_ID"

  run gcloud iam service-accounts add-iam-policy-binding "$CI_SA" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/${GCP_PROJECT_ID}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}" \
    --project="$GCP_PROJECT_ID"

  run gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
    --member="serviceAccount:${CI_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer" \
    --project="$GCP_PROJECT_ID"

  run gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --member="serviceAccount:${CI_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.jobUser" \
    --project="$GCP_PROJECT_ID"

  echo
  echo "Set these GitHub repository variables (Settings → Secrets and variables → Actions):"
  echo "  GCP_PROJECT_ID        = ${GCP_PROJECT_ID}"
  echo "  GCP_REGION            = ${GCP_REGION}"
  echo "  WIF_PROVIDER          = projects/${GCP_PROJECT_ID}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
  echo "  WIF_SERVICE_ACCOUNT   = ${CI_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
fi
