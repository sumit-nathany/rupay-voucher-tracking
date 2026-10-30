#!/usr/bin/env bash
#
# View or tail logs for the Cloud Run ordering worker.
#
# Usage:
#   worker/infra/logs.sh           # show recent logs (default 50 entries)
#   worker/infra/logs.sh -f        # live tail / stream incoming logs
#   worker/infra/logs.sh --limit N # show last N log entries
#   worker/infra/logs.sh --list    # list recent job executions and status

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

FOLLOW=0
LIST=0
LIMIT=50

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--follow|--tail)
      FOLLOW=1
      shift
      ;;
    --list|--executions)
      LIST=1
      shift
      ;;
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ "$LIST" == "1" ]]; then
  echo "==> Recent executions for ${JOB_NAME} (${GCP_PROJECT_ID}):"
  gcloud run jobs executions list \
    --job="$JOB_NAME" \
    --project="$GCP_PROJECT_ID" \
    --region="$GCP_REGION" \
    --limit=10
  exit 0
fi

FILTER="resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${JOB_NAME}\" AND logName:\"projects/${GCP_PROJECT_ID}/logs/run.googleapis.com%2Fstdout\""

if [[ "$FOLLOW" == "1" ]]; then
  echo "==> Streaming live logs for ${JOB_NAME} (${GCP_PROJECT_ID}). Press Ctrl+C to exit..."
  gcloud beta logging tail "$FILTER" \
    --project="$GCP_PROJECT_ID" \
    --format="value(textPayload)"
else
  echo "==> Showing last ${LIMIT} logs for ${JOB_NAME} (${GCP_PROJECT_ID}):"
  gcloud logging read "$FILTER" \
    --project="$GCP_PROJECT_ID" \
    --limit="$LIMIT" \
    --order=asc \
    --format="value(textPayload)"
fi
