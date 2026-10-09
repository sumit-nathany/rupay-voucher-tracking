#!/bin/sh
# Print a card's benefits straight from the RuPay Select portal (read-only, writes nothing).
#   1. Save your logged-in session to files (keeps the token off the command line):
#        printf %s '<jwt cookie>'   > /tmp/rupay.jwt
#        printf %s '<sessionid>'    > /tmp/rupay.sid
#   2. Run:  sh scripts/portal-import/show-benefits.sh <cardid> <cardbinid> [--json|--raw]
# --raw prints every field of the first service and first offer (for discovering fields).
# <cardid> is the portal card id (e.g. 151). The jwt expires 1 hour after login.
# Everything printed comes from the portal API except the card name (read from our catalog DB).
# Needs curl, jq and DATABASE_URL (run from web/).
set -e
CARD="$1"; BIN="$2"; MODE="$3"
[ -n "$CARD" ] && [ -n "$BIN" ] || { echo "usage: show-benefits.sh <cardid> <cardbinid> [--json]" >&2; exit 1; }

JWT=$(tr -d '\n' < "${PORTAL_JWT_FILE:-/tmp/rupay.jwt}")
SID=$(tr -d '\n' < "${PORTAL_SESSIONID_FILE:-/tmp/rupay.sid}")
API="https://apirupayselect.truztee.com/api"

# The user id is the `loginId` claim inside the jwt (base64url middle part).
USERID="${PORTAL_USER_ID:-$(printf %s "$JWT" | cut -d. -f2 | tr '_-' '/+' | { cat; echo ===; } | base64 -d 2>/dev/null | jq -r '.loginId')}"
[ -n "$USERID" ] && [ "$USERID" != "null" ] || { echo "cannot read loginId from jwt; set PORTAL_USER_ID" >&2; exit 1; }

# POST a JSON body, unwrap the envelope (payload is a JSON string), print .response or fail with the message.
call() {
  curl -sS -X POST "$API/$1" \
    -H 'content-type: application/json' \
    -H 'origin: https://rupayselect.truztee.com' \
    -H 'referer: https://rupayselect.truztee.com/' \
    -H 'x-requested-with: XMLHttpRequest' \
    -H "sessionid: $SID" \
    -b "jwt=$JWT" \
    -d "$2" \
  | jq -c '.payload | fromjson | if (.code|tostring) == "0" then .response else error(.message) end'
}

# The card name is the only thing not from the portal API: the benefit calls don't return it,
# so it comes from our own catalog (bank_card_types.display_name, matched on portal_card_id).
# Needs DATABASE_URL; falls back to .env.local in the current directory.
if [ -z "$DATABASE_URL" ] && [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
CARD_NAME=$(npx tsx "$(dirname "$0")/card-name.ts" "$CARD")
[ -n "$CARD_NAME" ] || CARD_NAME="(not in our catalog)"

SERVICES=$(call Select/getCardServices "{\"userid\":$USERID,\"cardtypeid\":$CARD,\"cardbinid\":$BIN}")

# --raw: show every field of the first service and first offer, to see what else the API returns
# (e.g. whether it carries a card name). Provider contact fields are removed.
if [ "$MODE" = "--raw" ]; then
  echo "== getCardServices: all keys, then first item =="
  printf %s "$SERVICES" | jq -c '[.[] | keys[]] | unique'
  printf %s "$SERVICES" | jq '.[0]'
  FIRST=$(printf %s "$SERVICES" | jq -r '.[0].id')
  DEALS=$(call Select/getUserDealsNew "{\"cardtypeid\":\"$CARD\",\"userid\":$USERID,\"sid\":\"$FIRST\",\"cardbinid\":\"$BIN\"}")
  echo "== getUserDealsNew (service $FIRST): all keys, then first item =="
  printf %s "$DEALS" | jq -c '[.[] | keys[]] | unique'
  printf %s "$DEALS" | jq '.[0] | del(.cname, .cnumber, .emailid, .address)'
  exit 0
fi

ALL="[]"
for SID_ID in $(printf %s "$SERVICES" | jq -r '.[].id'); do
  DEALS=$(call Select/getUserDealsNew "{\"cardtypeid\":\"$CARD\",\"userid\":$USERID,\"sid\":\"$SID_ID\",\"cardbinid\":\"$BIN\"}")
  ALL=$(jq -c -n --argjson a "$ALL" --argjson b "$DEALS" '$a + $b')
  sleep 1 # be gentle with the portal
done

# Keep only the fields we use; drops the provider contact details.
ROWS=$(printf %s "$ALL" | jq -c 'map({
  category: .servicename, provider: .spname, offer: .productname, validity: .cvalidity,
  count: .complimentaryCount, value: .netrate, from: .startdate, to: .enddate, offerId: .productid })')

if [ "$MODE" = "--json" ]; then
  printf %s "$ROWS" | jq --arg id "$CARD" --arg bin "$BIN" --arg name "$CARD_NAME" \
    '{card: {id: ($id|tonumber), cardBinId: ($bin|tonumber), name: $name}, offers: .}'
else
  echo "Card: $CARD_NAME"
  echo
  printf %s "$ROWS" | jq -r '(["CATEGORY","PROVIDER","OFFER","VALIDITY","COUNT","VALUE","FROM","TO"] | @tsv),
    (.[] | [.category,.provider,.offer,.validity,.count,.value,.from,.to] | @tsv)' | column -t -s "$(printf '\t')"
  echo "$(printf %s "$ROWS" | jq length) offers in $(printf %s "$SERVICES" | jq length) categories (card $CARD, bin $BIN)"
fi
