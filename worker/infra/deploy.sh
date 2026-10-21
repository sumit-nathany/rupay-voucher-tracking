#!/usr/bin/env bash
#
# Build the worker image, push it to Artifact Registry, and update the Cloud
# Run Job to run it.
#
# The job's *template* is updated here. Running jobs keep the template they
# started with, so an in-flight execution is never affected by a deploy.
#
# Usage:
#   worker/infra/deploy.sh --dry-run
#   worker/infra/deploy.sh
#
# Requires: docker, gcloud, and an active gcloud account with permission to
# push to Artifact Registry and update the job.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed." >&2
  exit 1
fi

IMAGE="$(image_ref)"
DOCKERFILE="worker/Dockerfile"

echo "==> Building ${IMAGE}"
echo "    (build context is the repository root: the worker imports web/src)"

if [[ "$DRY_RUN" == "0" ]]; then
  docker build -f "$DOCKERFILE" -t "$IMAGE" -t "$(image_ref_latest)" .
  echo "==> Pushing to Artifact Registry"
  docker push "$IMAGE"
  docker push "$(image_ref_latest)"
else
  echo "  [dry-run] docker build -f $DOCKERFILE -t $IMAGE ."
  echo "  [dry-run] docker push $IMAGE"
fi

echo "==> Updating Cloud Run Job '${JOB_NAME}'"

SECRET_ARGS="$(secret_env_args)"

run gcloud run jobs update "$JOB_NAME" \
  --project="$GCP_PROJECT_ID" \
  --region="$GCP_REGION" \
  --image="$IMAGE" \
  --cpu="$CPU" \
  --memory="$MEMORY" \
  --max-instances="$MAX_INSTANCES" \
  --parallelism=1 \
  --tasks=1 \
  --task-timeout="${TASK_TIMEOUT}s" \
  --service-account="$RUN_SA@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="HEADLESS=true,USE_BROWSER_RUNNER=true,WORKER_PROFILE_DIR=/tmp/rupay-worker-profiles" \
  --set-secrets="$SECRET_ARGS" \
  --no-invoker-iam-check

echo
echo "Deployed. Validate it before enabling the schedule:"
echo "  worker/infra/run-now.sh --plan-only   # reports what it would order, places nothing"
echo "  worker/infra/run-now.sh               # performs a real run"
