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

ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "usage: $0 <env-file> [SECRET_NAME=ENV_KEY ...]" >&2
  echo "  e.g. $0 web/.env.prod" >&2
  exit 2
fi
shift

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

echo "==> Reading secrets from ${ENV_FILE}"

for pair in "${MAPPING[@]}"; do
  secret="${pair%%=*}"
  env_key="${pair#*=}"

  value="$($READ_ENV "$ENV_FILE" "$env_key" 2>/dev/null || true)"
  if [[ -z "$value" ]]; then
    echo "    skip ${secret}: ${env_key} is not set in ${ENV_FILE}"
    continue
  fi

  echo "    setting ${secret}"
  if [[ "$DRY_RUN" == "0" ]]; then
    printf '%s' "$value" | gcloud secrets versions add "$secret" \
      --data-file=- \
      --project="$GCP_PROJECT_ID" >/dev/null
  fi
  unset value
done

echo
echo "Done. The job picks up the latest version of each secret on its next execution."
