# Review Feedback v5 — PLAN.md v7.0 + REQUIREMENTS.md

> Fifth-round review, 2026-10-09. Earlier rounds: `Review Feedback.md`, `v2`, `v3`, `v4`. Numbering here is new.

**Verdict:** the generation algorithm, the stateless withdrawal sweep and the schema are now correct, and I agree with them as written. Two seeding-rule bugs remain, both confirmed against the live sheet (non-sensitive columns only). After those, I have no blocking findings.

**v4 status:** #1, #2, #3, #6, #7, #8, #9, #10 landed correctly. #4 landed, with leftover numbers (see #3 below). The user's 5a/5b decisions are recorded in both docs.

---

## Must fix

### 1. Rule 10's Monthly clause is wrong, and would triple monthly benefits

Rule 10 now says a Monthly benefit "legitimately shows up to 3 times within a Quarterly rollup… which is a real `instance_count`."

- **The logic is wrong.** `instance_count` is "how many per entitlement period," and a Monthly benefit's period is one month. The generator already creates one instance per month. Setting `instance_count = 3` would give **3 per month, 9 per quarter**.
- **The fact is wrong too.** On the sheet, the only Monthly benefit (BOI Credit, BookMyShow) appears **once per quarter** (Q2, Q3, Q4), never 3 times. Big Basket's 3-per-quarter is a **Quarterly** benefit, which is exactly what `instance_count` is for.

**Fix:** delete the Monthly clause. Replace the special case for the 3688 duplicates with a general rule, so the script doesn't need to know about specific rows:
- `instance_count` = the **most common** row count per (physical card, quarter) for that benefit across its card type, not the maximum.
- Rows beyond that count in one quarter are entry duplicates: keep the one with the most advanced status, using rule 11's tie-break.

This gives 3 for Big Basket (3 in every quarter) and 1 for the 3688 doubles (1 everywhere else) without naming either.

### 2. Importing Monthly rows per quarter collides with live generation

The historical note says the sheet's Monthly rows are imported as **one quarter-grained instance each** (period = the quarter). That instance's `period_start` is the quarter start, e.g. **1 Jul**, which is also the `period_start` of the July monthly instance. Both share `(card_id, benefit_id, period_start = Jul 1, instance_number = 1)`. When generation later runs for July, `ON CONFLICT DO NOTHING` silently skips it. So **July never appears**, and an odd quarter-length "monthly" instance sits in its place.

**Fix:** don't import quarter-grained Monthly rows. On today's sheet all three are `Not Ordered` with no tracking data, so skip them and let generation create the real per-month instances. If a future Monthly row carries data (order date, code), map it to the month containing its order date. Update the historical note and the checklist to match.

---

## Worth fixing, not blocking

### 3. Hard-coded numbers are still in the Excel section

The intro now says "no number here is fixed," but these remain:
- **Column mapping table:** "NULL on 4 Golf rows," "NULL on 24 rows," "4 states," "6 real values; 21 cells," 38, 51, 11, 48, "21 present; 12 are…," and "`Q1`, `Q2`, `Q3` present" (Q4 now exists).
- **Rule 11:** "Verified lossless: all 21 discarded duplicates…"
- **Historical note:** "the two Excel `Monthly` rows… Q2 and Q3." It's three now, Q2–Q4, and the note goes away under #2 anyway.
- **Rule 9 and the checklist:** "BookMyShow… Monthly in Q2/Q3." It's now Q2–Q4.

Drop the numbers, or label them "as of 2026-10-09."

### 4. One clause in REQUIREMENTS to match the Sold decision

REQUIREMENTS §1/§6 define `Coupon Redeemed` as "coupon **used** at the merchant." With `Sold` now stored as `Coupon Redeemed` + `sold_for`, add "(or sold, if `sold_for` is set)" to that definition. Otherwise the two lines read as a contradiction.

---

## Status

Fix #1 and #2 (plus #3–#4 in the same pass) and I'll do a quick confirmation read. I expect to agree at that point.
