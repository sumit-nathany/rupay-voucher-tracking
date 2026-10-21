#!/usr/bin/env bash
#
# Create or update the Cloud Scheduler job that triggers the worker.
#
# The schedule is created PAUSED. Enable it only after a manual run has been
# validated (see the rollout sequence in
# docs/automated-rupay-ordering-implementation-plan.md §11).
#
# Usage:
#   worker/infra/schedule.sh --dry-run
#   worker/infra/schedule.sh              # create/update, left paused
#   worker/infra/schedule.sh --enable     # create/update and resume
#   worker/infra/schedule.sh --disable    # pause (the infrastructure kill switch)
#   worker/infra/schedule.sh --status     # show the current state

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

# Default to the create/update plan. `--status` is an explicit choice.
ACTION="plan"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --enable) ACTION="enable" ;;
    --disable) ACTION="disable" ;;
    --status) ACTION="status" ;;
  esac
done

SCHEDULER_URL="https://${GCP_REGION}-run.googleapis.com/v2/projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/jobs/${JOB_NAME}"

case "$ACTION" in
  status)
    gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" \
      --location="$GCP_REGION" --project="$GCP_PROJECT_ID" \
      --format='yaml(schedule,timeZone,state,lastAttemptTime)' 2>/dev/null \
      || echo "schedule '$SCHEDULER_JOB_NAME' does not exist yet"
    exit 0
    ;;
  disable)
    gcloud scheduler jobs pause "$SCHEDULER_JOB_NAME" \
      --location="$GCP_REGION" --project="$GCP_PROJECT_ID"
    echo "Scheduler paused. The worker will not run."
    exit 0
    ;;
esac

echo "==> Cloud Scheduler job '${SCHEDULER_JOB_NAME}'"
echo "    schedule:  ${SCHEDULE}"
echo "    timezone:  ${SCHEDULE_TIMEZONE}"
echo "    invokes:   ${JOB_NAME} (region ${GCP_REGION})"

if [[ "$DRY_RUN" == "0" ]]; then
  if gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" \
      --location="$GCP_REGION" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    echo "    updating existing schedule"
    gcloud scheduler jobs update "$SCHEDULER_JOB_NAME" \
      --location="$GCP_REGION" \
      --project="$GCP_PROJECT_ID" \
      --schedule="$SCHEDULE" \
      --time-zone="$SCHEDULE_TIMEZONE" \
      --uri="$SCHEDULER_URL" \
      --http-method=POST \
      --oauth-service-account-email="$SCHEDULER_SA@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
      --description="Hourly sweep of the RuPay ordering worker"
  else
    echo "    creating schedule"
    gcloud scheduler jobs create "$SCHEDULER_JOB_NAME" \
      --location="$GCP_REGION" \
      --project="$GCP_PROJECT_ID" \
      --schedule="$SCHEDULE" \
      --time-zone="$SCHEDULE_TIMEZONE" \
      --uri="$SCHEDULER_URL" \
      --http-method=POST \
      --oauth-service-account-email="$SCHEDULER_SA@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
      --description="Hourly sweep of the RuPay ordering worker"
  fi

  # The job's own service account must be allowed to invoke it.
  gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --member="serviceAccount:${SCHEDULER_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.jobUser" \
    --project="$GCP_PROJECT_ID" 2>/dev/null || true

  if [[ "$ACTION" == "enable" ]]; then
    gcloud scheduler jobs resume "$SCHEDULER_JOB_NAME" \
      --location="$GCP_REGION" --project="$GCP_PROJECT_ID"
    echo "    schedule RESUMED — the worker now runs ${SCHEDULE}."
  else
    gcloud scheduler jobs pause "$SCHEDULER_JOB_NAME" \
      --location="$GCP_REGION" --project="$GCP_PROJECT_ID"
    echo "    schedule PAUSED. Validate with run-now.sh, then: schedule.sh --enable"
  fi
else
  echo "  [dry-run] would create/update the schedule in $GCP_REGION"
fi
