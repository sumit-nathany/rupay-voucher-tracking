#!/usr/bin/env bash
#
# One command for the whole deployment.
#
#   worker/infra/deploy-all.sh [--dry-run] <env-file> [<env-file> ...]
#
# Runs, in order:
#
#   1. setup.sh                — project, Artifact Registry, service accounts,
#                                secrets, budget alert
#   2. set-secrets-from-env.sh — the secret values, read from the env files
#   3. deploy.sh               — build the image, push it, update the job
#   4. run-now.sh --plan-only  — validate: reports what it would order and
#                                places nothing
#   5. schedule.sh             — create the hourly schedule, left PAUSED
#
# It deliberately does NOT enable the schedule. The schedule starts ordering
# on the live RuPay portal, and that is a decision to make after reading the
# plan-only output. Finish with:
#
#   worker/infra/schedule.sh --enable
#
# Env files are searched in order, first match wins. The database URL and
# the encryption key come from the environment the job targets; the solver
# keys are usually only in .env.local, so pass both:
#
#   worker/infra/deploy-all.sh web/.env.prod web/.env.local
#
# Prerequisite: `gcloud auth login` as an account that can create the project
# and attach a billing account to it.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_auth

# Accept the flag before or after the env files.
ENV_FILES=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) ENV_FILES+=("$arg") ;;
  esac
done

if [[ ${#ENV_FILES[@]} -eq 0 ]]; then
  echo "usage: $0 [--dry-run] <env-file> [<env-file> ...]" >&2
  echo "  e.g. $0 web/.env.prod web/.env.local" >&2
  echo "  The first file is the environment the job targets (database URL," >&2
  echo "  encryption key). The second supplies the solver keys if they are" >&2
  echo "  not in the first." >&2
  exit 2
fi

for f in "${ENV_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: env file not found: $f" >&2
    exit 2
  fi
done

SCRIPTS_DIR="$(dirname "${BASH_SOURCE[0]}")"

# Child scripts parse --dry-run themselves, so pass it through explicitly.
DRY_FLAG=""
if [[ "$DRY_RUN" == "1" ]]; then
  DRY_FLAG="--dry-run"
fi

step() {
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════════"
}

step "1/5  Google Cloud resources"
"$SCRIPTS_DIR/setup.sh" $DRY_FLAG

step "2/5  Secret values (from ${ENV_FILES[*]})"
"$SCRIPTS_DIR/set-secrets-from-env.sh" $DRY_FLAG "${ENV_FILES[@]}"

step "3/5  Build, push and update the Cloud Run Job"
"$SCRIPTS_DIR/deploy.sh" $DRY_FLAG

step "4/5  Validation run (plan only — places nothing)"
"$SCRIPTS_DIR/run-now.sh" --plan-only $DRY_FLAG

step "5/5  Hourly schedule (created PAUSED)"
"$SCRIPTS_DIR/schedule.sh" $DRY_FLAG

echo
echo "════════════════════════════════════════════════════════════"
echo "  Deployed. The schedule is PAUSED."
echo "════════════════════════════════════════════════════════════"
echo
echo "Read the validation output above. It lists what the worker would"
echo "order, and placed nothing."
echo
echo "When that looks right:"
echo "  worker/infra/schedule.sh --enable"
echo
echo "To stop it again, narrowest first:"
echo "  1. pause the portal account in the Automation UI"
echo "  2. automation_settings.enabled = false"
echo "  3. worker/infra/schedule.sh --disable"
