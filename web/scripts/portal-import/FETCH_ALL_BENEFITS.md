# Fetch Benefits for All Cards

This script iterates over all cards in the database and fetches their benefits from the RuPay portal API, automatically guessing the card BIN ID starting from the card's portal ID.

## Prerequisites

1. **Session credentials** from a logged-in RuPay portal session (expires after 1 hour):
   - JWT token (from `jwt` cookie)
   - Session ID (from `sessionid` header)

2. **Database URL** pointing to the target database

## Usage

```bash
# 1. Save credentials to files (keeps tokens off the command line)
printf %s '<your-jwt-token>' > /tmp/rupay.jwt
printf %s '<your-sessionid>' > /tmp/rupay.sid

# 2. Run the script
DATABASE_URL="..." PORTAL_JWT_FILE=/tmp/rupay.jwt PORTAL_SESSIONID_FILE=/tmp/rupay.sid \
  npx tsx scripts/portal-import/fetch-all-benefits.ts <output-dir>
```

## Example

```bash
DATABASE_URL="postgresql://..." \
  PORTAL_JWT_FILE=/tmp/rupay.jwt \
  PORTAL_SESSIONID_FILE=/tmp/rupay.sid \
  npx tsx scripts/portal-import/fetch-all-benefits.ts /tmp/rupay-benefits
```

## Output

For each card found with a portal ID:
- Tries cardbinid values starting from the card's portal ID
- Increments by 1 for each attempt (up to 50 attempts)
- **When successful** (finds categories), fetches all benefits and saves to `benefits-<card-id>.json`
- **When unsuccessful** (no valid cardbinid found after 50 attempts), reports the card and moves on

### Example output

```
📌 Card: PNB Salary Imperial RuPay Select Card (portal ID: 151)
  Trying cardbinid: 151...
  ✓ Found 12 categories!
    - Travel: 1 offers
    - Spa Services: 6 offers
    - Entertainment: 1 offers
    ...
  Saved to benefits-151.json
```

## Next Steps

After fetching benefits, import them into the catalog:

```bash
DATABASE_URL="..." npx tsx scripts/portal-import/run.ts import /tmp/rupay-benefits --card 151 --write
```

## Tips

- **Getting the JWT and sessionid:** Open the portal, log in, open DevTools (F12), go to Network tab, refresh, check cookies for `jwt`, and look for `sessionid` header
- **Session expiry:** The JWT expires 1 hour after login; run this script within that window
- **Rate limiting:** The script waits 1 second between API calls to be gentle to the portal
- **Resuming:** Already-fetched benefits (files that exist) are skipped automatically
