# Review request: RuPay Voucher/Benefit Tracker — REQUIREMENTS.md + PLAN.md

You are reviewing two documents for a personal project, written collaboratively with another AI assistant over several iterations. Please review them with fresh eyes — don't assume prior decisions were right just because they're written down confidently. Flag anything that seems wrong, inconsistent, underspecified, or over-engineered.

## Files to review

- `REQUIREMENTS.md` — product requirements ("what"), should be the authoritative source on scope.
- `PLAN.md` — architecture and build plan ("how"), should implement what REQUIREMENTS.md describes.

Read both files in full before reviewing.

## Background (for context the documents may under-explain)

RuPay is an Indian government-built card payment network (like Visa/Mastercard). Banks issue RuPay credit/debit cards and, through the "RuPay Benefits" program, each bank chooses which perks (cab credits, OTT subscriptions, gym memberships, grocery vouchers, etc.) apply to which of its card types — some cards get none. Benefits reset quarterly, half-yearly, or annually depending on the specific benefit.

Using a benefit involves two separate actions: (1) **ordering** it on the RuPay Benefits website, which produces a coupon code a few days later, and (2) **using** that coupon code at the actual merchant before it expires (30 days to a year later, independent of the quarter it was ordered in). The user has been tracking this manually in a large Excel sheet across multiple cards, multiple banks, and multiple family members' cards, and it's become error-prone — benefits get missed, coupons expire unused, and the sheet doesn't auto-carry-forward which annual/half-yearly benefits are already handled when a new quarter starts.

The user wants to replace the spreadsheet with a web app. Key decisions already made (documented in the files, but worth scrutinizing):

- The product should be **public and multi-tenant from v1** — any RuPay cardholder can sign up, not just the original user. This is a late addition that reshaped a lot of the architecture (originally designed single-tenant/private).
- The catalog of "which benefits apply to which bank + card type" should be **shared, centrally-curated reference data** across all users, not something each user manually enters per card — because the same bank card type's benefits are identical for every cardholder who has it. This catalog needs to support banks changing/dropping/adding benefits mid-year without corrupting historical tracking data.
- Reminders (expiry/order-deadline nudges) and future browser-automation of the ordering step are explicitly deferred past v1.
- Importing the user's historical Excel data is explicitly optional, not a launch requirement.

## What to focus on

1. **Internal consistency** — do REQUIREMENTS.md and PLAN.md actually agree with each other? Look for terminology drift, scope statements that contradict each other, or sections that seem to reference a decision that was later changed elsewhere without full propagation.
2. **Soundness of the shared/versioned catalog design** — this is the riskiest and newest part of the architecture (see PLAN.md's Database section: `bank_card_types`, `benefit_catalog` with effective-dating, `card_benefit_overrides`, and how `benefit_instances` ties back to either one). Does the effective-dating model actually work for the stated goal (bank changes benefits mid-year without rewriting history)? Are there edge cases it doesn't handle — e.g., what happens to an already-open quarter's instances if the catalog changes after the quarter was opened but before it ends? What happens on "Open Quarter" if a card's bank_card_type has zero active catalog rows?
3. **Multi-tenancy correctness** — given public signup is now in scope, is the tenant-isolation design (per-tenant RLS policies, `workspace_members`, the new `system_admins` table for catalog curation) actually sufficient and correctly scoped? Is there any path where one user's data or the ability to write shared catalog data could leak across tenants?
4. **Scope sanity** — is anything marked "v1" that's actually more complex than it needs to be for a personal-project-turned-small-SaaS? Conversely, is anything deferred that really shouldn't be (e.g., is "Excel import is optional" actually fine, or does some later phase secretly assume imported data exists)?
5. **Build-phase ordering** — do the phases in PLAN.md's "Build phases" section have any hidden dependency problems (a later phase assuming something an earlier phase doesn't actually deliver)?
6. **Anything genuinely missing** — authentication edge cases, data model gaps, security gaps, or product requirements implied by the Background section above but not actually written down anywhere in REQUIREMENTS.md.

## What NOT to do

- Don't just restate what the documents already say back as a summary.
- Don't nitpick prose style or formatting — focus on substance: correctness, consistency, completeness, and risk.
- Don't assume omissions are intentional — if something seems like a gap, say so, even if the documents don't flag it as an open question themselves (both files have "Open questions"/"Open items" sections already; check whether your findings are already captured there before raising them as new).

## Output format

A prioritized list of findings. For each: what's wrong or missing, why it matters, and (if you have one) a concrete suggested fix. Separate "must address before building" from "worth considering but not blocking."
