#!/usr/bin/env bash
# Verifies PostgREST cannot read or write any app table with the PUBLIC anon key.
# Run after EVERY migration (PLAN.md Security model #1), and against production.
#
#   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
#   [USER_JWT=<an authenticated user's access token>] \
#   bash src/db/verify-lockdown.sh
#
# For each table, in both the "app" profile and the default (public) profile:
# GET (read) and POST of an empty JSON object (cannot create a valid row, so it
# is safe even if the door is open; an open door answers 400/409 constraint
# errors rather than a permission/not-found error). A request passes ONLY if
# PostgREST answers 401, 403, 404 or 406 (no permission / schema not exposed /
# table not found). Any other status, including any 2xx or a 400/409, is a
# FAILURE. It also checks the OpenAPI document does not list the tables. If
# USER_JWT is set, everything is repeated as the `authenticated` role.
# Exit code 0 = locked down, 1 = something is exposed, 2 = bad usage.
#
# NOT yet run against a live project (none exists at time of writing).
set -u
: "${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?set NEXT_PUBLIC_SUPABASE_ANON_KEY}"
BASE="${NEXT_PUBLIC_SUPABASE_URL%/}/rest/v1"
TABLES=(workspaces workspace_members card_holders bank_card_types benefits
  benefit_catalog_versions system_admins cards card_benefit_overrides
  benefit_instances notification_preferences reminder_log)
fail=0

check() { # label key method profile table
  local label=$1 key=$2 method=$3 profile=$4 table=$5 code
  local args=(-s -o /dev/null -w '%{http_code}' -X "$method"
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $key")
  if [ "$method" = GET ]; then
    args+=(-H "Accept-Profile: $profile")
    code=$(curl "${args[@]}" "$BASE/$table?limit=1")
  else
    args+=(-H "Content-Profile: $profile" -H "Content-Type: application/json" -H "Prefer: return=minimal" -d '{}')
    code=$(curl "${args[@]}" "$BASE/$table")
  fi
  case "$code" in
    401|403|404|406) echo "ok    [$label] $method $profile.$table -> HTTP $code" ;;
    *) echo "FAIL  [$label] $method $profile.$table -> HTTP $code (possibly EXPOSED)"; fail=1 ;;
  esac
}

run_role() { # label key
  for t in "${TABLES[@]}"; do
    for profile in app public; do
      check "$1" "$2" GET "$profile" "$t"
      check "$1" "$2" POST "$profile" "$t"
    done
  done
  # OpenAPI root must not describe any app table.
  local spec; spec=$(curl -s -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $2" "$BASE/")
  for t in "${TABLES[@]}"; do
    if grep -q "\"/$t\"" <<<"$spec"; then
      echo "FAIL  [$1] OpenAPI lists /$t (EXPOSED)"; fail=1
    fi
  done
}

run_role anon "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
[ -n "${USER_JWT:-}" ] && run_role authenticated "$USER_JWT"

if [ "$fail" -eq 0 ]; then echo "PASS: no app table is readable or insertable via PostgREST."; else echo "LOCKDOWN VERIFICATION FAILED"; fi
exit "$fail"
