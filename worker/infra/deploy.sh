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

# Cloud Run runs x86-64 images. A build on Apple Silicon produces an arm64
# image, which the runtime refuses to start ("Application failed to start"),
# so the image is always cross-built for linux/amd64.
PLATFORM="linux/amd64"

if ! docker buildx version >/dev/null 2>&1; then
  echo "error: docker buildx is required to build a linux/amd64 image." >&2
  echo "       install it with: brew install docker-buildx" >&2
  echo "       and make sure the plugin directory is on the CLI's path:" >&2
  echo "         \"cliPluginsExtraDirs\": [\"/opt/homebrew/lib/docker/cli-plugins\"]" >&2
  exit 1
fi

if [[ "$DRY_RUN" == "0" ]]; then
  echo "==> Building for ${PLATFORM}"
  docker buildx build \
    --platform "$PLATFORM" \
    -f "$DOCKERFILE" \
    -t "$IMAGE" \
    -t "$(image_ref_latest)" \
    --push \
    .
else
  echo "  [dry-run] docker buildx build --platform $PLATFORM -f $DOCKERFILE -t $IMAGE --push ."
fi

echo "==> Updating Cloud Run Job '${JOB_NAME}'"

SECRET_ARGS="$(secret_env_args)"

# `jobs deploy` creates the job on first run and updates its template on
# subsequent runs. `jobs update` only works on an existing job.
run gcloud run jobs deploy "$JOB_NAME" \
  --project="$GCP_PROJECT_ID" \
  --region="$GCP_REGION" \
  --image="$IMAGE" \
  --cpu="$CPU" \
  --memory="$MEMORY" \
  --tasks="$MAX_INSTANCES" \
  --parallelism=1 \
  --task-timeout="${TASK_TIMEOUT}s" \
  --service-account="$RUN_SA@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="HEADLESS=true,USE_BROWSER_RUNNER=true,WORKER_PROFILE_DIR=/tmp/rupay-worker-profiles,CAPTCHA_PROVIDER=${CAPTCHA_PROVIDER:-service},CAPTCHA_SERVICE_URL=${CAPTCHA_SERVICE_URL:-}" \
  --set-secrets="$SECRET_ARGS"

echo
echo "Deployed. Validate it before enabling the schedule:"
echo "  worker/infra/run-now.sh --plan-only   # reports what it would order, places nothing"
echo "  worker/infra/run-now.sh               # performs a real run"
