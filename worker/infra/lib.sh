#!/usr/bin/env bash
#
# Shared helpers for the worker's Google Cloud deployment scripts.
#
# Every script sources this, loads `config.env`, and gets a consistent
# environment, error handling, and a `--dry-run` mode that prints the gcloud
# commands instead of running them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/config.env}"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
  esac
done

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "error: $CONFIG_FILE not found." >&2
  echo "       Copy $SCRIPT_DIR/config.env.example to $CONFIG_FILE and edit it." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$CONFIG_FILE"; set +a

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"

# Run a command, or print it when --dry-run is set.
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# Require the gcloud CLI.
require_gcloud() {
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "error: gcloud CLI is not installed. See https://cloud.google.com/sdk/docs/install" >&2
    exit 1
  fi
}

# Require that the active gcloud account can act on the project.
# A dry run deliberately skips the account check: you read the plan *before*
# authenticating, and the plan must not need credentials to print.
require_auth() {
  require_gcloud
  if [[ "$DRY_RUN" == "1" ]]; then
    return
  fi
  if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
    echo "error: no active gcloud account. Run: gcloud auth login" >&2
    exit 1
  fi
}

# The Artifact Registry image reference for the current git revision.
image_ref() {
  local sha
  sha="$(git -C "$SCRIPT_DIR/../.." rev-parse --short HEAD 2>/dev/null || echo local)"
  echo "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/worker:${sha}"
}

# The `:latest`-style tag used when no git revision is available (local builds).
image_ref_latest() {
  echo "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/worker:latest"
}

# True when a Secret Manager secret already exists.
secret_exists() {
  [[ "$DRY_RUN" == "1" ]] && return 1
  gcloud secrets describe "$1" --project="$GCP_PROJECT_ID" >/dev/null 2>&1
}

# The set of --set-secrets flags for the job's secret references.
#
# ENCRYPTION_KEYRING is optional. It holds rotated encryption keys, and is
# only needed when a stored portal credential was encrypted with a key that
# is no longer the primary one — the keyring is tried in order, so a worker
# that only has the primary key cannot decrypt those.
secret_env_args() {
  local args="WORKER_DATABASE_URL=${SECRET_WORKER_DATABASE_URL}:latest"
  args+=",PORTAL_CREDENTIAL_ENCRYPTION_KEY=${SECRET_PORTAL_KEY}:latest"
  args+=",CAPSOLVER_API_KEY=${SECRET_CAPTCHA_SOLVER}:latest"
  args+=",GEMINI_API_KEY=${SECRET_GEMINI}:latest"
  # The shared solving service's key. Only mounted when the service is
  # configured, so a worker that does not use it needs no access.
  # CapMonster is optional: it is only mounted once the secret exists, so a
  # deploy does not break for a worker that has not set it up yet.
  if secret_exists "${SECRET_CAPTCHA_MONSTER:-CAPMONSTER_API_KEY}"; then
    args+=",CAPMONSTER_API_KEY=${SECRET_CAPTCHA_MONSTER:-CAPMONSTER_API_KEY}:latest"
  fi
  if secret_exists "${SECRET_CAPTCHA_YESCAPTCHA:-YESCAPTCHA_API_KEY}"; then
    args+=",YESCAPTCHA_API_KEY=${SECRET_CAPTCHA_YESCAPTCHA:-YESCAPTCHA_API_KEY}:latest"
  fi
  if [[ -n "${CAPTCHA_SERVICE_URL:-}" ]]; then
    args+=",CAPTCHA_SERVICE_KEY=${SECRET_CAPTCHA_SERVICE_KEY:-RECAPTCHA_SOLVER_KEY}:latest"
  fi
  if secret_exists "${SECRET_ENCRYPTION_KEYRING:-ENCRYPTION_KEYRING}"; then
    args+=",ENCRYPTION_KEYRING=${SECRET_ENCRYPTION_KEYRING:-ENCRYPTION_KEYRING}:latest"
  fi
  # The bare list. The caller adds the `--set-secrets=` flag.
  printf -- '%s' "$args"
}
