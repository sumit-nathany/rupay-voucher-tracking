# RuPay Voucher Tracker — Core Functional Requirements

> States **what the product must do**. Implementation detail lives in [PLAN.md](./PLAN.md). Both files are reconciled as of this revision — if they ever drift again, this file is authoritative on product scope.

---

## 1. Background

RuPay is an Indian card network (like Visa/Mastercard, built by the Indian government). Banks issue RuPay credit and debit cards and, through the **RuPay Benefits program**, each bank chooses which benefits apply to which of its card types — some cards get none. Benefits reset quarterly, half-yearly, or annually.

**A benefit involves two distinct actions, not one — this distinction matters throughout this document:**
1. **Ordering** the benefit on the RuPay Benefits website. This produces a coupon code, but not instantly — it typically arrives a few days later.
2. **Using** that coupon code at the merchant. The coupon itself has its own expiry, separate from the quarter/half/year it was ordered in — anywhere from 30 days to a year.

Both steps are easy to forget independently: a user can forget to order a benefit before its ordering deadline, *or* forget to use a coupon before it expires after successfully ordering it. The word "redeem" is ambiguous between these two and is avoided below in favor of **order** (step 1) and **use** (step 2).

**Constraint that shapes usage:** only one benefit can be **ordered** per RuPay account per 24 hours. People with several cards often spread them across family members' separate RuPay-linked bank accounts to order more per day. This product does not need to automate that workaround — it needs to let each person track their own cards, and their family members' or friends' cards too if they want to, all under one account.

---

## 2. Purpose

Replace the Excel-based RuPay benefit tracker with a web app that:

- knows, for a given bank and card type, which benefits apply (so adding a card doesn't mean manually typing in its benefit list), and
- at the start of each quarter, shows exactly which benefits can actually be **ordered** now — correctly excluding ones already ordered (or used) under a half-yearly or annual cycle — removing the manual "copy last quarter, figure out what still applies" work.

---

## 3. Scope

### In scope (v1)
- RuPay Benefits program tracking only — not a general card/rewards tracker.
- Multi-tenant architecture, **signup gated to invite-only for v1** (see §4) — the full public-signup experience is not turned on until the shared catalog realistically covers enough cards that a stranger isn't met with an empty, broken-feeling first run.
- A shared **reference catalog** of bank + card type → benefits (type, provider, frequency), maintained centrally, not per user.
- Manual entry/correction of a user's own benefits is allowed where the shared catalog is wrong or incomplete — both adding a missing benefit and suppressing one the catalog wrongly claims applies (see §5).
- Quarter-aware status tracking per benefit instance, with correct carry-forward logic for half-yearly/annual benefits.

### Deferred (not v1)
- Reminders (expiry, order-lapse, stale order).
- Browser automation of the ordering process itself.
- Multi-user accounts per family (see §4 — a user manages their whole family's cards under one login via labels, not via separate sign-ins).
- Turning public signup fully open (currently invite-only — see above).
- Privacy notice, account-deletion flow, and other pre-public-launch legal/compliance groundwork. Required before opening signup publicly, not before v1's invite-only build.

### Out of scope
- Not a spreadsheet clone: no 16-column grid as the primary UI.
- Bulk voucher trading — only tracking the sale of an individual benefit instance (`sold_for`) is in scope.

---

## 4. Actors & tenancy

- A **workspace** is the tenant boundary: one signed-up user's holders, cards, and benefit data, isolated from every other workspace.
- Access requires authentication **and** workspace membership.
- A **card holder** is a free-form label within a workspace (e.g. Papa, Mummy, Sumit) — not a separate login. One person manages all their family's cards under their own account.
- The architecture is multi-tenant and intended to eventually work for other RuPay cardholders, not just the one user who built it — but **signup itself is invite-only for v1**. The multi-tenant design (workspaces, shared catalog, tenant isolation) is built in full now; only the "anyone can sign up" door is closed until the shared catalog is populated enough that a new stranger isn't met with an empty catalog and no way to add their own card (see §5, §10).

---

## 5. Domain model

### Shared reference data
- **Bank card types**: a catalog of (bank, card type) combinations — e.g. "PNB RuPay Select Credit Card." Each has a **curation status** — `uncurated` (nobody has entered its benefits yet), `curated` (benefits are entered and believed current), or `no_benefits` (confirmed the bank genuinely gives this card type nothing). This distinction matters: a card showing zero benefits must never leave the user guessing whether that's correct or just not yet looked at.
- **Benefit catalog**: for each bank card type, the benefits it carries — type, provider, exact benefit, frequency, instance count (e.g. 3× Big Basket/period), optional default cash value. This is shared across all users, maintained centrally (manually curated for v1; not user-editable as shared truth). It is not scoped to a calendar year — see versioning model below.
- Benefits are **not static year to year, or even quarter to quarter** — banks add, drop, or change benefits for a card type at any point. The catalog must support changing what applies to a bank card type mid-year, and a quarter opened under an old catalog state must not silently keep generating benefits a bank has since dropped. This makes catalog upkeep an ongoing task, not a one-time setup.
- **Versioning model:** every benefit has a stable identity that persists across changes to its wording, count, or other details — "this is the same benefit, just updated," not "this is a new benefit." Each version of a benefit is effective-dated (`effective_from` / `effective_to`, with no `effective_to` meaning still active). A small in-place correction (fixing a typo, a wrong frequency that was always wrong) edits the existing version; a real change (the bank changes what the benefit actually is, or when it applies) closes the old version and opens a new one under the same stable identity. A quarter's generated instances are tied to that stable identity, not to one specific version — so a wording/count update to an in-progress benefit does not create a second, duplicate entitlement for the same period.
- **Which version applies to a period, when more than one overlaps it:** a period uses the **earliest version whose effective window overlaps the period** — equivalently, the version in effect on `max(period_start, that version's effective_from)`. This picks the period-start version whenever one exists (the common case), but also correctly picks up a benefit added **mid-period** (no version existed at the period's start, but one started partway through) rather than generating nothing for it. An **in-place correction** (fixing a typo or a wrong detail — see below) to the chosen version is visible **immediately**, including to an already-generated instance, since the instance refers to the version by its stable identity, not a frozen copy of its details; only a genuine **new version** (a real change, replacing the old one) waits until the next period to take effect. **An instance is only generated once that chosen version has actually started** (`effective_from <= today`) — a version dated to start next month does not get an instance today just because its window happens to overlap the period; it first appears on the earliest view on or after its own start date, which is what "visible mid-period" means (Review Feedback v4.md #2).
- **A frequency change is a new benefit, not a new version.** If a bank changes how often a benefit resets (e.g. Quarterly → Monthly), that is treated as retiring the old benefit identity (its last version closes) and creating a brand-new benefit identity starting from the change. This is necessary because periods are keyed by frequency — a Quarterly period and a Monthly period can start on the same date, and treating a frequency change as "just a new version of the same benefit" would make it ambiguous which period structure applies. If `instance_count` decreases (e.g. 3 Big Basket instances per period down to 2), the extra pre-existing instance for the current period is left as-is (not deleted) — the lower count only affects instance generation for periods from the change onward.
- **"Active" is one definition, used everywhere a lapse check happens:** a version (or override) is active on date D if `effective_from <= D AND (effective_to IS NULL OR effective_to >= D)`. A version that hasn't started yet (future `effective_from`) is not active today even though its `effective_to` is NULL — it does not count as covering a benefit that's otherwise lapsed.
- **Dropped-benefit lifecycle, as one stateless eligibility rule recomputed every time (no history of "what it was before" is stored or needed):** for every instance with `period_end >= today` whose status is `Not Ordered` or `Withdrawn` — a catalog-sourced instance is **eligible** if its benefit has a version active today (per the definition above) **and** the card has no active `suppress` override for it; an override-sourced instance is **eligible** if its `add` override is active. Set the instance to `Withdrawn` if not eligible, otherwise `Not Ordered`. This single rule is what makes the sweep bidirectional and covers every combination (dropped by the bank, suppressed by the user, or both at once, in any order of being fixed) without needing to remember what the instance's previous state was. **Generation and this sweep run together, in the same transaction**, so a freshly generated instance of an already-ineligible benefit never shows as orderable even for one view. A past period's instance that's still `Not Ordered` (`period_end < today`) is left showing as **Lapsed** and is never touched by this rule: that reflects "this was missed," not "the bank later dropped it," and the two must stay visually and semantically distinct. An instance already ordered, received, or redeemed is untouched regardless of period; dropping the benefit never erases history.
- A benefit added **mid-quarter** should become visible without requiring the user to manually re-trigger anything — see PLAN.md for how instance generation is actually triggered (not a manual "Open Quarter" action — see §5's Entitlement periods section below).

### Per-workspace data
- **Holders** → **Cards** (each card is an instance of a bank card type, owned by a holder) → **Benefit instances** (per entitlement period, generated from the shared catalog for that card's bank card type).
- A user may correct their own card's benefits where the shared catalog is incomplete or wrong, without affecting other users, in two ways: **adding** a benefit the catalog is missing, or **suppressing** a benefit the catalog wrongly claims applies to their card. Both are **simple on/off**: active from whenever the user adds them until they remove them — no effective-dating on the user's side, unlike the shared catalog. **For v1, an override persists indefinitely (across years and quarters) until the user turns it off themselves.** Year/quarter-scoped overrides (e.g. "only for 2026") are a possible future refinement, not built now and not reserved for in the schema.

### Entitlement periods
Benefit instances are keyed by **entitlement period**, derived from frequency — not duplicated once per quarter. **Quarters are calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec) and "Annual" means the calendar year** — not a financial year (Apr–Mar) or a card-anniversary year. This matches the source Excel data and is assumed throughout; if a future benefit genuinely runs on a different cycle, that's a new case to design for, not something this table already covers.

| Frequency | Periods/year | Example label |
|-----------|-------------|---------------|
| Quarterly | 4 | `2026-Q3` |
| Annual | 1 | `2026` |
| 6 months | 2 | `2026-H1` |
| Monthly | 12 | `2026-07` |

Instance generation happens automatically whenever a user views a period, not via a manual action — see PLAN.md for the mechanics. Viewing a quarter generates that quarter, each of its months that has started, the half-year containing it, and the year — so a single quarter view surfaces every granularity relevant to it, not just the quarter itself. Generation is idempotent — a half-yearly or annual benefit already ordered does not reappear as pending in the next quarter — and only ever creates instances for periods that had **ended** on or after the card's tracking-start date (so a card added partway through a year still gets that year's annual benefit and its first quarter, rather than being bounded by the exact day it was added); it must never retroactively fill in periods that ended before tracking started, or periods that haven't started yet.

**If the shared catalog later adds a benefit a user had already covered with their own `add` override** (the catalog catches up to something the user noticed first), the user ends up with the same benefit twice unless they notice and retire their own override. The app should surface this — e.g. flagging an `add` override whose description closely matches a newly-added catalog benefit — but detecting the match is a judgment call, not something guaranteed to be automatic in v1; the user remains responsible for retiring their own override once it's redundant.

---

## 6. Workflow

- Statuses, mapped to the two actions in §1: `Not Ordered` → `Ordered but Coupon not received` (**ordering** in progress) → `Coupon Received` (**ordered**, coupon in hand, not yet **used**) → `Coupon Redeemed` (coupon **used** at the merchant, or sold, if `sold_for` is set — see below).
- `Skipped` (app-only): deliberately not ordering this period. Excluded from attention lists. Reversible.
- **`Sold`**, if a benefit instance was handed off/sold, is treated as a **variant of `Coupon Redeemed`** (the coupon was used, just by someone else who paid for it), not a separate status — tracked via `sold_for` plus the existing `Coupon Redeemed` status, per the user's decision (2026-10-09). This matches the plan's original design; the live Excel sheet's own `Sold` status column value maps to `Coupon Redeemed` + a `sold_for` amount on import.
- `Withdrawn` (app-only, system-driven, not user-settable): the bank dropped this benefit (or the user suppressed/un-added it) while the instance was still `Not Ordered`. Excluded from attention lists. Automatically reversed back to `Not Ordered` if the benefit becomes active again — see §5's "Dropped-benefit lifecycle."
- Both forward and backward status transitions are allowed.
- Per instance, the app tracks: cash value, sold-for amount, order date (when ordering was initiated), expiry date (when the received coupon must be used by), booking ID, comments, and an encrypted voucher code.
- Voucher codes are masked by default; revealed only on explicit user action.
- An instance with a `sold_for` amount recorded has already been handed off and must not appear in "expiring soon" or other attention lists, even if its status is still `Coupon Received` — it is someone else's problem to use now, not the tracking user's.

---

## 7. Must-answer questions

The app must let a user answer, at a glance:

1. What can I order right now, this quarter?
2. Which received coupons are expiring soon and need to be used?
3. What hasn't been ordered yet for this period?
4. Show me everything for a given holder or card.

---

## 8. Security non-negotiables

- Voucher codes encrypted at rest; never appear in logs, errors, or UI by default.
- All data access server-side — the browser never queries the database directly.
- One workspace's data must never be visible to another workspace.
- The source Excel file (live card codes/PINs) must never be committed or uploaded anywhere.

---

## 9. Later phases (explicitly deferred, not forgotten)

- Reminders: coupon-expiry warning (use it before it expires), order-lapse warning (order it before the deadline), stale-order warning.
- Browser automation of the ordering step on the RuPay Benefits website.
- Anything related to the 24-hours-per-account ordering limit (e.g. suggestions on sequencing orders across holders) — not required; users handle this themselves today.

---

## 10. Open questions

- Who curates and maintains the shared bank/card-type → benefit catalog as banks change their offers? (Manual curation assumed for v1 — by the **system admin** (the person who built this, distinct from any individual workspace owner — every signed-up user "owns" their own workspace, which is a different thing), via direct access, not a built UI — see PLAN.md.)
- ~~When a user overrides a shared catalog entry for their own card, does that override persist across years, or only for the year it was made?~~ **Decided:** persists indefinitely for v1 (on/off only). Year/quarter-scoped overrides are a possible later refinement, not built now.
- Historical Excel data import is explicitly **not required** for v1 — confirm nothing downstream assumes it exists. **Catalog seeding is a different matter and is required** — Phase 3/4c features that let a user "add a card by picking from the shared catalog" need the catalog to actually have rows in it, whether those come from an Excel-derived seed, hand-entry, or both (see PLAN.md Build phases).
- ~~Is public signup fully open, or gated?~~ **Decided:** invite-only for v1 (see §3/§4), via Supabase Auth's built-in admin-invite-by-email — not a custom invite-code system. Revisit once the catalog realistically covers enough cards.
- **Inviting someone whose card isn't in the catalog yet:** since only the system admin can create a new `bank_card_types` row, inviting a friend whose bank/card combination has never been seen requires the system admin to first create that row (as `uncurated`) before or when sending the invite — otherwise the new user has nothing to attach their card to. This is a real step in the invite process, not an edge case to ignore; the new user can then use `add` overrides to describe their own benefits against that uncurated row.
