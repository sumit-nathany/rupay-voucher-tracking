#!/bin/sh
# Wrapper: set PORTAL_JWT in your shell, then run `sh scripts/portal-import/fetch-126.sh`.
exec npx tsx scripts/portal-import/run.ts fetch-benefits \
  /private/tmp/claude-504/-Users-snathany-sumit-workdir-Personal-rupay-voucher-tracking/aa4e66e6-43ad-4674-8340-a22b82109e88/scratchpad/portal/import \
  --card 126 --bin 171
