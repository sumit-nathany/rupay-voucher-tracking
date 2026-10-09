# Review Feedback — REQUIREMENTS.md + PLAN.md

> Fresh-eyes review per REVIEW_PROMPT.md. Reviewed 2026-10-09 against PLAN.md v3.0 and the current REQUIREMENTS.md.

**Verdict: not ready to build yet.** The shared catalog has two real bugs, and the main tenant-isolation mechanism doesn't protect the path the app actually uses. All of it is fixable on paper before any code exists (`web/` is still the stock Next.js scaffold).

Findings were checked against both docs' Open Items / Open questions sections. Only #8 and #11 are partly covered there already.

---

## Must address before building

### 1. Open Quarter can create the same instance twice

`benefit_instances` has `UNIQUE (card_id, catalog_id, override_id, period_start, instance_number)`. One of `catalog_id` / `override_id` is **always NULL**, and Postgres treats NULLs as distinct by default, so this constraint **never fires**. The plan relies on it for idempotency (Open Quarter is safe to run twice). `card_benefit_overrides` does use `NULLS NOT DISTINCT`, so this looks like an oversight.

**Fix:** add `NULLS NOT DISTINCT`, or use two partial unique indexes (one for catalog rows, one for override rows). Better still, see #2, which replaces the key.

### 2. A catalog version change brings back the annual double-count

The model says "change = close the old row, insert a new one", and instances are keyed by `catalog_id`.

Example: the bank changes Gaana Annual's wording, or Big Basket's count from 3 to 4, in July. Opening Q3 then finds a new `catalog_id` with no 2026 instance and **creates a second annual entitlement**, even though the first was redeemed in Q2. That's the exact bug entitlement periods were designed to stop.

**Fix:** add a stable **benefit identity** (`benefit_key`, shared by all versions of one benefit). Key instances on `(card_id, benefit_key, period_start, instance_number)` and keep `catalog_id` only as "which version generated this."

### 3. "Effective during the quarter" is defined two different ways

- REQUIREMENTS §5 says rows effective *during* the window (overlap).
- PLAN's Database notes say the quarter's range must fall *within* `[effective_from, effective_to)` (fully contained).

With containment, a benefit added mid-quarter doesn't appear until next quarter, and one dropped mid-quarter vanishes for the whole quarter. It's also unclear whether to test the **quarter** or the **entitlement period**: an annual row starting 1 Jul vs period `2026`. The `[from, to)` notation also conflicts with the CHECK allowing `effective_to = effective_from`.

**Fix:** write one rule: test overlap against the entitlement period, with both dates inclusive.

### 4. The "dropped benefit" requirement has no mechanism

REQUIREMENTS §5 says an opened quarter "must not silently keep generating benefits a bank has since dropped." Open Quarter only **adds** missing instances and never revisits existing ones. So:

- a dropped benefit's `Not Ordered` instance stays on the dashboard as "order this", and
- a benefit added mid-quarter appears only if each user re-clicks Open Quarter.

**Fix:** define the lifecycle. Instances still `Not Ordered` whose catalog row closed get flagged "Withdrawn by bank" and leave attention lists; anything ordered or later stays untouched.

Also consider dropping the Open Quarter button and generating lazily: "ensure instances for the current period" on page load. That removes a manual step and the stale-quarter problem, and it's arguably less code.

### 5. Overrides can add a benefit but can't remove a wrong one

REQUIREMENTS says users can correct a catalog that's "wrong" for them, e.g. "my card doesn't actually get Gaana." The schema only supports **additions**; `card_benefit_overrides.active` toggles the override itself, not a catalog row.

**Fix:** add a nullable `catalog_benefit_key` plus `kind IN ('add','suppress')`. Also specify what turning an override off does to instances already generated (same lifecycle as #4).

### 6. Per-tenant RLS doesn't protect the app's own queries

The app reaches the database through Drizzle over the pooler as the `postgres` role. Tables created by migrations are **owned by that role, and owners bypass RLS** unless `FORCE ROW LEVEL SECURITY` is set. So isolation actually rests on every server action remembering `WHERE workspace_id = ?`. The planned PostgREST curl test only checks the path the plan says is never used.

**Fix:** pick one and state it in the Security model:

- **Option A:** revoke all grants to the `anon` / `authenticated` roles, so PostgREST exposes nothing, and treat **app-layer scoping as the real guarantee**: one helper that always injects `workspace_id`, plus a test per action proving user A can't touch B's IDs.
- **Option B:** run each request with `SET LOCAL ROLE authenticated` and the user's JWT claims set in the transaction, so RLS really applies.

### 7. Users can attach other tenants' records by ID

`cards.holder_id`, `card_benefit_overrides.card_id`, and `benefit_instances.card_id` / `override_id` are plain foreign keys. Nothing forces the referenced row to belong to the same workspace. A crafted server-action call can attach your card to someone else's `holder_id`, or generate instances against their `card_id`.

**Fix:** use composite foreign keys on `(workspace_id, id)`, or require every action to verify ownership of each ID it's passed.

### 8. Identity is keyed on email, not user ID

`workspace_members.email` and `system_admins.email` drive both RLS and admin rights.

- Emails change, and email + Google sign-in can produce two auth identities for one address.
- If email confirmation is off, anyone can sign up as the owner's address first, which matters most for `system_admins`.

**Fix:** key both tables on `auth.users.id`, require email confirmation, and confirm `system_admins` has **zero** write grants outside migrations.

### 9. New public users can't add their own cards

`cards.bank_card_type_id` is NOT NULL, overrides hang off a card, and only the owner can add catalog rows, with no UI until Phase 8. A stranger whose card isn't among the owner's ~10 hits a dead end at step one. PLAN Open Item #1 names *who curates* but not this blocking consequence.

**Fix:** let users create a workspace-private "unverified" card type, with overrides as its only benefits, plus a "request this card" queue for the curator.

**Bigger push-back:** if the catalog will realistically cover only the owner's cards at launch, consider "multi-tenant architecture, invite-only launch." It keeps every schema decision and avoids an empty-catalog first impression for strangers.

### 10. "Zero benefits" and "not yet curated" look the same

REQUIREMENTS says some cards really get none. Today Open Quarter on a card type with no active rows silently creates nothing, and the user can't tell "nothing to order" from "nobody has entered this card yet."

**Fix:** add `curation_status` (`uncurated` / `curated` / `no_benefits`) on `bank_card_types` and show it on the card.

### 11. Phases 3–4 need sign-in, which isn't built until Phase 5

- RLS policies (Phase 1) and "scoped via the session's membership" (Phase 3) depend on an authenticated user that doesn't exist yet, so tenant scoping can't be tested until the end.
- **Phase 2 is labeled optional** but is a real dependency: "add a card by picking from the shared catalog" (Phases 3 / 4c / 5) needs catalog rows, and the only other way to write them (Phase 3's admin action) has no UI. Excel import is optional for *personal history*; **catalog seeding is not**.

**Fix:** move sign-in into Phase 1, keep deployment in Phase 5, and make catalog seeding (from Excel or by hand) a required gate.

### 12. Public signup with no privacy basics

Strangers will store **encrypted voucher codes (money)** and family names. PLAN excludes ToS entirely. For a public product in India you need at least a privacy notice and **account deletion**, which India's data-protection law (DPDP Act 2023) points toward. No foreign key has `ON DELETE` behavior defined, so deleting a workspace is currently blocked.

**Fix:** add a privacy notice, a delete-my-workspace action with defined cascade rules, and basic signup rate-limiting.

---

## Worth considering, not blocking

### 13. Sold coupons stay on "expiring soon"

A sold coupon keeps status `Coupon Received`, so it shows as needing use. Exclude rows with `sold_for` set from attention lists, or add a `Sold` status.

### 14. The "redeem" ambiguity is back

REQUIREMENTS bans "redeem," yet:

- REQ §3 defers "automation of the *redemption* process" while §9 says "the *ordering* step."
- PLAN uses "redemption" for ordering (Phase 7) and for using ("redemption happens on a phone at the store/gym").

The status `Coupon Redeemed` is fine as an inherited Excel label; fix the prose.

### 15. REQUIREMENTS §5 still says "for each bank card type and calendar year"

That's leftover from before effective-dating, and the year isn't part of the model anymore.

### 16. Quarters are assumed to be calendar quarters, but nothing states it

Neither doc says quarters are Jan–Mar and annual is the calendar year, as opposed to April–March or card-anniversary. Confirm it and write it into REQUIREMENTS.

### 17. The reserved `scope_year` / `scope_period_label` columns aren't needed

The stated reason ("avoids a migration touching every existing override row") is wrong: adding a nullable column in Postgres doesn't rewrite rows. The UNIQUE constraint would need changing anyway. Drop them.

### 18. "Never mutated in place" blocks typo fixes

Every catalog typo fix would create a new version. Allow in-place **corrections** and keep new rows for real **changes**.

### 19. Smaller drift between the two docs

- "12 tables" is actually **11**.
- The Tech stack table lists Resend and Vercel Cron as v1.
- The Settings page says notification-prefs UI is "built now," but Phase 6 builds it.
- Open Quarter sits on the Catalog-overrides page, though it's a quarter-start daily action.
- Several justifications assume Excel data was imported ("65 not-ordered items," "Q1/Q2 have many lapsed items").
- The quarter-grained Monthly special case only exists for the optional import; drop it.

### 20. Pushing reminders past v1 may undercut the main goal

The stated pain is missed benefits and expired coupons, and a dashboard only helps when someone opens it. A daily expiry digest is small, and the cron would also stop Supabase's free tier from pausing. Worth reconsidering, at least expiry emails to the account owner.

---

## Also found

- Tie each voucher's encryption to its instance ID (AES-GCM associated data), so an encrypted code can't be swapped onto another row.
- Backups hold every tenant's data: decide where they live and keep the encryption key elsewhere.
- `workspace_members.email UNIQUE` caps each user at one workspace (fine, just state it).
- Vercel Hobby is non-commercial only; fine while there's no monetization.

---

## Suggested next step

Fixes #1–#5 all reshape the catalog/instance schema, so settle them together first, starting with the `benefit_key` decision in #2.
