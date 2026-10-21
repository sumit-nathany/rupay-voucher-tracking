#!/usr/bin/env bash
#
# Set (or rotate) the value of a Secret Manager secret the worker reads.
#
# The value is read from a local file or from stdin so it never appears in
# shell history or in the process list:
#
#   worker/infra/secret-set.sh WORKER_DATABASE_URL
#   cat value.txt | worker/infra/secret-set.sh WORKER_DATABASE_URL
#   worker/infra/secret-set.sh PORTAL_CREDENTIAL_ENCRYPTION_KEY --generate
#
# Each set creates a new secret VERSION. The free allowance is six versions
# per secret per month, so rotate rarely.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

SECRET_NAME="${1:-}"
GENERATE=0
for arg in "$@"; do
  case "$arg" in
    --generate) GENERATE=1 ;;
  esac
done

if [[ -z "$SECRET_NAME" ]]; then
  echo "usage: $0 <SECRET_NAME> [--generate]" >&2
  echo "       value is read from stdin, or generated with --generate" >&2
  exit 1
fi

if [[ "$GENERATE" == "1" ]]; then
  # 32 random bytes, base64 — the shape both encryption keys use.
  VALUE="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  echo "Generated a new 32-byte base64 value for ${SECRET_NAME}."
  echo "Store it safely — it cannot be recovered from Secret Manager."
elif [[ ! -t 0 ]]; then
  VALUE="$(cat)"
else
  read -r -s -p "Value for ${SECRET_NAME}: " VALUE
  echo
fi

if [[ -z "${VALUE:-}" ]]; then
  echo "error: refusing to set an empty secret." >&2
  exit 1
fi

echo "==> Adding a new version of ${SECRET_NAME}"
if [[ "$DRY_RUN" == "0" ]]; then
  printf '%s' "$VALUE" | gcloud secrets versions add "$SECRET_NAME" \
    --data-file=- \
    --project="$GCP_PROJECT_ID"
  echo "    done. The job picks up the latest version on its next execution."
else
  echo "  [dry-run] would add a version of $SECRET_NAME"
fi
