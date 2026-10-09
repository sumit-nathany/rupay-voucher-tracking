# Review Feedback v4 — PLAN.md v6.0 + REQUIREMENTS.md

> Fourth-round review, 2026-10-09. Earlier rounds: `Review Feedback.md`, `v2`, `v3`. Numbering here is new.

**Verdict:** the schema is now sound. All v3 foreign keys are correct; I checked each one, including how NULLs behave in them (default MATCH SIMPLE, so a NULL key column skips the check, which is what we want). The generation algorithm is implementable after two small rule fixes (#1, #2). The seeding section needs rework because **the spreadsheet itself has changed** since the plan's numbers were taken (#3, #4). Two questions belong to the user (#5).

**v3 status:** all 10 must-fix and 5 worth-fixing items landed. Remaining nits are in #7.

---

## Must fix

### 1. Write the withdrawal sweep as one stateless rule

The sweep is described as separate triggers ("dropped → withdraw," "suppressed → withdraw," "if the sweep next finds an active version where there previously wasn't one → reverse"). That leaves combinations undefined. Example: a benefit is both dropped by the bank *and* suppressed by the user, and the user then removes the suppression. Should it reverse? "Where there previously wasn't one" also implies remembering past state, which nothing stores.

**Fix:** define eligibility and recompute it each time. No history needed.

- A catalog-sourced instance is **eligible** if its benefit has a version active today **and** the card has no active `suppress` override for it.
- An override-sourced instance is **eligible** if its `add` override is active.
- For every instance with `period_end >= today` whose status is `Not Ordered` or `Withdrawn`: set `Withdrawn` if not eligible, otherwise `Not Ordered`.

Also state the order: **generate first, then sweep, in the same transaction**. Otherwise a freshly generated instance of a dropped benefit shows as orderable until the next view.

### 2. Future-dated versions show up as "Withdrawn"

The earliest-overlap rule generates an instance as soon as a version overlaps the period, even if that version hasn't started yet. Example: a benefit added with `effective_from = 1 Sep`, viewed on 20 Aug. Generation creates the Q3 instance, the sweep sees no version active today, and the user sees **"Withdrawn — bank dropped this"** for a benefit that hasn't started yet.

**Fix:** generate only when the chosen version's `effective_from <= today`. It will then appear on the first view on or after 1 Sep, which is what "visible mid-period" means anyway.

### 3. The NULL-frequency default now creates fake benefit identities

Import rule 7 sets NULL Frequency to `'Quarterly'`. With frequency now part of the benefit key, any annual benefit with a blank frequency cell gets forked into a separate "Quarterly" identity. On the current sheet this happens for three BOI Debit benefits:
- Amazon Prime "12 Month Annual Subscription"
- Thyrocare "Aarogyam Basic 2 Package"
- Four Fountains "60 Minutes Swedish Body Massage"

Each would seed as **both** Annual and Quarterly, so cards would get quarterly copies of annual benefits.

**Fix:** a NULL frequency takes the frequency from other rows of the same `(card type, benefit type, provider, exact benefit)` that have one. Default to Quarterly only if no row has one. Fork into two identities only when two **explicit** frequencies differ (BookMyShow is the only such case).

### 4. The spreadsheet has changed; the plan's Excel facts are stale

I read the sheet's non-sensitive columns (Card, Person, Quarter, Benefit, Frequency, Order Status; never Code). Today it has:

| Plan says | Sheet now |
|---|---|
| 139 rows, Q1–Q3 | **194 rows**, Q1–**Q4** |
| 4 order statuses | 5: adds **`Sold`** (4 rows) |
| (implied) 10 card types | 10 card names → **5 types**: BOI Debit ×4 (new: `(3688)` Mummy, `(6356)` Papa), PNB Imperial ×3 |
| PNB Imperial: "three cards held by three different people" | **All three held by Sumit** |

What breaks:
- **`Sold` isn't in the `order_status` CHECK**, so importing those rows fails (or gets silently remapped).
- Hard-coded row numbers (Golf rows "132, 145, 150, 152", separator rows) and counts are no longer reliable.
- The checklist's claim that type-level dedup reduces the **instance** count is wrong: instances are per physical card, so merging catalog types doesn't touch them. Only the period-merge step does.

**Fix:**
- Remove hard-coded row numbers and counts.
- Keep the "recompute at seed time" approach (agreed, that was the right call).
- Correct the PNB holder claim.
- Map `Sold` per the user's answer in #5a.

Snapshot as of today, for reference only:
- 5 card types.
- 34 benefit identities. That includes the 3 fake forks from #3, so expect **31** after fixing it (BookMyShow stays forked).
- 151 instances after the Annual/half-year merge.
- Status counts: 74 Not Ordered, 7 Ordered, 28 Received, 38 Redeemed, 4 Sold.

---

## Needs the user

### 5a. Is `Sold` a status?

The sheet now uses `Sold` as an order status. The plan models a sale as a `sold_for` amount on a `Coupon Received` instance, with no status change. Two options:
- **Add `Sold` as a status** after `Coupon Received`. It matches how the sheet is actually used, and "excluded from attention lists" becomes a plain status check.
- **Keep the `sold_for` field only.** The schema stays as is; import maps `Sold` → `Coupon Received` plus a sale amount.

### 5b. Duplicate rows on Mummy's BOI Debit (3688), Q3

Amazon Prime, Thyrocare, Cult.fit and Uber each appear **twice** in Q3 for that card. Is that a real entitlement of 2 per period (→ `instance_count = 2`), or an entry mistake? Right now seeding would infer `instance_count = 2` for the whole BOI Debit type, which affects every BOI Debit card.

---

## Worth fixing, not blocking

### 6. The year filter generates too little

Step 1 says the year/half filters ensure "just that one period plus the ones it's nested in." A **year** view would then generate only the year's annual instances, not its quarters or months, which contradicts "never shows an under-generated view." A year or half view should generate every period inside it that has started.

### 7. Stale text

- The `workspace_members` comment still says "Phase 1 explicitly allows starting against local Postgres." Phase 1 now requires Supabase.
- The Excel mapping note (line 50) still says the dedup key is "(Card, Benefit Type, Benefit Provider, Exact Benefit)."
- Line 127 still says "period-pinning."
- Line 34 still says "workspace owner's own workspace" (should be "system admin").
- The Build phases intro has no round-3 note.
- The Decision summary says "both Review Feedback docs"; there are now four.

### 8. The inactive-card question is buried

Step 2 ends with "revisit if an inactive card's stale `Not Ordered` items turn out to need withdrawing." That's a held item. Add it to Open Items so it doesn't get lost.

### 9. Import should set `tracking_from`

When importing a card's history, set its `tracking_from` to the earliest imported period's start. Otherwise later generation treats the card as new from today.

### 10. On the copied `bank_card_type_id` (your note)

Agreed, and it's stronger than you stated: because overrides and instances reference `cards (workspace_id, id, bank_card_type_id)` with the default `NO ACTION`, **Postgres itself rejects** changing a card's type once anything references it. Immutability is effectively database-enforced; the server-action check only gives a nicer error message. Worth one line in the `cards` comment.

---

## Status

Once #1–#4 are fixed and the user answers #5a/#5b, I have no blocking findings left. #6–#10 can go in the same pass.
