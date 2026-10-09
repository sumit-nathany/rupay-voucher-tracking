#!/bin/sh
# Fetch one card's benefits without putting the token on a command line.
#   1. Save the session to files the script reads (replace the values):
#        printf %s 'eyJ...jwt...'      > /tmp/rupay.jwt
#        printf %s '-1791577212437'    > /tmp/rupay.sid
#   2. Run:  sh scripts/portal-import/fetch.sh <outdir> <userid> <cardid> <cardbinid>
# The files stay out of the repo; delete them when done.
set -e
OUT="$1"; USERID="$2"; CARD="$3"; BIN="$4"
: "${OUT:?usage: fetch.sh <outdir> <userid> <cardid> <cardbinid>}"
: "${BIN:?usage: fetch.sh <outdir> <userid> <cardid> <cardbinid>}"
export PORTAL_JWT_FILE="${PORTAL_JWT_FILE:-/tmp/rupay.jwt}"
export PORTAL_SESSIONID_FILE="${PORTAL_SESSIONID_FILE:-/tmp/rupay.sid}"
export PORTAL_USER_ID="$USERID"
exec npx tsx scripts/portal-import/run.ts fetch-benefits "$OUT" --card "$CARD" --bin "$BIN"
