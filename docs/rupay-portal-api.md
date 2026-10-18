# RuPay Select portal API notes

What we have learned about the RuPay Select portal's API, from requests captured in the browser and
calls made against it. The goal is to load the card list and each card's benefits from the
portal's own data instead of typing them in.

All findings are from observation (October 2026). The portal publishes no API documentation, so any
of this can change without notice.

- Website: `https://rupayselect.truztee.com`
- API base: `https://apirupayselect.truztee.com/api`
- Every call is `POST` with a JSON body.

## Response envelope

Every response has the same wrapper. `payload` is a **JSON-encoded string**, so parse it a second time:

```json
{
  "payload": "{\"code\":0,\"message\":\"...\",\"response\":[ ... ]}",
  "timestamp": "2026-10-09T19:38:28.4072200Z",
  "signature": "<base64>"
}
```

Inside `payload`:

- `code`: `0` means success and `1` means failure. It comes back as a number in some responses and a string in others.
- `message`: human-readable text. On failure it gives the reason.
- `response`: an array of results.

Text fields often contain HTML (`<p>`, `<ul>`, `&amp;`, `&nbsp;`). Strip it before storing.

The `signature` field was not checked; we don't use it.

## Authentication

Two groups of endpoints:

| Path prefix | Login needed | Notes |
|---|---|---|
| `/api/Public/...` | No | Works with no cookies. |
| `/api/Select/...` | Yes | Needs the `jwt` cookie and the `sessionid` header. |

- **`jwt` cookie:** the session token set when you log in to the website. It is a standard JWT whose
  claims include `loginId` (the user id, e.g. `26850`) and `exp`. It **expires 1 hour after login**.
- **`sessionid` header:** a value like `-1791574691517`, sent with every logged-in call. It matches the JWT's
  issue time in milliseconds, negated.
- **Headers sent:** `origin: https://rupayselect.truztee.com`, `referer: https://rupayselect.truztee.com/`,
  `content-type: application/json` and `x-requested-with: XMLHttpRequest`.

**Treat the `jwt` and `sessionid` as passwords.** Never commit them, and strip them from any cURL you share.

## Variants (card types)

The portal calls the variant `cardtype`.

| `cardtype` | Variant (our `card_variants.name`) | Cards in list (Oct 2026) |
|---|---|---|
| 41 | RuPay Select Debit Card | 58 |
| 42 | RuPay Select Credit Card | 23 |

The Platinum Debit and Platinum Credit numbers are not yet known.

## Endpoints

### 1. Card list for a variant: `Public/getCardNames` (no login)

```json
{ "cardtype": 41, "userid": 26850 }
```

`userid` was sent by the website. It is not needed to get results, as far as we can tell.

Each `response` item is one card:

| Field | Meaning |
|---|---|
| `id` | **Portal card id.** Used as `cardtypeid` / `cardid` in the other calls. E.g. Axis Bank RuPay Select Card = 95, PNB Salary Imperial RuPay Select Card = 151. |
| `cardname` | Full card name. Sometimes has leading or trailing spaces, or `&amp;`. Matches our catalog names once cleaned with `parseCardList` (`web/src/lib/card-list.ts`). |
| `cardtype` | The variant number, as a string (`"41"`). |
| `cstatus` | `0` for every card seen. Probably means active. |
| `cdate` | Date the card was added to the portal. |
| `CardImagePath`, `blogopath`, `bgImgPath` | Image URLs. |
| `cardtext` | HTML marketing text, the same for every card. |

All 58 debit and 23 credit names in `catalog-lists/` matched this endpoint one-to-one.

### 2. Benefit categories for a card: `Select/getCardServices` (login)

```json
{ "userid": 26850, "cardtypeid": 151, "cardbinid": 208 }
```

- `cardtypeid` is the **portal card id** from endpoint 1. The name is confusing: it is not the variant.
- `cardbinid` is explained below.

Each `response` item is one category, for example Travel, Spa Services or OTT Entertainment:

| Field | Meaning |
|---|---|
| `id` | **Service (category) id.** Used as `sid` / `id` below. E.g. Travel = 51, Spa Services = 35, OTT Entertainment = 47. |
| `servicename` | Category name. Maps to our `benefit_type`. |
| `description`, `ddescription` | HTML text. |
| `slogo` | Icon URL. |

If no categories apply, it returns `code: 1` with "No Services defined for the Selected Card".

### 3. Category header: `Select/getServiceMasterByCardBin` (login)

```json
{ "userid": 26850, "id": "51", "cardid": 151, "cardbinid": 208 }
```

Returns one item with the category's `heading` and `maintext` (HTML). It has no offer details, so we don't need it for the catalog.

### 4. Offers in a category: `Select/getUserDealsNew` (login)

```json
{ "cardtypeid": "151", "userid": 26850, "sid": "51", "cardbinid": "208" }
```

This is the call with real benefit data. Each `response` item is one offer. Useful fields, and
where they would go in our catalog (`benefit_catalog_versions`):

| Portal field | Example | Our column |
|---|---|---|
| `servicename` | `Spa Services` | `benefit_type` |
| `spname` | `Four Fountains De-Stress Spa` | `benefit_provider` |
| `productname` | `60 Minutes Swedish Body Massage` | `exact_benefit` |
| `cvalidity` | `Quarterly`, `Yearly` | `frequency` (`Yearly` → `Annual`) |
| `complimentaryCount` | `1` | `instance_count` |
| `netrate` / `userrate` | `1850.0` | `default_cash_value` |
| `startdate` / `enddate` | `2019-07-18` / `2026-12-31` | `effective_from` / `effective_to` |
| `productid` (or `id1`) | `150` | portal offer id, for matching on later re-imports |
| `id2` / `spid1` | `67` | portal provider id |

Other fields: `pdescription` (HTML offer text), `tandc` (HTML terms), `url_link`, `splogo`,
`dvalidity` / `discountCount` (discount-type offers; every offer seen was complimentary).
The `cname`, `cnumber`, `emailid` and `address` fields hold the provider's contact person. We don't store them.

**Quirks seen:**

- `productname` can disagree with `cvalidity`. "Kalyan Jewelley Offline- Half-Yearly" has `cvalidity: Quarterly`.
- Some categories say "Choose & redeem any **one** of the below offers listed" (seen on Spa Services, OTT
  Entertainment and Gym Access). That suggests the card gets **one** redemption per period across all offers
  in the category, not one per offer. The data has no field saying this; it is only in the
  `ddescription` HTML. **Not yet confirmed.**

### 5. Order / Booking Initiation: `Select/addUserTransaction` (login)

Called when the user clicks **Continue to Payment** in the redemption modal:

```json
{
  "tamount": 2,
  "pid": 62,
  "order_status": "Initiated",
  "cardtypeid": 151,
  "cardbinid": 208
}
```

- `tamount`: Nominal verification transaction amount (₹2).
- `pid`: The portal offer/benefit identifier (e.g. Cult.fit 3 Month = 62).
- `cardtypeid`: The portal card type id (e.g. 151 for PNB Salary Imperial).
- `cardbinid`: The card BIN id registered on the account (e.g. 208).
- `order_status`: Set to `"Initiated"`.

**Success Response:**
Returns an HTML form injection designed to redirect the browser to the payment gateway (CCAvenue / Razorpay):
```html
<form name="redirect" method="post" action="https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction">
  <input type="hidden" name="encRequest" value="..." />
  <input type="hidden" name="access_code" value="..." />
</form>
<script type="text/javascript">document.redirect.submit();</script>
```

**Rate Limit / 24-Hour Failure Response:**
The portal strictly limits each account to **one booking every 24 hours** across all card types:
```json
{
  "code": 1,
  "message": "Booking Limit Reached: You have already availed a booking in the last 24 hours. Try again after 11 Oct 2026 18:40 hrs.",
  "response": []
}
```
The exact unlock time is embedded in the message string in Indian Standard Time (`DD Mon YYYY HH:mm hrs`).

## Registered Cards & `cardbinid`

- **How registered cards appear in the UI:** In the portal interface, registered cards populate a `<select id="cardSelect">` dropdown where option values are formatted as `<cardtypeid>_<cardbinid>` (e.g. `"151_208"` for PNB Salary Imperial).
- **Entitlement boundary:** The RuPay portal **does not store card numbers or track cards by their last 4 digits**. It only associates the portal account with the bank card type (`cardtypeid`) and BIN (`cardbinid`). Benefit availability (e.g., 1 per quarter) is enforced per portal account per card type.
- **Physical card verification:** The actual physical card validation occurs downstream on the payment gateway, where the user enters the full 16-digit card number and completes an OTP authorization for the nominal ₹2 charge.

## Example: PNB Salary Imperial RuPay Select Card (portal id 151)

Fetched 2026-10-09 with `cardbinid` 208. There were 12 categories and 22 offers. All offers ran until 2026-12-31 and had a `complimentaryCount` of 1.

| Category | Provider | Offer | `cvalidity` | `netrate` |
|---|---|---|---|---|
| Entertainment | BookMyShow | Flat Rs. 250 Discount on Tickets(PNB) | Quarterly | 250 |
| Food Delivery | Swiggy One | 3 Month Membership | Yearly | 899 |
| Gym Access | Cult.fit | 3 Month Cure.Fit Live Subscription | Quarterly | 1299 |
| Health Check Up | SRL Diagnostics | Healthcare Test Package | Yearly | 999 |
| Health Check Up | Thyrocare | Aarogyam Basic 2 Package | Yearly | 899 |
| OTT Entertainment | Hotstar | 1 Year Super Subscription | Yearly | 1499 |
| OTT Entertainment | Prime Video | 12 Month Annual Subscription | Yearly | 1499 |
| Online Groceries | Big Basket | Flat Rs. 250 Off on Groceries Quarterly (BB) | Quarterly | 250 |
| Online Music | Gaana | Plus Annual Plan | Yearly | 299 |
| Online Pharmacy | Apollo Pharmacy | Apollo Pharmacy INR 250 Offline - Quarterly | Quarterly | 250 |
| Online Shopping | Decathlon | Decathlon - Quaterly | Quarterly | 500 |
| Online Shopping | Kalyan Jewellery | Kalyan Jewelley Offline- Half-Yearly | Quarterly | 2000 |
| Online Shopping | Myntra | Flat Rs. 500 Off - Quarterly | Quarterly | 500 |
| Online Shopping | Reliance Digital | Reliance  Digital Offline- Quarterly | Quarterly | 500 |
| Spa Services | AromaThai Day Spa | 60 Min Traditional Thai Body Dry Massage | Quarterly | 2700 |
| Spa Services | Four Fountains De-Stress Spa | 60 Minutes Swedish Body Massage | Quarterly | 1850 |
| Spa Services | HR Wellness Spa | Swedish Massage - 60 Mins | Quarterly | 2000 |
| Spa Services | Kairali Ayurvedic Centre | 50 Min Abhyangam 2 Hand Massage | Quarterly | 1500 |
| Spa Services | Lakme Salon | Beauty Care Services E-Gift Card- INR 1500 | Quarterly | 1500 |
| Spa Services | ODE Spa | Spa Treatment Coupon - INR 1500 | Quarterly | 1500 |
| Tax Compliance | TaxSpanner | TaxSpanner - INR 2950 | Yearly | 2950 |
| Travel | MakeMyTrip | 10% Instant Discount - Yearly | Yearly | 1500 |

## How we store it

- **Portal ids:** `card_variants.portal_card_type` holds the variant number (41, 42). `bank_card_types.portal_card_id`
  holds the portal card `id`. All 81 Select cards were linked on 2026-10-10.
- **"Redeem any one" rule (agreed 2026-10-10):** if a category's text says "any one" **and** it has more than one offer,
  it becomes **one** benefit, for example "Spa Services: Any one of 6 offers, Quarterly". Its offers are stored in
  `benefit_options`. On each tracked instance, the holder picks the offer they took (`benefit_instances.chosen_option_id`).
  Every other offer is its own benefit. Online Shopping, for example, stays as separate Myntra, Decathlon, Kalyan and Reliance benefits.
- **Value of a pick-one benefit:** before an offer is chosen it is the **highest** offer value. After that it is the chosen offer's value.
  An instance's own `cash_value` overrides both.
- **Dates:** each version's `effective_from` comes from the offer's `startdate`. **`effective_to` is left null**, because the
  portal's `enddate` is a promo window that rolls forward each year, not a real discontinuation (fixed 2026-10-10). A null
  `effective_to` means the benefit generates indefinitely, so imported cards no longer dead-end at 2026.

## Importer: `web/scripts/portal-import/run.ts`

Run it from `web/` with `DATABASE_URL` set to the target database. Nothing is written without `--write`; without it, the import
command prints what it would do.

```sh
npx tsx scripts/portal-import/run.ts fetch-cards <dir>            # public card lists, one file per variant
npx tsx scripts/portal-import/run.ts link-ids <dir> --write       # store portal card ids
# Save the session to files first (keeps the token off the command line):
#   printf %s '<jwt>' > /tmp/rupay.jwt ; printf %s '<sessionid>' > /tmp/rupay.sid
sh scripts/portal-import/fetch.sh <dir> <userid> 151 208
npx tsx scripts/portal-import/run.ts import <dir> --card 151            # preview
npx tsx scripts/portal-import/run.ts import <dir> --card 151 --write    # replace that card's benefits
```

- `fetch-benefits` waits 1 second between calls. It saves only the fields we use, and drops the provider contact details.
- `import` **refuses** if anyone already tracks or overrides that card's benefits. Replacing them would break their history,
  so updating a card in use needs a versioned update, which is not built yet.
- Keep `<dir>` outside the repo: it's working data, not source.

**Imported so far:** PNB Salary Imperial RuPay Select Card (151), on 2026-10-10. It has 16 benefits: 14 single offers, plus
Spa Services (6 options) and OTT Entertainment (2 options). This replaced the 14 benefits that came from the spreadsheet.

## Open questions

- Variant numbers for Platinum Debit and Platinum Credit.
- Registered cards source: Resolved. Cards registered to the logged-in account appear directly in the portal header's `<select id="cardSelect">` with value formatted as `<cardtypeid>_<cardbinid>` (e.g. `151_208`).
- Physical card binding: Resolved. The portal enforces entitlements at the `(portal_account, cardtypeid, quarter)` level rather than physical card number; actual card verification is handled by the payment gateway during the ₹2 charge.
- Whether "redeem any one" categories mean one redemption per category per period. We assume they do (see above).
- How to re-import a card that is already being tracked, by adding a new version instead of replacing it. (Current
  behaviour: `import` refuses such a card. On 2026-10-10, PNB 151's stale `effective_to` was cleared with a targeted SQL
  update instead, since it was already tracked.)
- What `netrate`, `publishedrate` and `userrate` mean when they differ. They were equal in every offer seen.

## Order Lifecycle, Transaction States & Cooldown Behavior

Findings from observing active order flow and payment gateway interactions on Truztee:

### 1. Order Creation (`POST /api/Select/addUserTransaction`)
When a user or automation clicks "Continue to Payment", Truztee calls `/api/Select/addUserTransaction` with:
- `cardtypeid`, `cardbinid`, `serviceid`, `productid`, `deliverymode`
- Response returns `{ "orderid": "RUPS-XXXXXXXX", "transactionid": "...", "sessionid": "..." }`

### 2. Transaction States
Visible in `https://rupayselect.truztee.com/#/myaccount` and `#/view-redeemed-offers`:

| State | Behavior & Trigger |
|---|---|
| **`Initiated`** | Order created; card redirected to Zaggle Propel. Truztee **temporarily locks the benefit and account for ~20 minutes**. |
| **`Success`** | 3DS authorization succeeds and Zaggle callback reaches Truztee. The voucher is confirmed. The coupon code (`ccode`) is populated either immediately or asynchronously within 24–48 hours, and a confirmation email is dispatched. |
| **`Failure`** | User explicitly cancels payment or the 3DS gateway returns a failure. |
| **Purged / Cleared** | If a transaction is left in `Initiated` (e.g. browser closed or 3DS interrupted), after 20 minutes with no bank settlement, Truztee either marks it as `Failure` or completely drops it from `#/myaccount`. Once expired/purged, the benefit immediately unlocks and becomes available for redemption again. |

### 3. Payment Gateway (Zaggle Propel)
- Gateway URL: `https://app.zagglepropel.com/checkout/<hash>`
- Charges a nominal ₹1 or ₹2 card authorization fee.
- Card fields `#green_edge_payment_cardNumber`, `#green_edge_payment_expiryDate`, `#green_edge_payment_cvv`, and `#green_edge_payment_cardholderName` require synthetic `input`/`change` events for React/AntD state binding.

