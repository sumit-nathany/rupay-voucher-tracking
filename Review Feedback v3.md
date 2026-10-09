# Review Feedback v3 — PLAN.md v5.0 + REQUIREMENTS.md

> Third-round review, 2026-10-09. Earlier rounds: `Review Feedback.md`, `Review Feedback v2.md`. Numbering here is new.

**Verdict:** close, but the new version-selection rule broke the mid-period requirement, and the withdrawal sweep has precision bugs. The answer to "are the #18 limitations stated precisely?" is: **mostly not, because three of them can actually be enforced by the database**, contrary to what the doc says.

**Round-2 status:**
- **Landed correctly:** #2, #5/#6 (bidirectional sweep), #7 (invite-by-email), #8, #9, #10 (read tests, reveal-code first), #14, #16, #17, #19. Open Quarter and "redemption" references are gone.
- **Landed with a gap:** #1 (lockdown, see #9 below), #3 (boundary, see #5), #4 (see #1–#2), #11 (count still wrong), #13 (seeding rules, see #8), #15 (Settings line), #18 (see #7).

---

## Must fix before Phase 1

### 1. "Version in effect at period start" drops benefits added mid-period

Generation step 2 says: pick the version in effect at the period's start date; if none, generate nothing. A benefit the bank adds on 10 Aug has no version on 1 Jul, so **Q3 gets nothing**, and an annual benefit added in March gets **nothing for the whole year**. That is exactly the REQUIREMENTS §5 case ("a benefit added mid-quarter should become visible") that round 2 #2 was fixing.

It also hits frequency forks: old Quarterly identity closes 15 Aug, new Monthly identity starts 16 Aug, so August (starts 1 Aug) gets nothing.

**Fix:** keep "exactly one version per period," but choose it as **the earliest version whose window overlaps the period**. Equivalently: the version in effect on `max(period_start, version.effective_from)`. This gives the same answer as today's rule whenever a version covers the period start, and fixes mid-period additions. Update REQUIREMENTS §5, PLAN generation step 2, Phase 3 prompt and the kickoff prompt together (all four state the start-date rule).

### 2. "Corrections apply from the next period" contradicts in-place correction

REQUIREMENTS §5 and PLAN step 2 both say a correction made mid-period doesn't change what an in-progress instance shows. But a correction is an in-place `UPDATE` of the same version row, and instances point at that row (`generated_from_version`), so a typo fix **shows immediately**. Both can't be true.

**Fix:** state that in-place corrections show immediately (the point of a typo fix); only a *new version* waits for the next period.

### 3. The sweep's "active" test counts future versions as active

The sweep treats a benefit as active if it has a version with `effective_to IS NULL`. A version scheduled to start next month also has `effective_to IS NULL`. So with V1 closed 15 Aug and V2 starting 1 Sep, on 20 Aug the benefit counts as "active" and nothing is withdrawn. "And nothing has superseded it" is undefined.

**Fix:** one definition, used everywhere: a version is active on date D if `effective_from <= D AND (effective_to IS NULL OR effective_to >= D)` (both ends inclusive). Delete the "superseded" clause.

### 4. The sweep would hide real misses from past periods

As written, the sweep touches every `Not Ordered` instance of a dropped benefit, including past periods that already show as **Lapsed**. Withdrawing those rewrites history: "you missed this" turns into "the bank dropped it."

**Fix:** sweep only instances whose `period_end >= today`.

### 5. Which periods a view generates is no longer written anywhere

Deleting the old Open Quarter text also deleted the mapping from "user views Q3" to concrete periods. An implementer now has "ensure instances exist for period X" with no definition of X.

**Fix:** write it out.
- Viewing quarter Q ensures, for every active card: Q itself, each month of Q that has started, the half containing Q, and the year.
- The Dashboard ensures the current quarter's set.
- **Boundary:** generate a period if `period_end >= cards.tracking_from`, not `period_start`. Otherwise a card added in February never gets that year's annual benefit or its first quarter.
- Say what happens for `cards.active = false` and `bank_card_types.active = false`: skip generation, and do their `Not Ordered` instances withdraw?

### 6. "Today" has no timezone

The sweep, the "not started yet" bound, and `tracking_from DEFAULT CURRENT_DATE` all depend on today's date. Vercel functions and Supabase run in **UTC**, so between midnight and 05:30 IST "today" is still yesterday: a card added at 1 AM on 1 Oct gets `tracking_from = 30 Sep`, and a new quarter appears 5.5 hours late.

**Fix:** compute today as `Asia/Kolkata` in one helper and pass it in. Don't use DB `CURRENT_DATE` as the column default; set it from the app.

### 7. Three of the "not DB-enforceable" invariants are enforceable, and the list is incomplete

The doc says these can't be foreign keys "since benefits has no workspace_id." They don't need `workspace_id`; they need a matching column on both sides:

- **Override belongs to the instance's card:** add `UNIQUE (workspace_id, card_id, id)` on `card_benefit_overrides`, and on `benefit_instances` use `FOREIGN KEY (workspace_id, card_id, override_id) REFERENCES card_benefit_overrides (workspace_id, card_id, id)`. With `override_id` NULL the default MATCH SIMPLE skips it, which is exactly right.
- **Benefit belongs to the card's type** (instances and suppress overrides): add a copied `bank_card_type_id` column to both tables, `UNIQUE (id, bank_card_type_id)` on `benefits`, `UNIQUE (workspace_id, id, bank_card_type_id)` on `cards`, and two foreign keys: one to `benefits (id, bank_card_type_id)`, one to `cards (workspace_id, id, bank_card_type_id)`.
- **Recorded version belongs to the instance's benefit:** `UNIQUE (id, benefit_id)` on `benefit_catalog_versions`, and `FOREIGN KEY (generated_from_version, benefit_id) REFERENCES benefit_catalog_versions (id, benefit_id)`. This invariant isn't in the doc's list at all.

Two more gaps the list misses:
- **Editing a card's type breaks everything retroactively.** "Card CRUD" allows changing `cards.bank_card_type_id`, which silently invalidates every existing instance and suppress override on that card. Either forbid it (make it immutable) or define what happens. The foreign keys above would make it fail loudly instead of silently.
- **"The only code path that writes instances" is false.** The optional Excel import also writes `benefit_instances`. App-only invariants must be enforced there too, which is one more reason to move them into the database.

**Recommendation:** use the foreign keys. Then the "NOT ENFORCED BY THE SCHEMA" comments shrink to just the curation judgment (correction vs. new version).

### 8. The seeding rules would create one card type per physical card

The Excel mapping says each of the 10 Card names becomes its own `bank_card_types` row. But `PNB Imperial (7825)`, `(1746)` and `(5110)` are one product held by three people. That gives three card types with three copies of every benefit, which defeats the shared catalog. The dedup key `(card, calendar_year, ...)` is also per *card*, not per *type*.

**Fix:**
- Derive the type by stripping the last digits.
- Dedup benefits by `(bank_card_type, benefit_type, provider, exact_benefit, frequency)`. Frequency is now part of identity per the fork rule.
- Rule 8's "resolve to Monthly" still contradicts Phase 2's "two identities." Delete it.
- Recompute the checklist's "72 benefits": the BookMyShow fork alone makes it 73, and type-level dedup will make it much lower.

### 9. `REVOKE ALL ON ALL TABLES` doesn't cover tables created later

That statement only affects tables that exist when it runs. Supabase's **default privileges** re-grant `anon`/`authenticated` on every table a later migration creates, and sequences and functions are separate grants.

**Fix:** prefer the non-exposed `app` schema option, which covers future tables automatically. If staying in `public`, also run `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES, SEQUENCES, FUNCTIONS FROM anon, authenticated`, and re-run the curl check after every migration.

Separately, the `system_admins` comment says it is "**explicitly excluded from** whatever PostgREST exposure lockdown Phase 1 performs." That's the opposite of what's meant, and an agent could follow it literally. It should say "explicitly included in."

### 10. `add` overrides can have no instance count

The CHECK for `kind = 'add'` requires type, exact benefit and frequency, but not `instance_count`, so it can be NULL and generation has no number to use. No table checks `instance_count >= 1` either.

**Fix:** require `instance_count IS NOT NULL` for `add`, and add `CHECK (instance_count >= 1)` on both tables.

---

## Worth fixing, not blocking

### 11. 12 tables, not 13

`invite_codes` was removed, but the schema header, Phase 1 prompt and Decision summary still say 13. (`grep -c "^CREATE TABLE"` gives 12.)

### 12. Settings still says notification preferences are "built now"

Line 184. This is round-2 #15, not applied.

### 13. "Replicate as per-workspace lookup values"

The Excel validations heading (line 71) contradicts the global catalog.

### 14. Plain local Postgres can't deliver Phase 1's auth

Removing the `auth.users` FKs fixed migrations, but Phase 1 also requires Supabase invites and login. That needs a Supabase project or the Supabase CLI's local stack. Say so.

### 15. The invite gate is now a single toggle

Any user with no membership gets a workspace automatically. If self-signup is ever re-enabled by mistake, or a user is created by another path, they're in. Fine for v1; worth one line in the Security model. Also, Supabase's built-in email sender is limited to a few emails an hour, which is fine for a handful of invites.

---

## Suggested next step

Fix #1–#6 together as one rewritten "Instance generation and withdrawal" spec: one version-selection rule, one "active on date D" definition, one timezone, and an explicit view-to-periods mapping. Then #7 (the foreign keys) and #8 (seeding) are self-contained schema edits.
