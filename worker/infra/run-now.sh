#!/usr/bin/env bash
#
# Execute the Cloud Run Job once, on demand, and tail its logs.
#
# This is the manual recovery path and the way to validate a deployment
# before enabling the schedule.
#
# Usage:
#   worker/infra/run-now.sh --plan-only   # report what it would order; place nothing
#   worker/infra/run-now.sh               # perform a real run
#   worker/infra/run-now.sh --no-logs     # do not tail logs

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

PLAN_ONLY=0
TAIL_LOGS=1
for arg in "$@"; do
  case "$arg" in
    --plan-only) PLAN_ONLY=1 ;;
    --no-logs) TAIL_LOGS=0 ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

if [[ "$PLAN_ONLY" == "1" ]]; then
  echo "==> Plan-only run (no orders will be placed)"
  # The job's environment is fixed at deploy time, so a plan-only run is a
  # separate execution of the same image with USE_BROWSER_RUNNER=false.
  ENV_OVERRIDE="USE_BROWSER_RUNNER=false"
else
  ENV_OVERRIDE="USE_BROWSER_RUNNER=true"
fi

echo "==> Executing ${JOB_NAME} (${ENV_OVERRIDE})"
run gcloud run jobs execute "$JOB_NAME" \
  --project="$GCP_PROJECT_ID" \
  --region="$GCP_REGION" \
  --wait \
  --set-env-vars="$ENV_OVERRIDE"

if [[ "$TAIL_LOGS" == "1" && "$DRY_RUN" == "0" ]]; then
  echo
  echo "==> Recent job logs"
  gcloud logging read \
    "resource.type=cloud_run_job AND resource.labels.job_name=${JOB_NAME}" \
    --project="$GCP_PROJECT_ID" \
    --limit=60 \
    --format='value(timestamp, severity, textPayload)' 2>/dev/null || true
fi
