#!/usr/bin/env bash
#
# Set every worker secret from an existing dotenv file, in one command.
#
#   worker/infra/set-secrets-from-env.sh <env-file> [SECRET_NAME=ENV_KEY ...]
#
# With no mapping, it sets the four the worker always needs, reading them
# from the given env file:
#
#   WORKER_DATABASE_URL              <- DATABASE_URL
#   PORTAL_CREDENTIAL_ENCRYPTION_KEY <- PORTAL_CREDENTIAL_ENCRYPTION_KEY
#   CAPSOLVER_API_KEY                <- CAPSOLVER_API_KEY
#   GEMINI_API_KEY                   <- GEMINI_API_KEY
#
# It also sets ENCRYPTION_KEYRING when the env file has one — the worker
# needs it to decrypt any credential encrypted with a rotated key.
#
# Values are piped straight into secret-set.sh, so they never appear in
# shell history, the process list, or this script's output.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

# A leading --dry-run is a flag, not a mapping.
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

# One or more env files, searched in order: the first file that has a key
# wins. The database URL and the encryption key live in the environment's own
# file, while the solver keys usually live in .env.local — so both are needed.
ENV_FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    *=*)
      break
      ;;
    *)
      ENV_FILES+=("$1")
      shift
      ;;
  esac
done

if [[ ${#ENV_FILES[@]} -eq 0 ]]; then
  echo "usage: $0 [--dry-run] <env-file> [<env-file> ...] [SECRET_NAME=ENV_KEY ...]" >&2
  echo "  e.g. $0 web/.env.prod web/.env.local" >&2
  exit 2
fi

for f in "${ENV_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: env file not found: $f" >&2
    exit 2
  fi
done

READ_ENV="node $(dirname "${BASH_SOURCE[0]}")/read-env.mjs"

# Default mapping: secret name -> key in the env file.
MAPPING=(
  "WORKER_DATABASE_URL=DATABASE_URL"
  "PORTAL_CREDENTIAL_ENCRYPTION_KEY=PORTAL_CREDENTIAL_ENCRYPTION_KEY"
  "CAPSOLVER_API_KEY=CAPSOLVER_API_KEY"
  "GEMINI_API_KEY=GEMINI_API_KEY"
  "ENCRYPTION_KEYRING=ENCRYPTION_KEYRING"
)
if [[ $# -gt 0 ]]; then
  MAPPING=("$@")
fi

echo "==> Reading secrets from ${ENV_FILES[*]}"

for pair in "${MAPPING[@]}"; do
  secret="${pair%%=*}"
  env_key="${pair#*=}"

  value=""
  source_file=""
  for f in "${ENV_FILES[@]}"; do
    candidate="$($READ_ENV "$f" "$env_key" 2>/dev/null || true)"
    if [[ -n "$candidate" ]]; then
      value="$candidate"
      source_file="$f"
      break
    fi
  done

  if [[ -z "$value" ]]; then
    echo "    skip ${secret}: ${env_key} is not set in any of ${ENV_FILES[*]}"
    continue
  fi

  echo "    setting ${secret} (from ${source_file})"
  if [[ "$DRY_RUN" == "0" ]]; then
    printf '%s' "$value" | gcloud secrets versions add "$secret" \
      --data-file=- \
      --project="$GCP_PROJECT_ID" >/dev/null
  fi
  unset value
done

echo
echo "Done. The job picks up the latest version of each secret on its next execution."
