# RuPay Voucher Tracker — Implementation Plan

> **Status:** Architecture spec v8.0 (Phase 0) — **agreed** between this session and the external review session after five rounds of review (see Review Feedback.md through Review Feedback v5.md). v6 fixed round 3's version-selection and withdrawal-sweep precision bugs and added composite foreign keys. v7 fixed two remaining generation/withdrawal bugs (the sweep is now one stateless eligibility rule run in the same transaction as generation, rather than separate one-way triggers with undefined combinations; generation now also requires the chosen version to have actually started, so a future-dated version no longer shows as "Withdrawn"), corrected the NULL-frequency import default so it no longer forks fake benefit identities, and reworked the Excel-seeding section against the live spreadsheet, which has changed since earlier rounds — replacing hard-coded counts with an instruction to recompute at seed time. v8 fixes the last seeding bug: `instance_count` is now the most-common row count per (card, quarter), not the max (the earlier rule would have tripled the sheet's one Monthly benefit); quarter-grained Monthly rows are skipped at import instead of colliding with live generation's per-month instances; and each catalog version's `effective_from`/`effective_to` are derived from the quarters a benefit identity actually appears in, not naively from the sheet's CY column, which previously would have made every version active for the whole year regardless of when it actually started. `Sold` is modeled as a `Coupon Redeemed` variant via `sold_for`, not a new status; doubled rows are treated as entry errors by default and deduped via a most-common-count rule, not assumed to be real.
> **Last updated:** 2026-10-09
> **Audience:** Human reviewers and AI agents implementing the build phases
>
> **Requirements:** Product “what” lives in **[REQUIREMENTS.md](./REQUIREMENTS.md)**. This file is the architecture and build “how”. If the two conflict, REQUIREMENTS.md wins — stop and reconcile with the user rather than silently picking one.
>
> **Scope decisions (current):**
> 1. Product stays **RuPay-program-scoped** (branding, `rupay_booking_id` field). Not generalized to other card networks.
> 2. **Multi-tenant architecture is built in full for v1; signup itself is invite-only**, via **Supabase Auth's built-in admin-invite-by-email** (no custom invite-code table or redeem page — see Review Feedback v2.md #7 and Auth section below). Workspaces, the shared catalog, and tenant isolation are all built as if for a public product — only the "anyone can sign up" door is closed, until the shared catalog covers enough cards that a stranger isn't met with an empty catalog and no way to add their own. See REQUIREMENTS.md §3/§4.
> 3. **The benefit catalog (bank + card type → benefits) is shared, global reference data**, not something each user defines per card. Benefits have a **stable identity across versions** (not just effective-dated rows) so a wording/count correction doesn't fork into a duplicate entitlement. **A frequency change creates a new benefit identity**, never a new version of the same one (see Database section and REQUIREMENTS.md §5).
> 4. **No "household" concept.** A card holder (Papa, Mummy, Sumit, Neha, …) is a **free-form label** denoting who holds a card — a relative, a friend, or the workspace owner themselves. Holders are not user accounts and imply no family/household relationship. The tenant boundary is the **workspace**: one user's tracking space, containing their holder labels, cards, and benefit tracking state.
> 5. **Reminders, ordering browser-automation, and pre-public-launch privacy/legal work (privacy notice, account deletion, rate limiting) are later phases**, not v1 — see REQUIREMENTS.md §9. Historical Excel *personal-history* import is optional; **shared-catalog seeding is required**, since v1's "add a card from the catalog" flow needs real rows to pick from — see REQUIREMENTS.md §3/§10.
> 6. **Tenant isolation is defense-in-depth, not RLS alone.** Supabase's default grants expose every table in `public` to the anon/authenticated roles via PostgREST **even with RLS off and even with application-layer scoping in place** — this must be explicitly locked down in Phase 1 (see Security model), not treated as "RLS doesn't matter because the app scopes its own queries." Composite foreign keys, a shared query-scoping helper, and per-action tests remain the defense against a bug in the app's own logic; locking down PostgREST exposure is the defense against the database being reachable directly at all.
> 7. **Benefit instance generation is fully automatic and runs on every view of a period** (not a manual "Open Quarter" button, and not only on the *first* view of a not-yet-generated period) — see REQUIREMENTS.md §5 and the Database section's generation rules, which also bound which periods can be generated at all.

---

## Deployment targets (where this runs)

| What | Where | Region |
|------|-------|--------|
| Next.js app + API | **Vercel** (Hobby, free) | Functions region `bom1` (Mumbai) |
| PostgreSQL + Auth | **Supabase** (free tier) | `ap-south-1` (Mumbai) |
| Source repo | **GitHub** (private) | n/a |

Default URL is `<project>.vercel.app`; a custom domain is optional for v1. Pick Mumbai regions at project creation — they cannot be changed later on Supabase. (Cron and Resend are added in the later Reminders phase — see REQUIREMENTS.md §9 — at which point a custom domain also becomes relevant, since Resend requires one to email anyone other than the account owner.)

---

## Excel reference (optional, not a build gate)

> **Per REQUIREMENTS.md §3/§10: importing this data is explicitly not required for v1.** It is kept here only as a useful reference for seeding the shared `bank_card_types` / `benefit_catalog` tables with real-world examples, and optionally as a personal-data seed for the system admin's own workspace once the app exists. No phase is blocked on this import succeeding, and the verification checklist below is a nice-to-have sanity check, not an acceptance gate.

| Item | Value |
|------|-------|
| **Primary file path** | `/Users/snathany/sumit_workdir/Personal/rupay-voucher-tracking/Gift Voucher Tracker.xlsx` |
| **Alternate path (Downloads)** | `/Users/snathany/Downloads/Gift Voucher Tracker.xlsx` *(may not always be present)* |
| **Google Sheets copy** | `/Users/snathany/My Drive/Gift Voucher Tracker.gsheet` |
| **Target sheet tab** | `Rupay Select` *(not "Rupay Select Voucher" — that tab does not exist)* |
| **Header row** | Row 1 (freeze pane at A2) |
| **Data rows** | The sheet changes over time (194 rows with Person or Card populated as of 2026-10-09, up from 139 at an earlier check, and now spans Q1–Q4 rather than Q1–Q3) — **recompute the row count and row range at seed time; do not treat any number here as fixed.** |
| **Separator rows** | A handful of rows between groups are not fully blank (some carry CY/Quarter values). Filter on *Person or Card populated* — never on "row is empty", and never assume specific row numbers, since they shift as the sheet grows. |

> ⚠️ **The workbook contains live gift-card codes and PINs** (this tab and especially `Sold Vouchers` / `Available Vouchers`). The `.xlsx` must be gitignored in Phase 1 and must never be committed or uploaded anywhere.

### Excel column mapping (16 columns → data model)

> Note: the Excel sheet has no concept of a reusable "bank card type" — every row is already a specific user's card. Importing it means first deriving a `bank_card_types` row, a `benefits` row (stable identity), and that benefit's first `benefit_catalog_versions` row per distinct (Card type, Benefit Type, Benefit Provider, Exact Benefit, Frequency) combination — frequency is part of the key, operating at the shared card-type level, not per physical card (see the dedup rule below) — **then** pointing the imported `cards`/`benefit_instances` rows at those. This is a reasonable one-time seeding exercise for the shared catalog, not a reason to keep catalog per-workspace.

| Excel column | DB target | Notes |
|--------------|-----------|-------|
| CY | used only to resolve the Quarter column into an actual date, not as `effective_from` directly (see rule 4 and the corrected CY/effective_from mapping below) | Stored as **float** (`2026.0`) in Excel — cast to int |
| Quarter | drives `benefit_instances.period_*` | `Q1`–`Q4` present (the set of quarters present grows as the sheet does); see entitlement periods below |
| Person | `card_holders.name` | **A label, not a person-entity**: Papa, Mummy, Sumit, Neha |
| Card | `bank_card_types` (bank_name, card_type) + `cards.display_name` | Card **names** on the sheet outnumber actual `bank_card_types` rows — see the dedup rule below (Review Feedback v3.md #8): a bank+card-type **product**, not a physical card, is the shared catalog unit. As of 2026-10-09 the sheet's card names collapse to 5 types (BOI Debit ×4 physical cards, PNB Imperial ×3) — recompute at seed time rather than assuming a fixed count. |
| Benefit Type | `benefit_catalog_versions.benefit_type` | 13 types; Excel dropdown |
| Benefit Provider | `benefit_catalog_versions.benefit_provider` | 15 in data + Hotstar in dropdown (unused); **`'Cult.fit '` has a trailing space in both data and dropdown** |
| Exact Benefit | `benefit_catalog_versions.exact_benefit` | e.g. "Voucher worth ₹500"; **NULL on some Golf rows** (count changes as the sheet grows — recompute at seed time) |
| Frequency | `benefit_catalog_versions.frequency` | Annual, Quarterly, 6 months, Monthly; **NULL on some rows** — see import rule 7 for how NULLs are resolved |
| Order Status | `benefit_instances.order_status` | values in dropdown, including the live sheet's `Sold` (mapped to `Coupon Redeemed` + `sold_for` — see rule 5a); **NULL on the same Golf rows as Exact Benefit** |
| Sold for | `benefit_instances.sold_for` | sparse column; most cells are `''` |
| Cash Value | `benefit_instances.cash_value` | sparse column; most cells are `''` |
| Order Date | `benefit_instances.order_date` | sparse column; real datetimes only, no string dates |
| Expiry Date | `benefit_instances.expiry_date` | sparse column; most cells are `''` |
| Rupay Booking ID | `benefit_instances.rupay_booking_id` | two formats seen: `RUPS-XXXXXXXX` and `RUPSNNNNNNN` |
| Code | `benefit_instances.code_encrypted` | **Sensitive.** Some values are "16-digit number + space + 6-digit PIN" in one cell |
| Comments | `benefit_instances.comments` | Unused in current data |

### Excel data validations (reference values for the shared catalog, not per-workspace)

**Benefit Type** (column E, 13 values):
```
Cab Services, Entertainment, Food Delivery, Golf Program, Gym Access,
Health Checkup, Online Groceries, OTT Entertainment, Spa Services,
Online Shopping, Online Pharmacy, Online Music, Tax Compliance
```

**Benefit Provider** (column F, 16 values — trim `'Cult.fit '`; Hotstar appears only in the dropdown, never in data):
```
Amazon Prime, Big Basket, BookMyShow, Cult.fit, Four Fountains, Swiggy One,
Thyrocare, Uber, Decathlon, Kalyan Jewellers, Myntra, Reliance Digital,
TaxSpanner, Hotstar, Apollo Pharmacy, Gaana
```

**Order Status** (column I): originally 4 values (`Coupon Received`, `Not Ordered`, `Ordered but Coupon not received`, `Coupon Redeemed`). As of 2026-10-09 the sheet also uses a 5th value, **`Sold`**, on several rows (Review Feedback v4.md #4). **Decided (2026-10-09):** `Sold` is not a new schema status — it's a variant of `Coupon Redeemed` (the coupon was used, just handed off to someone else who paid for it). Import maps a `Sold` row to `order_status = 'Coupon Redeemed'` plus its `sold_for` amount, matching the schema's existing `sold_for` field; no change to the `order_status` CHECK constraint. Recompute the live value set at seed time rather than assuming exactly these 5.

The app adds a further status, **`Skipped`**, that does not exist in Excel (see UI section).

### Import normalization rules (optional seeding script — apply in this order)

1. **Row filter:** import a row only if Person or Card is populated. Never filter on "fully blank", and never hard-code a row count — recompute from the sheet at seed time (it has grown from 139 to 194 rows between two checks already).
2. **Trim** every string cell (fixes `'Cult.fit '`).
3. **Empty string `''` → NULL** for all cells (pervasive in sold_for / cash_value / order_date / expiry_date).
4. **CY float → int** (`2026.0` → `2026`). **CY is not used directly as `effective_from`.** Seeding `effective_from = <CY>-01-01` for every version would make every identity active for the whole year regardless of which quarter it actually first appears in — concretely, it would make the BookMyShow fork (Quarterly and Monthly) both active all year, so BOI Credit cards would get a Quarterly BookMyShow instance **and** monthly ones every period, and would wrongly claim PNB Imperial benefits are active in Q1 even though the sheet has no PNB Imperial rows before Q2 (Review Feedback v5.md final item). **Fix:** set each version's `effective_from` to the **start of the first quarter that benefit identity actually appears in**, for that card type (e.g. PNB Imperial benefits → Q2 start, not CY's Jan 1). For an identity that was superseded by a fork (BookMyShow's Quarterly identity, replaced by Monthly from Q2 onward), also set `effective_to` to the **end of the last quarter it appears in** (31 Mar for the Q1-only Quarterly identity). Every other version keeps `effective_to` NULL.
5. **NULL Order Status → `'Not Ordered'`** (applies to the Golf Program rows that have no status set — identify by the NULL, not by a fixed row list, since row numbers shift as the sheet grows).
5a. **`'Sold'` Order Status → `'Coupon Redeemed'`**, with `sold_for` set from the row's "Sold for" column — `Sold` is a hand-off variant of "coupon used," not a separate schema status (decided 2026-10-09; see Entitlement periods / status model note).
6. **NULL Exact Benefit → copy of Benefit Type** (same Golf rows; `exact_benefit` is NOT NULL in schema).
7. **NULL Frequency → take the frequency from other rows sharing the same `(card type, benefit type, provider, exact benefit)`** that do have one filled in; default to `'Quarterly'` only if no row for that combination has a frequency at all. A flat NULL→Quarterly default would fork a fake second identity for any benefit that is genuinely Annual/6-months/Monthly but merely has a blank Frequency cell on some rows — on the current sheet this hits three BOI Debit benefits (Amazon Prime "12 Month Annual Subscription", Thyrocare "Aarogyam Basic 2 Package", Four Fountains "60 Minutes Swedish Body Massage"), each of which would otherwise seed as both Annual **and** Quarterly (Review Feedback v4.md #3). Fork into two separate benefit identities only when two rows for the same combination have two **explicit**, differing frequencies (the BookMyShow case).
8. **Derive the `bank_card_types` key from the Excel Card name by stripping the trailing physical-card identifier** (e.g. the last digits in parentheses, like `(7825)`) — `PNB Imperial (7825)`, `(1746)`, and `(5110)` are three physical cards, all currently held by Sumit (corrected from an earlier, now-stale claim that they belonged to three different people — Review Feedback v4.md #4), but **one `bank_card_types` product**, and must seed exactly one catalog row with one set of benefits, not three duplicated copies (Review Feedback v3.md #8). The three physical cards still each get their own `cards` row (referencing that one shared type) and their own `benefit_instances`. **This type-level dedup only reduces the catalog (`benefits`/`benefit_catalog_versions`) row count — `benefit_instances` are per physical card and are not reduced by it** (Review Feedback v4.md #4); only the entitlement-period merge in rule 11 reduces instance counts.
9. **Catalog dedup key:** `(bank_card_type, benefit_type, benefit_provider, exact_benefit, frequency)` — **frequency is now part of the key** (a frequency change is a new benefit identity, not a variant to resolve away — Review Feedback v3.md #8 corrects the prior rule, which both excluded frequency from the key *and* said to "resolve to Monthly," contradicting Phase 2's own two-identities rule). The one known BookMyShow conflict (Quarterly in Q1, Monthly from Q2 onward — the live sheet now shows it Monthly in Q2 through Q4) seeds as **two separate `benefits` rows** — do not resolve it to a single frequency.
10. **`instance_count`** = the **most common** row count per (physical card, quarter) for that benefit, across every physical card sharing the card type — **not the maximum** (Review Feedback v5.md #1 corrects an earlier, wrong version of this rule, which treated a Monthly benefit's quarter-rollup repeats as a legitimate `instance_count` of 3; that's backwards — `instance_count` is per *entitlement period*, and a Monthly benefit's period is one month, so `instance_count = 3` on it would mean 3 per month, 9 per quarter, not 3 per quarter. On the live sheet the only Monthly benefit, BOI Credit's BookMyShow, appears once per quarter, never 3 times; Big Basket's genuine 3-per-quarter is a *Quarterly* benefit, which is exactly what this field is for). Rows beyond the most-common count in a given quarter are entry duplicates: keep the one with the most advanced status (rule 11's tie-break). This single rule handles both Neha's Big Basket (3 in every quarter → `instance_count = 3`) and the Mummy/BOI-Debit-(3688) Q3 duplicates (1 everywhere else → the doubled rows are duplicates, `instance_count = 1`) without the script needing to special-case either one by name.
11. **Entitlement-period dedup for instances** (see next section): rows whose frequency spans multiple quarters (Annual, 6 months) are merged into one instance per period. Winner = row with the most advanced status; ties keep the earliest quarter's row. **Verify lossless at seed time** (confirm every discarded duplicate row is `Not Ordered` with no tracking fields) rather than assuming a specific discard count, since the sheet's row count changes over time.
12. **Codes:** encrypt before insert (see Security). Never print or log code values, including in import output and errors.
13. **Set each imported card's `tracking_from` to the start date of its earliest imported period** (not the import run date) — otherwise later automatic generation treats the card as new from today and never backfills the periods its imported history already covers (Review Feedback v4.md #9).
14. Script must be **idempotent**: re-running updates rather than duplicates (upsert on the UNIQUE constraints below).

### Entitlement periods (core domain concept)

A benefit's **entitlement period** is the window in which one instance of it can be ordered, derived from `frequency`:

| Frequency | Periods per year | `period_label` examples | `order_deadline` |
|-----------|------------------|------------------------|------------------|
| Quarterly | 4 | `2026-Q3` | period end (Mar 31 / Jun 30 / Sep 30 / Dec 31) |
| Annual | 1 | `2026` | Dec 31 |
| 6 months | 2 (H1 = Q1+Q2, H2 = Q3+Q4) | `2026-H1`, `2026-H2` | Jun 30 / Dec 31 |
| Monthly | 12 | `2026-07` | last day of month |

`order_deadline = period_end` in every case.

**Why this exists:** the Excel sheet repeats Annual and 6-month benefits inside *every* quarter's block. Example: Gaana "Plus Annual Subscription" on PNB 7825 appears as `Coupon Redeemed` in Q2 **and** `Not Ordered` in Q3 — one entitlement, two rows. Importing per-quarter naively double-counts annual benefits and fires false "order lapse" reminders for benefits already ordered. Instances are therefore keyed by entitlement period, not by quarter.

**Monthly rows: skip at import, let generation create them.** The sheet's Excel `Monthly` rows (BOI Credit's BookMyShow, one per quarter it appears in) are quarter-grained in the sheet — one row standing in for a whole quarter, not one row per month. Importing such a row as a single quarter-spanning instance would collide with live generation: its `period_start` (the quarter's first day, e.g. 1 Jul) is identical to the `period_start` of the July monthly instance generation creates, so both would share the same `(card_id, benefit_id, period_start, instance_number)` key, and `ON CONFLICT DO NOTHING` would silently drop whichever one loses the race — in practice, July never appears (Review Feedback v5.md #2). **Fix: don't import quarter-grained Monthly rows at all** — on the current sheet all of them are `Not Ordered` with no tracking data, so simply skip them; the live system's automatic generation then creates the correct true per-month instances on its own. If a Monthly row is ever found carrying real tracking data (order date, code, etc.), map it to the specific month containing its order date instead of skipping it.

**Instance generation (replaces the old manual "Open Quarter" action — see Database section below for the full rules, including the view-to-periods expansion and bounding rules a naive "generate for any viewed period" approach is missing):** generation is automatic, runs on every view of a period (not just the first), and is bounded to periods the card has actually existed for.

### Verification checklist for agents (post-normalization numbers — computed from the sheet, if seeding from it)

> **The sheet itself changes over time and has already drifted since earlier reviews** (139 → 194 rows, Q1–Q3 → Q1–Q4, a new `Sold` status, two new BOI Debit cards, a corrected PNB Imperial holder count — Review Feedback v4.md #4). **No row counts, instance counts, or benefit counts are hard-coded below.** Every number in this checklist must be computed fresh from the live sheet at the time the seed script actually runs — treat any number seen in an earlier draft of this doc, or in review feedback, as a stale snapshot, never a target to hit.

- [ ] Card holders and physical cards counted directly from the sheet; `bank_card_types` row count is **strictly fewer** than the physical-card count wherever multiple holders/cards share one card product (e.g. PNB Imperial's 3 physical cards → 1 shared type)
- [ ] Every seeded benefit (stable identity) has a `benefit_catalog_versions` row; the BookMyShow frequency conflict (Quarterly in Q1, Monthly from Q2 onward) is seeded as **two separate benefit identities** — but a merely-blank Frequency cell on an otherwise-Annual/Monthly/6-months benefit is NOT seeded as a second identity (corrected NULL-frequency rule, Review Feedback v4.md #3)
- [ ] No quarter-grained Monthly rows are imported as single instances — they're skipped at import (generation creates the real per-month instances itself); a Monthly row with genuine tracking data is instead mapped to the specific month of its order date (Review Feedback v5.md #2)
- [ ] Benefit instance count = live row count − merged Annual/6-months duplicates (entitlement-period dedup, rule 11) — **type-level catalog dedup (rule 8) does not reduce this number**, since instances are per physical card (Review Feedback v4.md #4); each instance references a `benefit_id` (not a specific version)
- [ ] Status counts computed fresh from the live sheet; `Sold` rows counted under `Coupon Redeemed` (with `sold_for` set), per the 2026-10-09 decision that `Sold` is not a separate schema status
- [ ] PNB Imperial's physical cards each have their own `cards` row and instances, but share one `bank_card_types` row and one set of `benefits`
- [ ] `instance_count` is derived as the **most common** row count per (physical card, quarter), not the max (rule 10) — the Mummy BOI Debit (3688) Q3 duplicate rows (Amazon Prime, Thyrocare, Cult.fit, Uber) dedupe to `instance_count = 1`, and the sheet's one Monthly benefit (BOI Credit BookMyShow) is **not** given `instance_count = 3` just because it recurs across a quarter's months
- [ ] Booking IDs, codes, expiry dates preserved from the source rows; codes stored encrypted
- [ ] No instance exists twice for the same `(card_id, benefit_id, override_id, period_start, instance_number)`
- [ ] Blank/partial separator rows not imported

---

## Product summary

A **multi-tenant web app**, architected for eventual public use but **gated to invite-only signup for v1** (see Auth section), to track RuPay card benefits across card holders, cards, and entitlement periods — from "not ordered" through "coupon redeemed/sold." Each invited user gets their own workspace. Knowing *which* benefits apply to a card is not manual data entry: the app resolves it from a shared, centrally-maintained catalog of (bank, card type) → benefits.

**This is NOT a spreadsheet clone.** It is a task-oriented native web app: dashboard, benefit cards, detail drawers, and admin for holders/cards/catalog overrides.

Each invited user gets their own **workspace** with their own holder labels and cards; the benefit catalog itself is shared across all workspaces (see Database section). Email reminders and ordering browser-automation are explicitly later phases — see REQUIREMENTS.md §9 — v1 is invite-gated signup, card tracking, and automatic period-aware instance generation.

### Core user questions the app answers

- What can I order **right now**, this quarter?
- What's expiring this week?
- What hasn't been ordered yet for this period?
- Show me everything for a specific holder or card.

---

## UI recommendation

### Design philosophy

| Principle | Implementation |
|-----------|----------------|
| Home = action | Dashboard shows expiring, un-ordered, and lapsing items |
| Benefits = cards | Grouped by status, not a 16-column table |
| Detail on demand | Slide-over drawer for codes, dates, booking IDs |
| Hierarchy via nav | Holders → Cards → Benefits |
| Status as workflow | Stepper (Ordered → Received → Redeemed), reversible |
| Sensitive data | Codes masked by default; reveal/copy on tap |
| Mobile first-class | Fully responsive; using a coupon happens on a phone at the store/gym |
| Admin separate | Catalog editor is settings, not daily use |

### Pages

| Page | Purpose |
|------|---------|
| **Dashboard** | Action items, summary stats, per-holder progress |
| **Benefits** | Filterable benefit cards grouped by status; viewing a period's benefits triggers that period's instance generation automatically — no separate action |
| **Benefit detail** | Drawer: full fields, status stepper, contextual actions |
| **Holders** | List + detail (cards and benefits for selected period) |
| **Cards** | List + progress bar per card per period; add a card by picking a bank + card type from the shared catalog |
| **Catalog overrides** | Per-card `add`/`suppress` corrections on top of the shared catalog (on/off, no admin curation power) — no manual generation button here either |
| **Settings** | Auth. Notification preferences are a later phase (REQUIREMENTS.md §9) — no UI here for v1, not even unwired |

A separate, **system-admin-only** shared catalog curation surface (bank card types, benefits, versions, effective-dating) is not a user-facing page — see Phase 3 and REQUIREMENTS.md §10. ("System admin" here means the person curating the shared catalog, not any individual's own workspace — every invited user "owns" a workspace, which is a different and unrelated sense of "owner.")

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  RuPay Tracker          [Q3 2026 ▾]  [Sumit ▾]    ⚙️   │
├──────────┬──────────────────────────────────────────────┤
│ Dashboard│                                              │
│ Benefits │   Main content area                          │
│ Holders  │                                              │
│ Cards    │                                              │
│ Catalog  │                                              │
└──────────┴──────────────────────────────────────────────┘
```

Sidebar navigation on desktop; **collapses to a bottom tab bar on mobile**. All pages must be usable at 375 px width. `[Sumit ▾]` is the holder filter.

**Quarter selector semantics:** selecting `Q3 2026` shows quarterly/monthly instances of that quarter **plus a pinned "Annual & half-yearly" section** (those instances belong to the year/half, not a quarter, and appear under every quarter of their period with their single shared status).

### Status workflow

`Not Ordered` → `Ordered but Coupon not received` → `Coupon Received` → `Coupon Redeemed`

- **Backward transitions are allowed** (mis-taps happen); the drawer offers "revert to previous status".
- **`Skipped`** (app-only status): marks a benefit deliberately not ordered this period. Excluded from reminders and from the dashboard's attention lists. Reversible. Without this, a workspace with many not-ordered items (e.g. one seeded from a personal-history import spanning several already-closed quarters) would make "needs attention" permanently noisy.
- **`Withdrawn`** (app-only, system-driven, not directly user-settable): the bank dropped this benefit, or the user suppressed it / turned off their own `add` override, while the instance was still `Not Ordered`. Excluded from attention lists. Automatically reversed back to `Not Ordered` if the benefit becomes active again — see Database section's generation/withdrawal rules and REQUIREMENTS.md §5/§6.

### Status colors

| Status | Color |
|--------|-------|
| Not Ordered | Gray |
| Ordered but Coupon not received | Amber |
| Coupon Received | Blue |
| Coupon Redeemed | Green |
| Skipped | Slate (muted) |
| Withdrawn | Slate, struck-through or otherwise visually distinct from Skipped (different meaning: system-driven, not user choice) |

### Voucher code display

- Masked by default (`•••• •• 82`); reveal fetches the decrypted code via a server action on explicit tap.
- Many codes are **"card number + PIN"** in one value (space-separated). When a space is present, render as two labeled fields (Number / PIN) with separate copy buttons, plus "copy both".

### What we explicitly do NOT build (v1)

- 16-column editable table, blank separator rows, all-fields-at-once views, dropdown-per-row, Excel freeze-pane header
- Billing, pricing, ToS — no monetization in v1
- Open public signup — v1 is invite-only (see Auth section); the multi-tenant architecture is built in full, but the signup door itself is closed until later (REQUIREMENTS.md §3)
- Reminders, ordering browser-automation (later phases — REQUIREMENTS.md §9)
- A manual "Open Quarter" or "generate" button of any kind — instance generation is always automatic (see Database section)

---

## Database

### Engine: PostgreSQL (hosted via Supabase, `ap-south-1`)

Portable, relational, standard SQL. No vendor-specific features required (PG15+ assumed for `UNIQUE NULLS NOT DISTINCT`).

### Schema (12 tables)

> **Revised across four review rounds** (Review Feedback.md, Review Feedback v2.md, Review Feedback v3.md, Review Feedback v4.md). Round 1 fixed two real bugs: (1) the uniqueness constraint meant to make instance generation idempotent never actually fired, because Postgres treats NULLs as distinct by default; (2) a catalog version change (even a typo fix) created a brand-new `catalog_id`, which meant re-running instance generation would duplicate an already-ordered annual/half-yearly entitlement. The fix is a **stable benefit identity** (`benefits`) separate from its **versions** (`benefit_catalog_versions`). Round 2 dropped the `invite_codes` table in favor of Supabase's built-in invite-by-email (see Auth section), removed all `auth.users` foreign keys so local-Postgres development still works, added `cards.tracking_from` to bound instance generation, and tightened the version-selection and withdrawal rules. Round 3 found that round 2's version-selection rule broke mid-period visibility (fixed below), added three composite foreign keys that turn previously app-layer-only invariants into real constraints (benefit/card-type matching, override/card matching, version/benefit matching), and fixed the withdrawal sweep's precision (unexpired periods only, one "active" definition, one timezone). Round 4 rewrote the sweep as one stateless eligibility rule run in the same transaction as generation (replacing separate one-way triggers that left combinations undefined), gated generation on the chosen version having actually started, and corrected the Excel-seeding section's facts against the live, since-changed spreadsheet — see the Instance generation and Withdrawal sweep notes below.

```sql
-- Layer 0: Tenant. A workspace is one user's tracking space (SaaS-ready foundation).
-- No household/family semantics anywhere.
CREATE TABLE workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
  -- ON DELETE behavior for a workspace and everything under it is not yet
  -- defined (no FK currently specifies ON DELETE CASCADE/RESTRICT). This is
  -- fine for v1 (invite-only, no user-facing delete-my-account flow), but
  -- MUST be decided before public signup opens — see REQUIREMENTS.md §3 and
  -- Review Feedback.md #12.
);

-- Maps an authenticated Supabase Auth user to a workspace. Keyed on the
-- stable Supabase auth.users.id, NOT email — emails can change, and
-- email+Google sign-in can otherwise produce two identities for one address
-- (Review Feedback.md #8). NO foreign key to auth.users(id): that table only
-- exists on a real Supabase project, and omitting the FK keeps every
-- *migration* runnable against plain local Postgres (Review Feedback v2.md
-- #8) — a FK to it would make every migration fail locally. Phase 1 as a
-- whole still requires a real Supabase project, though: its invite-by-email
-- and login only exist there (Review Feedback v3.md #14; Review Feedback
-- v4.md #7). The application is responsible for this integrity instead
-- (enforced the moment a row is written by the auth callback itself, which
-- is the only code path that ever writes one).
CREATE TABLE workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id      UUID NOT NULL UNIQUE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Layer 1: Who holds which card. A holder is a FREE-FORM LABEL (relative, friend,
-- or the owner themselves) — not a login, not a person-entity.
CREATE TABLE card_holders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name         TEXT NOT NULL,   -- label, e.g. 'Papa', 'Mummy', 'Sumit', 'Rahul (friend)'
  email        TEXT,            -- optional: where reminders about this holder's benefits go
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, name),
  UNIQUE (workspace_id, id)   -- lets cards.holder_id use a composite FK (see below)
);

-- ─────────────────────────────────────────────────────────────────────────
-- GLOBAL REFERENCE DATA (no workspace_id — shared by every tenant)
-- ─────────────────────────────────────────────────────────────────────────

-- A (bank, card type) combination, e.g. "PNB RuPay Select Credit Card".
-- curation_status distinguishes "nobody has entered this card's benefits yet"
-- from "confirmed this card genuinely gets none" — without it the two look
-- identical to a user (Review Feedback.md #10; REQUIREMENTS.md §5).
CREATE TABLE bank_card_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name        TEXT NOT NULL,
  card_type        TEXT NOT NULL,          -- e.g. 'RuPay Select Credit Card'
  network          TEXT NOT NULL DEFAULT 'RuPay',
  curation_status  TEXT NOT NULL DEFAULT 'uncurated'
                   CHECK (curation_status IN ('uncurated','curated','no_benefits')),
  active           BOOLEAN DEFAULT true,   -- false if the bank discontinues the card type entirely
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (bank_name, card_type, network)
);

-- A benefit's STABLE IDENTITY — "Gaana Plus Annual Subscription on PNB
-- Imperial", independent of any particular version of its details. Benefit
-- instances key on this, not on a specific version, so a version change
-- (even just a typo fix) never creates a duplicate entitlement for a period
-- already in progress. See REQUIREMENTS.md §5 "Versioning model".
--
-- A FREQUENCY CHANGE IS A NEW BENEFIT IDENTITY, never a new version of this
-- one (Review Feedback v2.md #4) — closing out this benefit (close its
-- current version's effective_to) and creating a fresh `benefits` row (+
-- first version) is how a curator records "the bank switched this from
-- Quarterly to Monthly." This is required, not just tidier: periods are keyed
-- by frequency, and a Quarterly period and a Monthly period can share the
-- same period_start (e.g. both start Jul 1), which would otherwise collide on
-- benefit_instances' unique key and silently drop an instance.
-- UNIQUE (id, bank_card_type_id) exists purely so cards and overrides can
-- reference "this benefit AND confirm it belongs to this card type" as a
-- single composite foreign key (see cards and card_benefit_overrides below) —
-- turning the "benefit belongs to the card's type" invariant into something
-- the database refuses to violate, instead of an app-layer check that can be
-- forgotten (Review Feedback v3.md #7).
CREATE TABLE benefits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_card_type_id UUID NOT NULL REFERENCES bank_card_types(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (id, bank_card_type_id)
);

-- The actual details of a benefit, EFFECTIVE-DATED so a real change (not a
-- typo fix — see below) can be tracked without losing history. A row with
-- effective_to NULL is currently active.
--
-- In-place UPDATE is allowed for pure corrections (typo, a frequency that was
-- simply entered wrong from day one — not a real frequency CHANGE, which
-- forks a new benefit per above) — these do not need a new version. A genuine
-- change in what the bank offers (the benefit's value changes starting some
-- date) closes the current version's effective_to and inserts a new version
-- row under the same benefit_id. This distinction is a curation judgment
-- call, not something the schema can enforce by itself (Review Feedback.md
-- #18).
CREATE TABLE benefit_catalog_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id         UUID NOT NULL REFERENCES benefits(id),
  benefit_type       TEXT NOT NULL,
  benefit_provider   TEXT,
  exact_benefit      TEXT NOT NULL,
  frequency          TEXT NOT NULL CHECK (frequency IN ('Annual','6 months','Quarterly','Monthly')),
  instance_count     INT NOT NULL DEFAULT 1 CHECK (instance_count >= 1),
  default_cash_value NUMERIC(10,2),
  effective_from     DATE NOT NULL,
  effective_to       DATE,           -- NULL = still active
  created_at         TIMESTAMPTZ DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- Lets benefit_instances.generated_from_version carry a composite FK that
  -- also pins down which benefit the version belongs to (Review Feedback
  -- v3.md #7) — otherwise nothing stops an instance's generated_from_version
  -- from pointing at a version of a completely different benefit.
  UNIQUE (id, benefit_id)
);
-- Lookup for "which version of this benefit was effective on date X":
CREATE INDEX idx_benefit_catalog_versions_lookup
  ON benefit_catalog_versions (benefit_id, effective_from, effective_to);

-- System-wide curators of the shared catalog. Deliberately separate from
-- workspace_members.role: being 'admin' of one's own workspace must NOT grant
-- write access to global reference data used by every other workspace. Keyed
-- on the auth user id, not email (Review Feedback.md #8) and NOT foreign-keyed
-- to auth.users for the same local-Postgres reason as workspace_members
-- above. At launch this has exactly one row (the system admin). Has zero
-- grants outside migrations/admin server actions — never writable from a
-- normal client request, and explicitly INCLUDED IN whatever PostgREST
-- exposure lockdown Phase 1 performs (see Security model #1 — this table
-- must never be reachable by the anon/authenticated roles at all; it is the
-- single highest-value target that lockdown exists to protect).
CREATE TABLE system_admins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- PER-WORKSPACE DATA
-- ─────────────────────────────────────────────────────────────────────────

-- A user's physical card: an instance of a bank_card_type, owned by a holder.
-- holder_id uses a COMPOSITE FK against (workspace_id, id) on card_holders so
-- the database itself refuses a card pointing at another workspace's holder
-- — a plain FK on id alone does not enforce that (Review Feedback.md #7).
--
-- tracking_from bounds instance generation (Review Feedback v2.md #3): the
-- app must never generate a period that ended before a card started being
-- tracked (tested against period_end, not period_start — Review Feedback
-- v3.md #5 — so a card added partway through a year still gets that year's
-- annual benefit and its first quarter). The DEFAULT CURRENT_DATE below is a
-- convenience only; the app always overwrites it with the Asia/Kolkata
-- "today" computed by the single helper in src/lib/periods.ts, since Vercel
-- and Supabase both run in UTC (Review Feedback v3.md #6). A user backdating
-- their card's start (e.g. "I've actually had this since Q1") can lower it
-- explicitly.
--
-- bank_card_type_id is NOT editable once set (enforce in the server action
-- for a clean error message) and is effectively IMMUTABLE AT THE DATABASE
-- LEVEL TOO, not just by convention: card_benefit_overrides and
-- benefit_instances both carry composite foreign keys against
-- (workspace_id, id, bank_card_type_id) on this table with Postgres's
-- default NO ACTION, so once any override or instance references a card,
-- Postgres itself rejects an UPDATE that changes that card's
-- bank_card_type_id (Review Feedback v4.md #10). Changing it would otherwise
-- silently invalidate every existing instance and suppress override already
-- generated against the old type (Review Feedback v3.md #7). If a card's
-- type was genuinely wrong, delete and recreate the card rather than
-- repointing it.
CREATE TABLE cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id),
  holder_id         UUID NOT NULL,
  bank_card_type_id UUID NOT NULL REFERENCES bank_card_types(id),
  display_name      TEXT NOT NULL,  -- user-facing nickname, e.g. 'PNB Imperial (7825)'
  last_digits       TEXT,
  tracking_from     DATE NOT NULL DEFAULT CURRENT_DATE,
  active            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, display_name),
  UNIQUE (workspace_id, id),                      -- lets dependent tables use composite FKs too
  UNIQUE (workspace_id, id, bank_card_type_id),   -- lets dependents also pin the card's type (Review Feedback v3.md #7)
  FOREIGN KEY (workspace_id, holder_id) REFERENCES card_holders (workspace_id, id)
);

-- A user's own correction to the shared catalog for one of their cards: EITHER
-- adding a benefit the catalog is missing, OR suppressing one the catalog
-- wrongly claims applies (kind distinguishes the two — Review Feedback.md
-- #5; the prior schema only supported additions). Simple ON/OFF for v1 per
-- REQUIREMENTS.md §5/§10 — persists indefinitely until the user turns it off;
-- no effective-dating on this side, unlike the shared catalog. Scoped to the
-- owning workspace only; never affects other users' view of the shared
-- catalog. card_id uses a composite FK for the same tenant-isolation reason
-- as cards.holder_id above.
--
-- For kind = 'suppress': benefit_id identifies which shared benefit to hide;
-- the benefit_type/provider/exact_benefit/frequency/instance_count columns
-- are NULL (nothing to add, just suppressing).
-- For kind = 'add': benefit_id is NULL; the other columns describe the
-- user's own addition, same shape as a catalog version, and instance_count
-- IS required (generation has no number to use otherwise — Review Feedback
-- v3.md #10).
--
-- bank_card_type_id is a COPY of the owning card's bank_card_type_id,
-- written by the server action when the override is created (never user-
-- supplied). It exists purely so the composite foreign key below can enforce,
-- at the database level, that a 'suppress' override's benefit_id actually
-- belongs to this card's card type — turning Review Feedback v2.md #18's
-- app-layer-only invariant into a real constraint per Review Feedback v3.md
-- #7. If a card's bank_card_type_id is ever allowed to change (it currently
-- is not — see cards above), this column must be updated in the same
-- transaction or the FK will reject the override.
CREATE TABLE card_benefit_overrides (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL,
  card_id            UUID NOT NULL,
  bank_card_type_id  UUID NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('add','suppress')),
  benefit_id         UUID,  -- set only when kind = 'suppress'
  benefit_type       TEXT,
  benefit_provider   TEXT,
  exact_benefit      TEXT,
  frequency          TEXT CHECK (frequency IS NULL OR frequency IN ('Annual','6 months','Quarterly','Monthly')),
  instance_count     INT CHECK (instance_count IS NULL OR instance_count >= 1),
  default_cash_value NUMERIC(10,2),
  active             BOOLEAN NOT NULL DEFAULT true,  -- on/off switch; no date range
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, id),              -- lets benefit_instances use a composite FK too
  UNIQUE (workspace_id, card_id, id),     -- lets benefit_instances also pin the override's card (Review Feedback v3.md #7)
  FOREIGN KEY (workspace_id, card_id) REFERENCES cards (workspace_id, id),
  -- Enforces "this override's card actually has this card type" — catches a
  -- bug or race where bank_card_type_id was copied stale.
  FOREIGN KEY (workspace_id, card_id, bank_card_type_id) REFERENCES cards (workspace_id, id, bank_card_type_id),
  -- Enforces "the suppressed benefit actually belongs to this card's card
  -- type" — the gap Review Feedback v2.md #18 flagged as app-layer-only.
  FOREIGN KEY (benefit_id, bank_card_type_id) REFERENCES benefits (id, bank_card_type_id),
  CHECK (
    (kind = 'suppress' AND benefit_id IS NOT NULL AND benefit_type IS NULL)
    OR
    (kind = 'add' AND benefit_id IS NULL AND benefit_type IS NOT NULL AND exact_benefit IS NOT NULL AND frequency IS NOT NULL AND instance_count IS NOT NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (card_id, kind, benefit_id, benefit_type, benefit_provider, exact_benefit)
);

-- Trackable benefit instances, one per entitlement period (workflow state).
-- Keyed on the STABLE benefit_id (for catalog-sourced instances) or the
-- override_id (for user-added instances) — NOT on a specific catalog
-- version — so a version change never creates a duplicate entitlement for a
-- period already generated (Review Feedback.md #1, #2). Exactly one of
-- benefit_id / override_id is set.
--
-- `NULLS NOT DISTINCT` on the uniqueness constraint is required: with the
-- default NULLS DISTINCT, Postgres would treat every (card_id, benefit_id=
-- NULL, override_id=X, ...) row as unique from every other one with
-- benefit_id NULL, silently defeating the idempotency this constraint exists
-- for (Review Feedback.md #1 — this was the actual bug in the prior schema).
--
-- bank_card_type_id is a COPY of the owning card's bank_card_type_id, written
-- whenever a row is created (by generation, or by the optional Excel import
-- — see below). It exists purely so the composite FK against benefits can
-- enforce "this instance's benefit actually belongs to this card's card
-- type" at the database level (Review Feedback v3.md #7).
--
-- generated_from_version additionally carries benefit_id in its FK so the
-- database also enforces "the recorded version actually belongs to this
-- instance's benefit" — a gap the v2 schema's invariant list missed entirely
-- (Review Feedback v3.md #7).
--
-- The generation code path (Phase 3) and the optional Excel-import script
-- (Phase 2) are BOTH code paths that write this table — the v2 schema's
-- comment calling generation "the only" one was wrong (Review Feedback
-- v3.md #7). Both now get the same guarantees for free from the FKs below;
-- the one invariant still NOT enforceable as a foreign key is the curation
-- judgment call of "is this catalog edit a correction or a new version"
-- (Review Feedback.md #18) — that's a judgment, not a referential fact.
CREATE TABLE benefit_instances (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID NOT NULL,
  card_id                 UUID NOT NULL,
  bank_card_type_id       UUID NOT NULL,
  benefit_id              UUID,
  override_id             UUID,
  generated_from_version  UUID, -- which version produced this, for audit/display only
  period_start            DATE NOT NULL,
  period_end              DATE NOT NULL,
  period_label            TEXT NOT NULL,          -- '2026-Q3' | '2026-H2' | '2026' | '2026-07'
  instance_number         INT NOT NULL DEFAULT 1 CHECK (instance_number >= 1), -- 1..instance_count within a period
  order_status            TEXT NOT NULL DEFAULT 'Not Ordered'
                          CHECK (order_status IN ('Not Ordered','Ordered but Coupon not received',
                                                  'Coupon Received','Coupon Redeemed','Skipped','Withdrawn')),
  sold_for                NUMERIC(10,2),
  cash_value              NUMERIC(10,2),
  order_date              DATE,
  expiry_date             DATE,
  order_deadline          DATE NOT NULL,          -- = period_end
  rupay_booking_id        TEXT,
  code_encrypted          TEXT,                   -- AES-256-GCM, associated data = this row's id (see Security model); never stored or logged in plaintext
  comments                TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (workspace_id, card_id) REFERENCES cards (workspace_id, id),
  -- Override, if set, must belong to THIS card (not just this workspace) —
  -- closes the cross-card-same-workspace gap from Review Feedback v2.md #18.
  FOREIGN KEY (workspace_id, card_id, override_id) REFERENCES card_benefit_overrides (workspace_id, card_id, id),
  -- Benefit, if set, must belong to a benefit of THIS card's card type.
  FOREIGN KEY (benefit_id, bank_card_type_id) REFERENCES benefits (id, bank_card_type_id),
  FOREIGN KEY (workspace_id, card_id, bank_card_type_id) REFERENCES cards (workspace_id, id, bank_card_type_id),
  -- Recorded version, if set, must belong to THIS instance's benefit.
  FOREIGN KEY (generated_from_version, benefit_id) REFERENCES benefit_catalog_versions (id, benefit_id),
  CHECK (num_nonnulls(benefit_id, override_id) = 1),
  UNIQUE NULLS NOT DISTINCT (card_id, benefit_id, override_id, period_start, instance_number)
);

-- Reminders (later phase — see REQUIREMENTS.md §9 — schema kept here for continuity)
CREATE TABLE notification_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id),
  holder_id     UUID NOT NULL UNIQUE,
  email_enabled BOOLEAN DEFAULT true,
  days_before   INT[] DEFAULT '{7, 3, 1}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (workspace_id, holder_id) REFERENCES card_holders (workspace_id, id)
);

CREATE TABLE reminder_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id),
  instance_id   UUID NOT NULL REFERENCES benefit_instances(id),
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('expiry','order_lapse','stale_order')),
  days_before   INT,
  sent_at       TIMESTAMPTZ DEFAULT now(),
  channel       TEXT DEFAULT 'email',
  UNIQUE (instance_id, reminder_type, days_before)
);
```

**Notes:**
- `bank_card_types`, `benefits`, and `benefit_catalog_versions` are **global** — no `workspace_id`. Every workspace reads the same rows; writes to them are an admin/curation action via `system_admins`, not a normal user action.
- **"Today" and "active" — one definition, used everywhere below.** `today` is computed once per request, in `Asia/Kolkata`, by a single helper (`src/lib/periods.ts`), and passed down — never read from `CURRENT_DATE`/`now()` in SQL or from the server's local clock, since Vercel and Supabase both run in UTC and the gap (up to 5.5 hours around midnight IST) would make a new quarter appear late or a `tracking_from` default land on the wrong day. `cards.tracking_from DEFAULT CURRENT_DATE` in the schema above is a convenience default only; the app overwrites it with the `Asia/Kolkata` `today` at insert time. A version or override is **active on date D** if `effective_from <= D AND (effective_to IS NULL OR effective_to >= D)` — this is the only definition used anywhere a lapse check happens; in particular a version with a future `effective_from` and `effective_to IS NULL` is **not** active yet, even though its `effective_to` is NULL (Review Feedback v3.md #3).
- **Instance generation ("ensure instances exist for the periods implied by viewing period X", run automatically on every view — see Review Feedback v2.md #2, #3, #4, Review Feedback v3.md #1, #5 and REQUIREMENTS.md §5):**
  1. **Expand the viewed period into the full set to generate.** Viewing quarter Q ensures: Q itself, each month of Q that has already started, the half-year containing Q, and the year. The Dashboard ensures this same set for the current quarter. **Viewing a year or half-year ensures every period nested inside it that has already started** (its quarters, their elapsed months), not just the year/half-year instance itself — otherwise a year view would generate only the annual instances and leave quarters/months under-generated the first time they're viewed from that angle (Review Feedback v4.md #6).
  2. **Bound which of those periods are actually generated.** Generate a period only if `period_end >= cards.tracking_from` (not `period_start` — a card added in February must still get that year's annual benefit and Q1, both of which *start* before February but *end* after it) **and** `period_start <= today` (no manufacturing future history). A period outside this range is silently skipped, not an error. Skip generation entirely for a card with `active = false`, or whose `bank_card_type_id` has `bank_card_types.active = false` — existing instances are untouched (withdrawal, not generation, is what responds to a card/type going inactive; the sweep currently does not special-case this — see Open Items for the held question of whether an inactive card's stale `Not Ordered` items should also be withdrawn).
  3. **For each of the card's catalog-sourced benefits** (every `benefits` row for the card's `bank_card_type_id` that the card does not have an active `suppress` override for), pick **the earliest version whose effective window overlaps the period** — equivalently, the version active on `max(period_start, that version's effective_from)`. This is deliberately not "the version in effect at the period's start": a benefit added mid-period has no version covering the period's start date at all, and the period-start rule would silently generate nothing for it, contradicting the mid-period-visibility requirement (Review Feedback v3.md #1). The earliest-overlapping rule agrees with the period-start rule whenever a version already covers the start, and additionally picks up the mid-period case. If no version overlaps the period at all, generate nothing for that benefit in that period. **Generate the instance only once that chosen version has actually started**, i.e. `effective_from <= today` — otherwise a version dated to start next month would get an instance today that the sweep then immediately marks `Withdrawn` for having "no active version," showing the user a confusing "bank dropped this" message for a benefit that simply hasn't started yet (Review Feedback v4.md #2). The instance then first appears on the earliest view on or after the version's own start date, which is what "visible mid-period" means. **A pure in-place correction to the chosen version is visible immediately** (the instance references the version's stable id, not a frozen snapshot of its fields) — only a genuine new version (closing the old one and opening another) is a different row, and so only takes effect for periods generated after it exists (Review Feedback v3.md #2).
  4. **Plus the card's active `add` overrides**, which generate instances the same way but are always "active," with no version-selection step.
  5. **Create any missing `benefit_instances` row** keyed on `(card_id, benefit_id or override_id, period_start, instance_number)`, using `INSERT ... ON CONFLICT DO NOTHING` so concurrent requests (e.g. two browser tabs) can't race into a duplicate-insert error — safe to re-run on every view, because the uniqueness constraint (with `NULLS NOT DISTINCT`) actually prevents duplicates now, and because keying on `benefit_id` rather than a specific version means a version change mid-period never looks like a new entitlement.
- **Withdrawal sweep: one stateless eligibility rule, recomputed from scratch every time — no history of "what it was before" is stored or needed (Review Feedback v4.md #1).** Scope: every instance with `period_end >= today` whose status is currently `Not Ordered` or `Withdrawn` (Review Feedback v3.md #4 — a past period's still-`Not Ordered` instance is "Lapsed," and must stay that way; sweeping it to `Withdrawn` would rewrite "you missed this" into "the bank dropped it," so instances with `period_end < today` are never touched by this rule at all). For each in-scope instance, compute **eligibility**:
  - A catalog-sourced instance is eligible if its benefit has a version active today (per the "active on date D" definition above, D = today) **and** the card has no active `suppress` override for it.
  - An override-sourced instance is eligible if its `add` override is currently active.

  Set the instance to `Withdrawn` if not eligible, `Not Ordered` if eligible. Because this is a single rule recomputed fresh each time rather than a set of one-way triggers, every combination resolves correctly without needing to remember prior state — including a benefit that's both dropped by the bank **and** suppressed by the user, where the user then removes the suppression (still ineligible, because the catalog version is still inactive) or the bank reinstates the benefit (still ineligible, because the suppression is still on) or both clear (now eligible, reverts to `Not Ordered`). **Generation and this sweep run together, in the same transaction**, so a benefit that's already ineligible at the moment its instance is first generated never shows as orderable even for one view. A user never directly sets or clears `Withdrawn` — it is entirely a function of the current state of the catalog and overrides. Already-ordered/received/redeemed instances are never touched by this sweep, regardless of period.
- `cards.bank_card_type_id` is the link into the benefit system (immutable once set — see cards above); `display_name` is the user's own nickname for the physical card; `tracking_from` bounds generation, tested against `period_end` (see above).
- Composite foreign keys (`(workspace_id, id)` on the parent, `FOREIGN KEY (workspace_id, x_id) REFERENCES ... (workspace_id, id)` on the child) are used wherever a per-workspace row references another per-workspace row (`cards.holder_id`, `card_benefit_overrides.card_id`, `benefit_instances.card_id`). This makes it a **database-enforced constraint**, not just an application convention, that a row can never reference another workspace's data by ID — see Security model and Review Feedback.md #7. **As of Review Feedback v3.md #7, three further invariants that the v2 schema described as app-layer-only are now also database-enforced composite foreign keys**, not just checked in code: an override belonging to the wrong card in the same workspace (`benefit_instances` → `card_benefit_overrides` keyed on `(workspace_id, card_id, id)`), a benefit or override not matching its card's card type (both tables carry a copied `bank_card_type_id`, FK'd against `benefits (id, bank_card_type_id)` and `cards (workspace_id, id, bank_card_type_id)`), and a recorded version not belonging to its instance's benefit (`benefit_catalog_versions (id, benefit_id)`). The one gap left that genuinely **cannot** be a foreign key is the curation judgment of "is this catalog edit a correction or a new version" (Review Feedback.md #18) — that's a human call, not a referential fact.
- `computePeriods(year, frequency)` in `src/lib/periods.ts` returns the entitlement periods (start, end, label); `order_deadline = period_end`. Unchanged from v1.
- Holder "views" (e.g., Neha's benefits) are simple joins; at this scale (~120 instances/year per workspace) no materialized views needed.
- `workspace_members.user_id UNIQUE` means one auth user maps to exactly one workspace for v1 — stating this explicitly since it's a real constraint, not an oversight (Review Feedback.md "Also found").
- **No table in this schema has a foreign key to `auth.users`** (Review Feedback v2.md #8) — this keeps every *migration* runnable against plain local Postgres. It does **not** mean Phase 1 as a whole can run there: Supabase's invite-by-email and login only exist on an actual Supabase project (or its CLI's local stack), so Phase 1 requires a real Supabase project (Review Feedback v3.md #14). The tradeoff of no FK is that `workspace_members.user_id` and `system_admins.user_id` integrity against real auth users is an application-layer guarantee (enforced at the one or two code paths that ever write these rows), not a database one.

---

## Tech stack (final)

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router), TypeScript |
| UI | React + shadcn/ui + Tailwind CSS |
| ORM | Drizzle ORM |
| Database | PostgreSQL via Supabase (Mumbai) |
| Auth | Supabase Auth, **gated via Supabase's built-in admin-invite-by-email for v1** — public self-signup is turned OFF in the Supabase project settings; a system admin invites a specific email, Supabase sends the invite email itself, and the user sets a password/completes signup via Supabase's own flow. No custom `invite_codes` table, no custom redeem page, no atomicity/race condition to get right, and no circular bootstrap problem — the first invite (to the system admin's own email) is just the first admin action taken against the freshly-provisioned Supabase project. A `workspace_members` row (and the workspace itself, for a first-time signup) is created by the app the moment that invited user completes signup and logs in — see Review Feedback v2.md #7. |
| API | Next.js Server Actions + Route Handlers |
| Hosting | Vercel (Mumbai functions) |
| Repo | Git (GitHub, private) |

**Connection pooling (required):** from Vercel serverless, use Supabase's **transaction pooler** connection string (port 6543 / Supavisor), not the direct `:5432` connection — direct connections exhaust Postgres under serverless. Configure the Drizzle `postgres-js` driver with `prepare: false` (transaction-mode poolers don't support prepared statements).

### Portability

| Component | Migration path |
|-----------|----------------|
| Next.js app | Railway, Fly.io, self-hosted Node |
| PostgreSQL | Neon, Railway, RDS, local — standard dump/restore |
| Drizzle | Standard SQL migrations |
| Supabase Auth | NextAuth + any provider |
| Vercel Cron | GitHub Actions, pg_cron, external cron |
| Resend | SendGrid, SES, Postmark |

### Do NOT use

- Lovable, Builder.io, Bubble, or other no-code platforms as production foundation
- Firebase / NoSQL for core data
- Spreadsheet-as-database

---

## Security model

> **#1, most important — Supabase's default grants expose every table to the public anon key unless explicitly locked down, independent of RLS and independent of application-layer scoping.** Tables created by SQL migrations in the `public` schema get **full `anon`/`authenticated` grants by default** on Supabase. The `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to every browser by design. With RLS off (as in the app-layer-only design below) and no grants revoked, **anyone holding that public key could read every row through the auto-generated PostgREST API — including encrypted codes and, far worse, could `INSERT` a row into `system_admins` directly, granting themselves shared-catalog write access.** Application-layer scoping (the query-scoping helper, composite FKs) only protects requests that go through the Next.js server; it does nothing to stop a request that bypasses the app entirely and hits Supabase's PostgREST endpoint directly. This is **independent of and in addition to** the RLS discussion below — fixing one does not fix the other. See Review Feedback v2.md #1.
>
> **Fix, required in the Phase 1 migration itself** (choose one, confirmed against Supabase's own Security Advisor once the project exists):
> - **Preferred:** put all application tables in a non-`public` schema that PostgREST doesn't expose (e.g. an `app` schema) — this automatically covers every table a *later* migration creates too, with nothing to remember to repeat.
> - If staying in `public`: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;` plus `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with **zero policies** (deny-all) on every table — RLS-with-no-policies is being used here purely as a second lock on the PostgREST door, not as the tenant-isolation mechanism (that's still the app-layer design below). **This alone is not enough**, because it only affects tables that exist at the moment it runs — Supabase's **default privileges** re-grant `anon`/`authenticated` on every table a later migration creates, and sequences/functions are separate grants entirely (Review Feedback v3.md #9). Also run `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES, SEQUENCES, FUNCTIONS FROM anon, authenticated;`, and re-run the curl check after **every** subsequent migration, not just once in Phase 1.
>
> The PostgREST curl check (confirming the anon/authenticated roles see nothing) moves to **Phase 1**, immediately after this lockdown — not Phase 5, by which point real data already exists.
>
> **#2, tenant isolation between workspaces is enforced at the application layer, not via per-tenant Postgres RLS policies** — a separate concern from #1 above (#1 is "can anyone reach the database directly," this is "once reaching it through the app, can workspace A ever see workspace B"). The app's database connection (Drizzle, over the Supabase transaction pooler) authenticates as the table-owning role. Table owners **bypass RLS by default** regardless of what per-tenant policies might exist, unless `FORCE ROW LEVEL SECURITY` is set — and even then, the pooled connection has no per-request mechanism (no `SET LOCAL ROLE` + JWT claims) to make Postgres aware of which end-user is making the request. See Review Feedback.md #6.
>
> **What actually provides cross-workspace isolation (all three, together):**
> 1. **Composite foreign keys** on every per-workspace table (`(workspace_id, id)` on the parent, matched on both columns by the child — see Database schema). This makes it a database-level impossibility, not just an application habit, for one workspace's `cards` row to reference another workspace's `card_holders` row, and likewise for overrides and instances. Fixes Review Feedback.md #7 directly: a server action cannot "attach your card to someone else's holder_id" even if it forgets to check, because the write itself would violate a constraint. (As of Review Feedback v3.md #7, this same technique also now closes the narrower, same-workspace gaps Review Feedback v2.md #18 had flagged as app-layer-only: cross-*card* override misattachment and benefit/bank-card-type mismatches are both database-enforced composite FKs now too — see Database schema notes. The one invariant that genuinely can't be a foreign key is the curation judgment of "correction vs. new version," Review Feedback.md #18.)
> 2. **A single query-scoping helper** that every server action must route through, which always injects `WHERE workspace_id = :sessionWorkspaceId` and never accepts a caller-supplied `workspace_id`. Built in Phase 1, used everywhere from Phase 3 onward.
> 3. **A test per server action — reads included, not just mutations** — proving user A's session cannot read, write, or reference user B's rows by ID. **Reveal-code is the single highest-priority action to test this way**: it is a read that decrypts money, and composite foreign keys provide zero protection for a read (they only constrain what a write can attach to) — the query-scoping helper plus its test are the *entire* defense for reads (Review Feedback v2.md #10).

1. **All data access is server-side** (Server Actions / Route Handlers → Drizzle → pooled Postgres). The browser never queries the database.
2. **Shared catalog write access** (`benefits`, `benefit_catalog_versions`, `bank_card_types`) is gated by presence in `system_admins` (keyed on the auth user id, not email — see below), checked in the server action itself. `system_admins` has zero grants outside migrations and the one admin-curation server action, and is explicitly covered by #1 above's PostgREST lockdown — it must never be reachable by the anon/authenticated roles at all, by any path.
3. **Voucher codes encrypted at rest**: AES-256-GCM in `src/lib/crypto.ts`, key from `VOUCHER_ENCRYPTION_KEY` (32-byte base64, server-only env), with the **instance's own `id` as the AES-GCM associated data** — this binds a ciphertext to its row, so an encrypted code value can't be copied onto a different instance and still decrypt successfully (Review Feedback.md "Also found"). Decryption only in the explicit "reveal code" server action, which is the action most in need of the per-action isolation test above. Codes never appear in logs, errors, or import output.
4. **Auth gate = membership, not just login**, and **identity is keyed on the auth user id, never on email** (Review Feedback.md #8 — emails change, and email+Google sign-in can otherwise create two identities for one address). `workspace_members` and `system_admins` both store `user_id`. Middleware resolves session `user_id` → `workspace_members` → `workspace_id` on every request. No membership row → the app creates one automatically on an invited user's first successful login (see #5 below) — a bare 403 should never actually occur for a legitimately-invited user, since Supabase's own invite flow is what created their account in the first place.
5. **Signup is invite-gated for v1 via Supabase Auth's built-in admin-invite-by-email** (public self-signup disabled in Supabase project settings) — not a custom invite-code table. See Tech stack for why this is simpler than a hand-rolled design: no redemption race condition, no "confirmed user with no workspace" lockout state, no circular bootstrap problem. On an invited user's first login, the app checks for an existing `workspace_members` row for their `user_id`; if none exists, it creates a new workspace and an owner membership row for them, in one transaction. Email confirmation is handled by Supabase's invite flow itself (the user only ever arrives via the link in a real invite email). **The invite gate is now effectively one Supabase project setting** (Review Feedback v3.md #15): any authenticated user with no membership gets a workspace auto-provisioned, no second check. That's fine at v1's scale, but means re-enabling public self-signup by mistake, or any other path that creates an `auth.users` row, grants a workspace with no further gate — worth remembering if that setting is ever touched. (Separately, Supabase's built-in email sender is rate-limited to a handful of emails/hour, which is fine for a small number of invites but not for anything like a waitlist-clearing burst.)
6. **The `.xlsx` and `.env*` are gitignored from the first commit.**
7. **Weekly backups**: GitHub Action running `pg_dump` (Supabase free tier has no automated backups), stored encrypted, **with the backup file and the `VOUCHER_ENCRYPTION_KEY` kept in separate locations/secrets stores** — a backup containing every tenant's encrypted codes is only as safe as the key that would decrypt all of them at once (Review Feedback.md "Also found"). Codes are money — losing the DB is losing money.
8. **Account/workspace deletion and its cascade behavior are undefined in v1's schema** (no `ON DELETE` clauses specified yet) — acceptable while signup is invite-only and there's no user-facing delete flow, but this **must be resolved before public signup opens**, alongside a privacy notice (Review Feedback.md #12; REQUIREMENTS.md §3).

---

## Reminder system (later phase — see REQUIREMENTS.md §9)

> Not v1. Kept here, unchanged, because the design doesn't depend on the catalog rework and there's no reason to redo this thinking later. Build after the v1 tracking + signup flow is live.

### Three reminder types

| Type | Trigger |
|------|---------|
| **Expiry warning** | `order_status = 'Coupon Received'` AND `expiry_date` within window |
| **Order lapse warning** | `order_status = 'Not Ordered'` AND `order_deadline` within window AND **deadline is in the future** |
| **Stale order** | `order_status = 'Ordered but Coupon not received'` AND `order_date` > 7 days ago |

`Skipped` and `Withdrawn` instances never generate reminders. Past-deadline `Not Ordered` items show as **Lapsed** in the UI but never email — a workspace carrying forward several already-closed quarters (e.g. from a personal-history import) would otherwise trigger a flood of reminders about periods nobody can still act on.

### Window semantics (not equality)

Fire when `days_until <= days_before` for the largest un-sent `days_before` in the holder's preferences, deduped by `reminder_log`'s UNIQUE constraint. Equality matching would silently drop reminders whenever the cron is delayed a day (Vercel Hobby cron timing is loose — runs once daily within an approximate window).

### Cron flow (daily, ~8 AM IST)

1. Query instances matching the three triggers per `notification_preferences.days_before`
2. Skip anything already in `reminder_log`
3. **One digest email per recipient per day** (all their items in one message — keeps Resend free-tier usage at ≤ recipients/day)
4. Log each instance-reminder sent

Recipient = the holder's email if set; fallback is the workspace's own account email (the signed-in user's email, resolved via `workspace_members`/the auth session — not a stored `workspaces` column, since that table carries no reminder-related fields in the current schema). A holder is just a label — many holders won't have their own email, and their digests route to whoever's account the workspace belongs to. (This phase should also add whatever column or lookup it actually needs for this — it's deliberately not pre-added to the v1 schema, since Reminders is a later phase and the exact shape should be decided when it's actually built.)

**Resend constraint:** without a verified custom domain, Resend delivers only to the account owner's address. Emailing any other recipient requires a domain (~₹800–1,000/yr) — the one real cost. Until then, all digests go to the owner's inbox.

### Example email

> **Expiry:** Sumit's Myntra voucher (₹500) expires on **Jul 12, 2026**. Booking ID: RUPS-6D06E237.
>
> **Order:** Papa's Cult.fit gym benefit for **Q3 2026** must be ordered by **Sep 30**. Status: Not Ordered.

---

## Deployment plan

### Architecture

```
GitHub repo (private)
    │
    ▼
Vercel bom1 (Next.js + API)
    │
    ├──► Supabase ap-south-1 (PostgreSQL via pooler :6543
    │      — PostgREST exposure locked down in Phase 1 migration (Security model #1)
    │      — app-layer tenant scoping between workspaces, not per-tenant RLS (Security model #2))
    └──► Supabase Auth (public self-signup OFF; admin invite-by-email;
           workspace_members gate, keyed on user_id)

(Cron + Resend added in the later Reminders phase — see REQUIREMENTS.md §9)
```

### Environment variables

```env
# Transaction pooler (NOT the direct :5432 connection)
DATABASE_URL=postgresql://...@...pooler.supabase.com:6543/postgres
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # server-only
VOUCHER_ENCRYPTION_KEY=base64:...        # server-only, 32 bytes
```

`RESEND_API_KEY` and `CRON_SECRET` are added when the Reminders phase is built (REQUIREMENTS.md §9) — not needed for v1 launch.

### Deployment steps

| Step | Action | Who |
|------|--------|-----|
| 1 | Create private GitHub repo | User |
| 2 | Create Supabase project, **region `ap-south-1`**, free tier; **disable public self-signup** in Auth settings | User |
| 3 | Run Drizzle migrations; **lock down PostgREST exposure** (Security model #1 — non-public schema or REVOKE + deny-all RLS) **and verify via curl immediately**, before any real data exists; verify every per-workspace table's composite FKs are in place | Agent |
| 4 | Seed shared catalog (required — see Build phases Phase 2) | Agent |
| 5 | Create Vercel project (functions region `bom1`), connect repo | User + Agent |
| 6 | Set env vars (above) | User |
| 7 | Deploy; send an admin invite to the system admin's own email via Supabase, complete signup, verify the app auto-creates the workspace + owner membership row on first login; run the per-action tenant-isolation test suite (reads included, reveal-code first) against the deployed environment | Agent |
| 8 | Add weekly `pg_dump` backup GitHub Action, confirmed stored separately from `VOUCHER_ENCRYPTION_KEY` | Agent |
| 9 | Optional: custom domain for the app | User |

### Cost

| Service | v1 (monthly) | At scale (est. monthly) |
|---------|-------------------------|------------------------------|
| Vercel | $0 (Hobby, until traffic requires Pro) | ~$20 (Pro) |
| Supabase | $0 (Free) | ~$25 (Pro — backups, no pausing) |
| Resend | n/a until Reminders phase | $0–20 depending on volume |
| Domain | $0 (optional) | ~₹80/mo if used |
| **Total** | **~$0** | **~$45–65** |

Supabase free tier pauses projects after ~7 days of inactivity. Without the (later-phase) daily reminder cron keeping it awake, a dormant v1 deployment may pause — acceptable for early usage; revisit if it becomes a problem before Reminders ships.

### Production checklist

- [ ] **PostgREST exposure locked down** (non-public schema, or REVOKE + deny-all RLS) and verified via curl with the public anon key — **before** any real data is seeded (Security model #1)
- [ ] `system_admins` specifically confirmed unreachable by the anon/authenticated roles
- [ ] Public self-signup disabled in Supabase Auth settings; only admin-invited users can create an account
- [ ] Auth required on all routes; **membership gate** (no `workspace_members` row → the app auto-provisions one on an invited user's first login, not a 403), keyed on `user_id` not email
- [ ] **Tenant isolation verified per server action, reads included** — reveal-code tested first (it decrypts money and composite FKs don't protect reads at all) — not just a PostgREST curl check, which only proves the direct-API path is closed
- [ ] Composite FKs present on every per-workspace table that references another per-workspace table
- [ ] Shared catalog tables (`bank_card_types`, `benefits`, `benefit_catalog_versions`) readable by all authenticated users, writable only via the `system_admins`-gated server action
- [ ] HTTPS (Vercel default)
- [ ] Codes encrypted at rest (AES-GCM, associated data = instance id); masked in UI; absent from logs
- [ ] No server-only secrets in client bundle
- [ ] `.xlsx` and `.env*` gitignored; verified absent from git history
- [ ] Weekly backup Action green; backup storage location separate from `VOUCHER_ENCRYPTION_KEY`

---

## No-code platforms (Lovable / Builder.io)

**Recommendation: Do not use for production.** Bundled proprietary DBs, painful relational/versioning logic, limited cron+email, weak control over sensitive codes, and a hard vendor dependency. Acceptable only as a throwaway UI prototype — not needed given deployment is already low-friction.

---

## Project structure

```
rupay-voucher-tracking/
├── PLAN.md                          ← this file (architecture / how)
├── REQUIREMENTS.md                  ← product requirements / acceptance (what)
├── Gift Voucher Tracker.xlsx        ← source data (GITIGNORED — contains live codes)
└── web/                             ← Next.js app (create in Phase 1)
    ├── src/
    │   ├── app/                     ← pages (App Router)
    │   ├── components/              ← shadcn/ui components
    │   ├── db/                      ← Drizzle schema + migrations
    │   ├── lib/                     ← periods.ts, crypto.ts, utils
    │   └── actions/                 ← Server Actions
    ├── scripts/
    │   └── seed-catalog.ts          ← Phase 2 shared-catalog seed script (required gate before Phase 4c)
    ├── .github/workflows/backup.yml ← weekly pg_dump (Phase 5)
    ├── drizzle.config.ts
    ├── vercel.json
    ├── .gitignore                   ← *.xlsx, .env*
    └── .env.example
```

**Project path:** `/Users/snathany/sumit_workdir/Personal/rupay-voucher-tracking`
**Web app path:** `/Users/snathany/sumit_workdir/Personal/rupay-voucher-tracking/web`

---

## Build phases

> **Reordered after round-1 review** (Review Feedback.md #11): sign-in moves into Phase 1 because tenant-scoping work in Phases 1 and 3 is untestable without an authenticated session to test against. Shared-catalog seeding is promoted to a **required gate before Phase 4c**, because "add a card by picking from the shared catalog" is meaningless against an empty catalog, and the only other way to write catalog rows (the admin action) has no UI until Phase 8. **Round 2** (Review Feedback v2.md) adds the PostgREST exposure lockdown as an explicit Phase 1 deliverable (#1 — the most serious finding of that round), replaces invite-code mechanics with Supabase's built-in invite-by-email throughout (#7), and corrects Phase 4a's generation trigger to run on every view, not just the first (#2). **Round 3** (Review Feedback v3.md) fixes the version-selection and withdrawal-sweep precision bugs and converts three app-layer-only invariants into real composite foreign keys. **Round 4** (Review Feedback v4.md) rewrites the sweep as one stateless eligibility rule run in the same transaction as generation, gates generation on the chosen version having actually started, and corrects the Excel-seeding facts and counts against the live, since-changed sheet.

### Phase 0 — Architecture spec ✅

This document (v8.0, agreed between this session and the external review session after five rounds of review — see Review Feedback.md through Review Feedback v5.md).

### Phase 1 — Provision + scaffold + schema + auth + exposure lockdown

**Agent prompt:**
> Scaffold Next.js 15 + Drizzle at `~/sumit_workdir/Personal/rupay-voucher-tracking/web`. `.gitignore` must cover `*.xlsx` and `.env*` **before** `git init`'s first commit. Create all 12 tables per PLAN.md schema (workspaces, workspace_members, card_holders, bank_card_types, benefits, benefit_catalog_versions, system_admins, cards, card_benefit_overrides, benefit_instances, notification_preferences, reminder_log — notification_preferences/reminder_log are schema-only for now, not wired to anything until the Reminders phase) with all CHECK/UNIQUE/composite-FK constraints exactly as specified (the composite FKs are part of the tenant-isolation mechanism — see Security model, not optional hardening). **Immediately after running migrations, lock down PostgREST exposure** per Security model #1 (prefer a non-public schema; if staying in `public`, REVOKE plus deny-all RLS **and** `ALTER DEFAULT PRIVILEGES`, since the default-privileges step is required for the lockdown to survive later migrations — Review Feedback v3.md #9) and verify via curl with the anon key **before seeding or creating any real data** — this is not optional and not deferrable to a later phase. **Database must be a Supabase project (`ap-south-1`) for this phase, not plain local Postgres** — Phase 1 also requires Supabase's invite-by-email and login, which only exist on an actual Supabase project or its CLI's local stack (Review Feedback v3.md #14); "no `auth.users` foreign keys" only means migrations don't *fail* locally, not that auth works there. Disable public self-signup in Auth settings, and send the system admin's own invite via Supabase's admin-invite-by-email. Build the login callback so that a user with no `workspace_members` row gets one auto-created (with a new workspace) on first successful login — do not route them through any kind of invite-code redemption page, since there is no custom invite-code table. Seed `system_admins` with the system admin's own `user_id` once they've completed that first login. Implement `computePeriods()` and a single `today()` helper (computed in `Asia/Kolkata`, never from the server's local clock or SQL `CURRENT_DATE`/`now()` — Review Feedback v3.md #6) in `src/lib/periods.ts`, and AES-256-GCM helpers in `src/lib/crypto.ts` (associated data = the encrypting row's id), with unit tests for both. Add `.env.example`.

**Deliverables:** scaffold, schema + migrations with composite FKs, **PostgREST exposure locked down and verified via curl**, working invite-by-email signup/login with auto-provisioned workspace, periods/crypto utilities with tests, gitignore verified.

### Phase 2 — Shared catalog seeding (required gate before Phase 4c)

**Agent prompt:**
> Write `scripts/seed-catalog.ts` to populate `bank_card_types`, `benefits`, and `benefit_catalog_versions` with real examples, derived from `Gift Voucher Tracker.xlsx` tab `Rupay Select` per PLAN.md's **Import normalization rules**, and/or hand-entered. Treat a genuine frequency difference across the sheet's rows for what looks like "the same benefit" (e.g. the known BookMyShow Quarterly→Monthly case) as **two separate `benefits` rows**, not one benefit with conflicting versions — see Database section's "frequency change is a new identity" rule. This is reference-data seeding — it does not need to produce a specific user's `cards`/`benefit_instances`, though the script may optionally also create the system admin's own workspace/holders/cards/instances as a convenience once Phase 1's auth exists. Idempotent via upserts. Set each seeded `bank_card_types` row's `curation_status` to `'curated'` (or `'no_benefits'` where genuinely true) — leaving it `'uncurated'` defeats the purpose. Never print code values if importing any.

**Deliverables:** seeding script, populated shared catalog with real `curation_status` values and correctly-forked benefit identities for any frequency changes. **Required before Phase 4c** (card-creation UI needs real rows to pick from); not required before Phase 3 (which can be built and unit-tested against a small hand-seeded fixture).

### Phase 3 — API layer + catalog resolution

**Agent prompt:**
> Build Server Actions, all routed through a single workspace-scoping helper (built here) that injects `WHERE workspace_id = :sessionWorkspaceId` and never accepts a caller-supplied `workspace_id`: holder/card CRUD (card creation picks a `bank_card_type_id` from the shared catalog — immutable once set; card gets a `tracking_from` date, defaulting to the `Asia/Kolkata` `today()` helper, not the server's local clock), catalog-override CRUD (per-card `add`/`suppress` overrides per PLAN.md's `card_benefit_overrides` schema — copy the card's `bank_card_type_id` onto the override row at write time so the composite FK can verify it; `add` requires `instance_count`), **instance generation** (on each view, expand the viewed period into its full implied set — the period itself, its elapsed months, its half, its year — per PLAN.md's Database notes; bounded to periods where `period_end >= cards.tracking_from` and `period_start <= today()`; for each catalog-sourced benefit not actively suppressed, picks the `benefit_catalog_versions` row that is the **earliest version whose window overlaps the period**, not "the version at the period's start" — follow the generation algorithm in PLAN.md's Database notes exactly, it has specific rules for mid-period additions, frequency-change collisions, and why corrections apply immediately while new versions don't), the **withdrawal sweep** (run in the same transaction as generation, as one stateless eligibility rule recomputed from scratch each time — never a set of one-way triggers with implicit history: for every instance with `period_end >= today()` currently `Not Ordered` or `Withdrawn`, compute eligibility fresh — catalog-sourced instances need an active version and no active suppress-override, override-sourced instances need an active `add` override — then set `Withdrawn` or `Not Ordered` accordingly; never touch a past period's `Not Ordered`/Lapsed instance, since `period_end < today()` is out of scope entirely), instance status transitions (forward, backward, Skip/unskip), record sale, reveal-code (decrypt on demand, AES-GCM associated data = instance id). Also build a minimal **admin-only** catalog curation action (create a `benefits` row + its first `benefit_catalog_versions` row; close a version's `effective_to` and open a new one for a real change or a frequency change — frequency change means a **new `benefits` row**, not a new version of the old one; in-place `UPDATE` for a pure correction, which takes effect immediately) gated by a `system_admins` membership check — no UI yet. Zod validation. **Write a tenant-isolation test per server action, including reads — reveal-code first**, proving user A cannot read, write, or reference user B's rows by ID (this is the actual security verification for cross-workspace isolation — see Security model, not the PostgREST curl check, which only covers a different, narrower concern).

**Deliverables:** CRUD + workflow + catalog-resolution + bidirectional withdrawal-sweep actions with validation; admin catalog-write action (frequency-change-aware); per-action tenant-isolation tests covering reads.

### Phase 4a — Dashboard + Benefits list

**Agent prompt:**
> Build Dashboard (action items, stats, per-holder progress; Lapsed and Withdrawn shown distinctly from each other and from active Not Ordered items; Skipped and sold instances excluded from attention lists — see REQUIREMENTS.md §6/§7) and Benefits page (cards grouped by status; filters year/quarter/holder/card; pinned "Annual & half-yearly" section under the quarter selector). **Trigger instance generation (Phase 3's "ensure instances exist") on every view of a period, not just the first** — a benefit a bank adds mid-quarter must become visible the next time the period is viewed, not only if the period had never been viewed before. Generation is cheap (bounded by `tracking_from`, idempotent via `ON CONFLICT DO NOTHING`) so this is safe to do unconditionally. **Fully responsive — bottom tab bar on mobile, usable at 375 px.** Native web UI per PLAN.md, NOT a spreadsheet. shadcn/ui.

### Phase 4b — Benefit detail drawer

**Agent prompt:**
> Build the detail drawer: status stepper with backward transitions and Skip, progressive field disclosure, masked code with reveal-on-tap (server action) and number/PIN split copy per PLAN.md, contextual actions (mark coupon used/Coupon Redeemed, record sale). A `Withdrawn` instance's drawer explains why (bank dropped this benefit, or it's been suppressed) and offers no "order" action. Mobile-friendly (full-screen sheet on small viewports).

### Phase 4c — Admin pages (requires Phase 2's seeded catalog)

**Agent prompt:**
> Build Holders and Cards pages (adding a card means picking bank + card type from the shared catalog, typeahead search over `bank_card_types`, showing `curation_status` so a user can tell "no benefits" from "not yet curated"; optionally setting `tracking_from` if backdating). Build the Catalog-overrides page: per-card `add`/`suppress` corrections. **No manual "generate" or "Open Quarter" button anywhere** — generation always happens automatically per Phase 4a. Do not build shared-catalog curation UI here — that's Phase 3's admin action, exposed later if needed (Phase 8).

### Phase 5 — Deploy

**Agent prompt:**
> Deploy to Vercel (`bom1`), pooled `DATABASE_URL` with `prepare: false`, env vars per PLAN.md. Re-verify the PostgREST exposure lockdown against the production Supabase project specifically (a fresh project does not inherit Phase 1's local/staging lockdown). Verify: a system-admin-sent invite produces a working login and an auto-provisioned, isolated workspace; adding a card from the seeded shared catalog works; the **per-action tenant-isolation test suite** (from Phase 3, reads included) passes against the deployed environment, not just locally; no `.xlsx` in git history. Add weekly `pg_dump` backup Action, with the backup destination and `VOUCHER_ENCRYPTION_KEY` confirmed to live in separate places.

**Deliverables:** deployed app, verified invite-by-email signup flow, re-verified PostgREST lockdown in production, verified tenant isolation (reads included), backup Action.

### Phase 5.5 — Launch

**Agent prompt:**
> Confirm with the user that the v1 acceptance bar is met (receive invite → log in → add cards → see resolved benefits (generated automatically, no manual button) → track status, including the bidirectional withdrawal sweep and suppress-override behavior, with tenant isolation and PostgREST lockdown both verified in production). This is the go-live point for the invite-only product; Excel import of **personal history** is still optional and can be run against the system admin's own workspace at their convenience, before or after this point. Opening signup to the public is a **separate, later decision** gated on the shared catalog's coverage and on resolving workspace-deletion/privacy groundwork (Review Feedback.md #12) — not automatic once Phase 5.5 completes.

### Phase 6 — Reminders (later phase, build after v1 is live)

**Agent prompt:**
> Build `/api/reminders` (CRON_SECRET-protected): three reminder types with window semantics (`days_until <= days_before`), future-deadlines-only for order-lapse, Skipped/Withdrawn/sold excluded, one digest email per recipient per day via Resend (holder email, falling back to the workspace's own account email — design the actual lookup for this when building the phase, since no fallback-email column exists in the v1 schema), `reminder_log` dedupe. Notification preferences UI. `vercel.json` cron. Test with sample data across all three types and the dedupe path.

### Phase 7 — Ordering browser-automation (later phase, scope TBD)

Outline only, per REQUIREMENTS.md §9: automate the actual ordering flow (ordering a coupon through the bank's/RuPay's site). Explicitly "much later" per the user — no design work yet.

### Phase 8 — Catalog curation UI (later phase, if needed)

If admin catalog curation via direct DB/script access (Phase 3's action) proves too slow once the shared catalog is maintained by more than one person, build a proper admin UI for managing `bank_card_types`/`benefits`/`benefit_catalog_versions`, including the frequency-change-forks-a-new-identity workflow. Not needed for v1.

### Phase 9 — Public launch groundwork (later phase, gates opening signup)

Not building until the user decides to open signup beyond invites. Scope per Review Feedback.md #12 and REQUIREMENTS.md §3: privacy notice, account/workspace-deletion flow with defined `ON DELETE` cascade behavior (currently undefined — see Database schema's `workspaces` note), signup rate-limiting, and a decision on whether Supabase's invite-by-email model still fits an open-signup product or whether a different mechanism (e.g. a waitlist, or a lightweight self-serve invite-code system after all) makes more sense at that point. Also the point at which inviting someone whose card type isn't in the catalog yet (REQUIREMENTS.md §10) needs to become a smoother flow than "the system admin manually creates the `bank_card_types` row first."

---

## Agent kickoff prompt (copy-paste)

```
Build a RuPay benefit tracking web app per PLAN.md (v8.0) at:
/Users/snathany/sumit_workdir/Personal/rupay-voucher-tracking/PLAN.md

Reference data (optional for personal history, REQUIRED for catalog seeding
— see PLAN.md "Excel reference" and Phase 2):
/Users/snathany/sumit_workdir/Personal/rupay-voucher-tracking/Gift Voucher Tracker.xlsx
(tab: "Rupay Select"; never log voucher codes if used)

Stack: Next.js 15, TypeScript, Drizzle ORM, PostgreSQL on Supabase (ap-south-1),
shadcn/ui, Tailwind. Multi-tenant architecture, built in full, with signup
GATED VIA SUPABASE'S BUILT-IN ADMIN-INVITE-BY-EMAIL for v1 (public self-signup
disabled in Supabase Auth settings; no custom invite-code table — see
REQUIREMENTS.md §3/§4). Card holders are free-form labels, not separate logins.

CRITICAL, DO FIRST IN PHASE 1: lock down PostgREST exposure (non-public
schema, or REVOKE + deny-all RLS) and verify via curl with the anon key
BEFORE any real data exists. Supabase's default grants expose every table
(including system_admins) to the public anon key otherwise — see Security
model #1. This is independent of, and in addition to, the application-layer
tenant isolation described next.

A SHARED global benefit catalog with a STABLE benefit identity separate from
its effective-dated versions (benefits + benefit_catalog_versions tables —
see PLAN.md Database section for why this split exists: a version change must
never duplicate an in-progress entitlement). A FREQUENCY CHANGE FORKS A NEW
BENEFIT IDENTITY, never a new version of the old one. When generating an
instance for a period, use the EARLIEST VERSION WHOSE WINDOW OVERLAPS THE
PERIOD (not the version at the period's start — that rule silently drops
benefits added mid-period, which the earliest-overlap rule fixes while still
giving the same answer whenever a version already covers the period's
start). An instance is only generated once the chosen version has actually
started (effective_from <= today) — otherwise a future-dated version would
show as "Withdrawn" before it even begins. An in-place correction to a
version is visible immediately; only a genuine new version waits for the
next period. Instance generation expands the viewed period into its full
implied set (period + elapsed months + half + year, with a year/half view
also generating every nested period that has started), is bounded by each
card's tracking_from tested against period_end, uses a single Asia/Kolkata
"today" (never a UTC server/DB clock), and runs automatically on EVERY view
of a period (not just the first). A withdrawal sweep runs in the SAME
TRANSACTION as generation, as ONE STATELESS ELIGIBILITY RULE recomputed every
time (no history of prior state needed): for every instance with period_end
>= today that's Not Ordered or Withdrawn, it's eligible (stays/reverts to Not
Ordered) if its benefit has an active version today and isn't suppressed (or,
for an override-sourced instance, if the add override is active), otherwise
it's set to Withdrawn. A past period's still-Not-Ordered instance (period_end
< today) is never touched by this rule and stays Lapsed, never Withdrawn.

Encrypted codes (AES-GCM, associated data = instance id). TENANT ISOLATION
BETWEEN WORKSPACES IS APPLICATION-LAYER, NOT PER-TENANT RLS — enforced via
composite foreign keys (now also covering benefit/card-type matching and
override/card matching, not just cross-workspace references) plus a single
workspace-scoping query helper used by every server action, with a
per-action isolation test INCLUDING READS (reveal-code first, since it
decrypts money and composite FKs don't protect reads at all).

UI: dashboard-first benefit cards, mobile-responsive — NOT a spreadsheet.
No manual "generate" or "Open Quarter" button anywhere.
Deploy: Vercel bom1 + Supabase Auth (invite-by-email, public self-signup off).
Reminders, ordering browser-automation, and public-launch groundwork
(privacy notice, account deletion, rate limiting) are LATER phases — do not
build them as part of v1. Do not use no-code platforms.

Start at Phase [N].
```

---

## Open items

1. **Shared catalog curation:** who maintains the catalog as banks change their offers, once it's not just the one user doing it for their own data? v1 ships with a Phase 3 admin-only action, gated by `system_admins` (seeded with just the system admin at launch), and no UI (direct DB/script access). Adding a second curator later is a one-row insert into `system_admins`. Revisit if/when Phase 8 (curation UI) becomes necessary. See REQUIREMENTS.md §10.
2. ~~**Override persistence across years**~~ **Decided:** persists indefinitely for v1, on/off only, user turns it off manually if it goes stale.
3. **Unnumbered cards (if Excel seeding is used):** are `BOI Rupay Select Debit Card` (Q1) and `BOI Rupay Select Debit Card (5159)` (Q2/Q3) the same physical card? Same question for the Q1-only `PNB Rupay Select Credit Card` / `BoB Rupay Eterna Credit Card`. Resolve when seeding the catalog in Phase 2.
4. ~~**BookMyShow frequency**~~ **Decided:** it's a genuine frequency change (Quarterly → Monthly), so Phase 2 seeds it as **two separate `benefits` identities**, not one benefit with a resolved-away conflict. The Quarterly identity's `effective_to` is set to the end of the last quarter it appears in; the Monthly identity's `effective_from` is set to the start of the quarter it first appears in (see Excel import rule 4). Quarter-grained Monthly rows themselves are skipped at import entirely — the live, automatically-generated system creates true per-month instances on its own, so there is no "historical Monthly" import special case to maintain (Review Feedback v5.md #2).
5. **Reminder recipients** (Phase 6, later): which holders get their own digests vs routing to a workspace default? Holders are labels — most won't have their own email. The fallback-recipient lookup itself needs designing at that point too, since no dedicated column exists in the v1 schema.
6. **Domain purchase** (Phase 6, later) for Resend delivery to recipients other than the account owner.
7. **Missing-expiry nudge** (Phase 6, later): candidate 4th reminder type for a received-but-not-yet-used coupon with no recorded expiry date.
8. **Selling workflow scope:** the workbook's `Sold Vouchers` / `Available Vouchers` tabs (bulk voucher trading) are explicitly **out of scope**; the app tracks only `sold_for` on individual benefit instances, which are excluded from attention lists once sold (REQUIREMENTS.md §6).
9. **When to open signup beyond invites:** gated on shared-catalog coverage and on Phase 9's privacy/deletion groundwork — see Phase 9 and REQUIREMENTS.md §3/§10. Also decide then whether Supabase's invite-by-email model still fits, or whether open signup needs a different mechanism.
10. **In-place correction vs. new version (not vs. a new benefit identity — that case is decided, see Database schema), in practice:** the schema allows both for a pure wording/detail correction, but the judgment call of which applies to a given catalog edit rests entirely on whoever curates it — worth a short written rule-of-thumb once Phase 2/8 curation is actually underway, rather than deciding it abstractly now.
11. **Inviting someone whose card type isn't catalogued yet:** requires the system admin to manually create a `bank_card_types` row (as `uncurated`) before or alongside sending that person's invite. Fine at the current scale (a handful of known people); worth smoothing out if invite volume grows — see Phase 9.
12. **Should an inactive card's (or inactive card type's) stale `Not Ordered` instances be withdrawn, not just left alone?** Currently generation skips an inactive card/type entirely but the withdrawal sweep doesn't special-case it either, so those instances simply sit as `Not Ordered` indefinitely. Revisit if this turns out to be confusing in practice (Review Feedback v4.md #8).

---

## Decision summary

| Question | Decision |
|----------|----------|
| Product scope | RuPay Benefits program–specific. Not generalized to other card networks. |
| Rollout | **Multi-tenant architecture built in full; signup gated via Supabase's built-in admin-invite-by-email for v1** (public self-signup disabled in Supabase settings — no custom invite-code table). Public signup is a later, separate decision (Phase 9), not automatic once v1 ships — see REQUIREMENTS.md §3/§4 and Review Feedback v2.md #7. |
| Benefit catalog | **Shared, global reference data**, not per-workspace. A benefit has a **stable identity** (`benefits`) separate from its **effective-dated versions** (`benefit_catalog_versions`), so a version change (even a typo fix) never duplicates an in-progress entitlement. **A frequency change forks a new benefit identity**, never a new version of the old one. Per-workspace overrides (`add` or `suppress`) layer on top, on/off only. See REQUIREMENTS.md §5 and the Review Feedback docs. |
| Instance generation | Automatic, runs on **every** view of a period (not just the first), expanding the viewed period into its full implied set (period + elapsed months + half + year, including nested periods under a year/half view) and bounded by each card's `tracking_from` tested against `period_end`. Picks the **earliest catalog version whose window overlaps the period** — not the version at the period's start, which would miss mid-period additions — and only generates once that version has actually started (`effective_from <= today`). "Today" is computed once, in `Asia/Kolkata`, never from UTC server/DB clocks. A **withdrawal sweep runs in the same transaction as generation, as one stateless eligibility rule recomputed every time** (not separate one-way triggers): every instance with `period_end >= today` that's `Not Ordered`/`Withdrawn` is set `Withdrawn` if its benefit/override is currently ineligible, `Not Ordered` otherwise — a past period's still-`Not Ordered` instance stays Lapsed, untouched by this rule. No manual "generate" button anywhere. See Database schema and Review Feedback v2.md #2–#6, v3.md #1–#6, v4.md #1–#2. |
| Tenant boundary | Workspace = one user's tracking space; `workspace_members` (keyed on the auth user id, not email, no FK to `auth.users` for local-Postgres compatibility) gates access. **Two independent layers of isolation**: (1) PostgREST's default table exposure to the public anon key is explicitly locked down in Phase 1 — this is not a matter of RLS policy design, it is closing a door that's open by default; (2) cross-workspace isolation is enforced at the application layer (composite foreign keys + a shared query-scoping helper + per-action tests covering reads) rather than via per-tenant RLS, since RLS does not protect the app's own pooled database connection. See Security model and the Review Feedback docs. |
| UI style | Native web app (dashboard + cards + drawers), mobile-responsive. |
| Database | PostgreSQL (Supabase, Mumbai), 12 tables, entitlement-period instances keyed on stable benefit identity, effective-dated shared catalog, separate `system_admins` for catalog curation, no custom invite-code table |
| Framework | Next.js 15 + TypeScript |
| Components | shadcn/ui + Tailwind |
| Auth | Supabase Auth, **invite-by-email gated signup for v1**, `workspace_members` gate keyed on the auth user id |
| Code storage | AES-256-GCM encrypted at rest, associated data = the encrypting row's id (binds ciphertext to its row) |
| Reminders | **Later phase**, not v1 (REQUIREMENTS.md §9) — design kept in this doc for continuity, build order moved after launch |
| Ordering automation | **Later phase**, scope undecided (REQUIREMENTS.md §9) |
| Excel import | **Personal-history import optional**; **shared-catalog seeding required** before card-creation UI (Phase 4c) is useful — see REQUIREMENTS.md §3/§10 |
| Public-launch groundwork | **Later phase** (Phase 9) — privacy notice, account/workspace deletion with defined cascade behavior, rate limiting. Not built for v1's invite-only launch. See Review Feedback.md #12. |
| Hosting | Vercel (bom1) |
| No-code? | No — vendor-agnostic from day 1 |
| Monthly cost | ~$0 for v1; ~$45–65 once Reminders (Resend) and Pro tiers are added at scale |
