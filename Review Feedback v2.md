# Review Feedback v2 — PLAN.md v4.0 + REQUIREMENTS.md

> Second-round review, 2026-10-09. Round 1 findings are in `Review Feedback.md`; numbering here is new.

**Verdict:** much better, but not ready to start Phase 1. Most round-1 fixes landed cleanly, but dropping RLS opened a new hole that is now the most serious issue.

**Round-1 status:**
- **Fixed:** #1, 2, 3, 7, 8, 10, 11, 13, 15, 16, 17, 18.
- **Deliberately deferred or reduced by invite-only:** #9, 12, 20.
- **Only partly fixed:** #4, 5, 14, 19 (remaining gaps are covered below).

---

## Must fix before Phase 1

### 1. With RLS gone, every table may be open to anyone holding the public key

v4 drops RLS entirely, and the Supabase anon key is `NEXT_PUBLIC_` (it ships to every browser). Under Supabase's defaults, tables created in `public` by SQL migrations get **full grants to `anon` / `authenticated`**, with RLS off. That would mean anyone can read every row through the auto-generated API (PostgREST), including encrypted codes and invite codes, and **insert themselves into `system_admins`**. Nothing in v4 revokes those grants. The curl check that would catch it runs in Phase 5, after data exists.

**Fix:** in the Phase 1 migration, do one of:
- put app tables in a schema the API doesn't expose (e.g. `app`), or
- `REVOKE ALL ... FROM anon, authenticated`, plus RLS on with no policies (deny-all).

Move the curl check to Phase 1. Confirm with Supabase's Security Advisor once the project exists.

### 2. Lazy generation as written breaks the mid-quarter requirement

Phase 4a generates "when a user views a period that **hasn't been generated yet**." Once Q3 has been viewed, a benefit the bank adds in August never appears, which contradicts REQUIREMENTS §5.

**Fix:** run "ensure instances" on **every** view. It's idempotent and cheap at ~120 rows. Spell out `INSERT ... ON CONFLICT DO NOTHING` so two tabs don't race.

### 3. Lazy generation has no limit on which periods it fills

As written, browsing to 2022 or 2030 creates instances there. Viewing Q1 for a card added in August creates a pile of fake "Lapsed" items.

**Fix:** only generate for periods from the card's tracking start (new `cards.tracking_from`, or `created_at`) up to the current period.

### 4. Two versions inside one period is undefined

The overlap rule means a version closed 15 Aug **and** its replacement from 16 Aug both overlap Q3. Which `instance_count` or wording wins?

A **frequency** change under the same identity is worse. Quarterly Q3 and Monthly July both have `period_start = Jul 1`, so they collide on the unique key: the July instance is silently skipped while Aug and Sep get created.

**Fix:** two rules.
- Each period uses the version in effect on a single chosen date, e.g. period start, or today for the current period.
- A frequency change creates a **new benefit identity**, not a new version.

Also say what happens when `instance_count` goes down (instance #4 left behind).

### 5. The withdrawal check can be read two ways

The sweep says "no active (open-ended **or still-overlapping**) version." Overlapping *what*? If it means the instance's own period, a benefit dropped on 15 Aug still overlaps Q3, so its `Not Ordered` instance stays orderable until October. That breaks "never asked to order something that no longer exists."

Also, nothing un-withdraws an instance if a curator closes a version by mistake and reopens it.

**Fix:** withdraw when the version's `effective_to < today`, reverse it when an active version reappears, and state whether users can set or clear `Withdrawn` themselves.

### 6. What overrides do to existing instances is still unspecified (carried over from round-1 #5)

Suppress a benefit that already has a `Not Ordered` instance and it stays on the dashboard. Generation skips it but nothing removes it. Same for switching off an `add` override.

**Fix:** the same sweep rule as #5, applied to suppress-on and add-off.

### 7. An invited user can end up locked out with a 403

Supabase Auth creates the user (`auth.users` row) at sign-up, *before* any invite code is checked, and with Google there's no hook in between. Security model #4 says "no membership → 403," so a confirmed user who hasn't redeemed a code is stuck. Also missing:
- Redemption must be atomic (`UPDATE ... WHERE redeemed_by IS NULL RETURNING`).
- Who can mint codes isn't stated.
- The owner bootstrap order is circular: `system_admins` needs the owner's `user_id`, which doesn't exist until they sign up, which needs a code.

**Simpler alternative:** turn off public signups in Supabase and use its built-in **invite-by-email**. That drops the `invite_codes` table and all of the above. Otherwise, route no-membership users to a "redeem invite" page instead of a 403, and write out the bootstrap sequence.

### 8. The `auth.users` foreign keys break the "local Postgres" option

Phase 1 allows local Postgres, but `REFERENCES auth.users(id)` only exists on Supabase, so migrations fail locally. It also contradicts "no vendor-specific features."

**Fix:** store `user_id UUID` with no foreign key, or require Supabase (its CLI runs locally).

### 9. PLAN still tells agents signup is public

- Product summary (line 143): "Any RuPay cardholder can sign up."
- "Do NOT build" list (line 230): "public signup itself is in scope."

An agent reading top-down gets that before the invite-only decision.

**Fix:** rewrite both.

### 10. Isolation tests only cover actions that change data

Read leaks are the bigger risk, and **reveal-code** is a read that decrypts money. Composite foreign keys don't protect reads at all.

**Fix:** require a test for **every** server action, reveal-code first.

---

## Worth fixing, not blocking

### 11. "14 tables" is 13

Count the Phase 1 list: it names 13.

### 12. "Open Quarter" still appears in three places

REQUIREMENTS §5 (line 85), PLAN's entitlement section (lines 123–125) and the Pages table (line 182). All conflict with lazy generation.

### 13. Leftovers from the old schema and the import

- The verification checklist still says `(catalog_id, ...)` and "72 catalog entries."
- Line 123 still describes the quarter-grained Monthly import that Open Item 4 says to drop.
- Project structure still marks the seed script "(optional)."

### 14. The reminder section uses a column that no longer exists

It references `workspaces.default_reminder_email`, which v4 removed.

### 15. Smaller round-1 drift is still there

- "Redemption" is still used for ordering (Phase 7 title, kickoff prompt) and for using (line 170).
- Settings still says notification preferences are "built now."
- The "65 not-ordered" and "Q1/Q2 lapsed" rationales still assume imported data.

### 16. `Withdrawn` isn't in REQUIREMENTS §6's status list

It's defined only in §5.

### 17. "Workspace owner" now means two things

It's used for *the* curator (the project owner), but every user owns a workspace. Say "system admin."

### 18. Some integrity gaps the composite foreign keys don't catch

- An instance's override can belong to a different card in the same workspace.
- An instance's `benefit_id` can belong to a different card type than its card.
- If the catalog later adds a benefit a user had already added themselves, they get it twice. Prompt them to retire their own copy.

### 19. Invite-only doesn't fully cover uncatalogued cards

A friend's card still needs a `bank_card_types` row first, which only the system admin can create. Write that down as the invite step: create their card type as `uncurated`, then they use `add` overrides.

---

## Suggested next step

#1 is a one-line migration decision. #2–#6 together are the generation and withdrawal rules, best written as one short spec section.
