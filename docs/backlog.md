# Product Backlog — RuPay Voucher Tracker

> **Status:** Living backlog. Not a spec. Each item is small enough for one agent to pick up end-to-end.
> **Source:** Product-improvement review of the full `web/` app, `worker/`, the shared catalog, and `REQUIREMENTS.md`.
> **Authority:** `REQUIREMENTS.md` wins on product scope. If an item here conflicts with it, the item is wrong and must be corrected here first. `PLAN.md` remains the authority on how the system is built.
> **Related:** [AGENTS.md](../AGENTS.md) (repo rules, migration invariants, architecture), [REQUIREMENTS.md](../REQUIREMENTS.md), [PLAN.md](../PLAN.md), `docs/automated-rupay-ordering-*.md`.

---

## 0. How to use this backlog

1. Pick **one** item. An item is done when its acceptance criteria pass, its tests pass, and the item is struck from this file (or moved to a `Done` section at the bottom).
2. Before writing code, read `AGENTS.md`. It is binding. The rules that bite most often:
   - Domain functions take `Ctx` as first argument; domain code must never import `@/db` or read the session.
   - `workspaceId` always comes from the session, never from caller input. Every new server action needs a tenant-isolation test.
   - All business rules live in `web/src/domain/` + `web/src/actions/`, never only in the UI.
   - Migrations must be 100% backward compatible: additive only, new columns nullable or with a safe default, no drops/renames in the same release. Use expand-and-contract.
   - Never commit `.env*`, `*.xlsx`, voucher codes, booking IDs, OTPs, or PINs.
3. New migrations → `npm run db:generate` from `web/`, review the SQL, then `npm test` (PGlite replays every migration) and `npm run build`.
4. Every item below that touches the schema must state its migration compatibility in its "Migrations" note.
5. Preserve the in-place-editing rules in `AGENTS.md` (drawers/dialogs: same DOM structure, permanently mounted action buttons, no scroll jumps, styled native `<select>` inside drawers).

**Priority legend**

| Priority | Meaning |
|---|---|
| **P0** | User-visible breakage or data-integrity risk. Do first. |
| **P1** | High user value, blocks a documented user need. |
| **P2** | Real value, lower urgency. |
| **P3** | Hygiene, cleanup, polish. |

**Effort legend:** S ≈ ≤1 day · M ≈ 2–4 days · L ≈ 1–2 weeks (incl. testing).

---

## 1. Index

| ID | Title | Area | Priority | Effort | Depends on |
|---|---|---|---|---|---|
| **A-01** | Reminder engine: expiry / order-lapse / stale-order | Proactive notifications | P1 | L | — |
| **A-02** | Telegram digest channel | Proactive notifications | P1 | M | A-01 |
| **A-03** | Email digest channel | Proactive notifications | P2 | M | A-01 |
| **A-04** | WhatsApp digest channel | Proactive notifications | P3 | M | A-01, A-02 |
| **A-05** | Reminder preferences UI | Proactive notifications | P1 | M | A-01 |
| **A-06** | In-app attention centre (bell + unread badge) | Proactive notifications | P2 | M | A-01 |
| **B-01** | Active-filter chips on `/benefits` | Work queue / triage | P1 | S | — |
| **B-02** | Search scope no longer silently ignores filters | Work queue / triage | P0 | S | — |
| **B-03** | Bulk status actions on the work queue | Work queue / triage | P1 | L | B-05 |
| **B-04** | Server-side pagination + filtering for `listInstances` | Work queue / triage | P1 | M | — |
| **B-05** | "Needs attention" saved views (default landing) | Work queue / triage | P1 | M | B-01, B-04 |
| **B-06** | Push `offerKind` / `lapsed` filtering into SQL | Work queue / triage | P2 | S | B-04 |
| **C-01** | Route error boundaries + retryable `ErrorPanel` | Resilience | P0 | S | — |
| **C-02** | Guarded data loading on all authenticated pages | Resilience | P0 | M | C-01 |
| **C-03** | Surface silent client-side action failures | Resilience | P1 | M | C-01 |
| **C-04** | Curation-status clarity: `uncurated` vs `no_benefits` | Onboarding | P1 | M | — |
| **C-05** | "Card type not in catalog" request path | Onboarding | P1 | M | C-04 |
| **C-06** | Redundant `add`-override detection (catalog catches up) | Onboarding | P2 | M | — |
| **C-07** | First-run onboarding wizard: coverage & empty states | Onboarding | P2 | M | C-04 |
| **D-01** | Real table semantics for the benefits list (a11y) | Accessibility | P1 | M | — |
| **D-02** | Accessible names for benefit rows (a11y) | Accessibility | P2 | S | D-01 |
| **D-03** | Visible labels + live result counts for filters (a11y) | Accessibility | P2 | S | — |
| **D-04** | `EmptyState` announced to screen readers (a11y) | Accessibility | P3 | S | — |
| **D-05** | Search & filter for cards / holders / accounts / overrides | Discoverability | P1 | M | — |
| **D-06** | Search & filter for the admin catalog | Discoverability | P2 | M | — |
| **D-07** | Mobile: benefits grid horizontal scroll & search field width | Mobile | P2 | S | — |
| **D-08** | Delete dead `mobile-app-chrome.tsx` | Hygiene | P3 | S | — |
| **D-09** | Stop logging OTPs / chat IDs / phone numbers | Security hygiene | P0 | S | — |
| **D-10** | Missing empty states (automation, attempts, catalog) | Polish | P3 | S | — |
| **D-11** | Filter-option load failure is swallowed silently | Resilience | P1 | S | C-02 |
| **D-12** | Warn on `uncurated` catalog rows in admin catalog | Polish | P3 | S | C-04 |

---

# Area A — Proactive notifications

> **Context.** `REQUIREMENTS.md` §1 states the product exists because people forget two independent things: ordering before the deadline, and using a received coupon before it expires. §9 lists reminders (coupon-expiry, order-lapse, stale-order) as deferred. `web/src/db/schema.ts:470-519` already ships `notification_preferences` and `reminder_log`, commented `// ── Reminders (schema only; wired up in a later phase) ──`. The `reminder_log` uniqueness constraint on `(instance_id, reminder_type, days_before)` is already shaped for dedupe. Telegram and WhatsApp are already integrated for OTP delivery (`web/src/app/api/webhooks/telegram/`, `.../whatsapp/`) and the Telegram webhook already links a chat to a workspace via `/start <workspaceId>`.
>
> **This area is the single highest-value change in the backlog.** Nothing else turns a passive tracker into an assistant.

---

### A-01 — Reminder engine: expiry / order-lapse / stale-order

**Priority:** P1 · **Effort:** L · **Depends on:** none

**Problem.** The application is entirely passive. A user must open the dashboard or `/benefits` to discover that a coupon is about to expire or that an order deadline has passed. The schema for reminders exists but is unwired, so no reminder has ever been sent.

**Evidence**
- `web/src/db/schema.ts:470-519` — `notification_preferences`, `reminder_log`; both unused by any code path.
- `web/src/components/dashboard/expiring-soon.tsx` and `action-queue-cards.tsx` compute the *inputs* for reminders but only render them.
- No `remind*` / `notif*` logic anywhere in `web/src/domain/` (`web/src/domain/` contains: `workspace-data.ts`, `instances.ts`, `instance-queries.ts`, `generation.ts`, `automation.ts`, `automation-worker.ts`, `ordering-queue.ts`, `catalog-admin.ts`, `benefit-values.ts`, `profile.ts`, `benefit-offer-kind.ts`, `benefit-label.ts`, `card-label.ts`).

**Definitions to implement (a reminder fires when all conditions hold):**

| Type | Condition | Extra guard |
|---|---|---|
| `expiry` | Instance status = `Coupon Received`, `expiryDate` is within `daysBefore` days of today, and `sold_for` is NULL. | Sold instances are explicitly excluded from attention lists (`REQUIREMENTS.md` §6). |
| `order_lapse` | Instance status = `Not Ordered` (not `Skipped`, not `Withdrawn`) and the entitlement period's ordering deadline is within `daysBefore` days, or the period has already ended. | `Withdrawn` instances are excluded (`REQUIREMENTS.md` §5). `Skipped` is a deliberate user choice and must never be nagged (`REQUIREMENTS.md` §6). |
| `stale_order` | Instance status = `Ordered but Coupon not received` and the order date is older than N days (suggest N = 7). | Stale orders are usually resolved by the automation worker; do not fire while an automation attempt for that instance is in flight. |

**User story.** *As a cardholder, I want to be told before a coupon expires or an ordering deadline passes, so that I don't lose benefits I was entitled to.*

**Acceptance criteria**
1. A pure, testable function `computeDueReminders(ctx, today, opts)` lives in `web/src/domain/reminders.ts` and returns the set of instances due for each reminder type, given a per-workspace `daysBefore` list.
2. The function applies the guards in the table above. Tests must cover: sold instance excluded from `expiry`; `Skipped` excluded from `order_lapse`; `Withdrawn` excluded from `order_lapse`; `expiryDate` in the past excluded (already expired — a different message, or no message); instance with NULL `expiryDate` excluded.
3. A dispatch step writes one `reminder_log` row per `(instanceId, reminderType, daysBefore)` before sending, and never sends a duplicate for an existing log row. Use an `INSERT ... ON CONFLICT DO NOTHING` on the existing unique key and only send when the insert actually inserted a row — this is the dedupe guarantee, and it must be enforced in SQL, not in application logic alone.
4. The dispatch step is idempotent and safe to re-run. Re-running the same day sends nothing new.
5. Scheduling: the engine runs as a step inside the deployed worker's Cloud Run Job (see `docs/environments-and-deployment.md` §8), on the same hourly sweep as ordering, and can also be triggered manually. It must respect `ctx.today` semantics: `today` is `YYYY-MM-DD` in **Asia/Kolkata** (`web/src/lib/periods.ts`).
6. Sending is pluggable: the engine produces `ReminderEnvelope[]` (workspace, channel, recipient, subject/body, instance refs) and a separate `send*` implementation delivers them. The engine itself must not know about Telegram/SMTP.
7. Every envelope is rendered with **no voucher code and no booking ID** in the body (AGENTS.md: "Voucher codes and booking IDs never appear in logs, errors, test output, or script output"). Codes are referenced by benefit name + masked card last-4 only.
8. Failures to send are recorded and surfaced to the user in the attention centre (A-06); a failed send must not block the dedupe log from being written for *other* reminders, and must not cause a retry storm — one send attempt per reminder per day.

**Technical notes**
- Reuse the `web/src/domain/instance-queries.ts` query builders rather than writing new SQL, so workspace scoping stays in one place.
- The `expiry` and `order_lapse` reminders are per **instance**, not per card — a card can carry 5 benefits with 5 different expiry dates.
- For `order_lapse`, the deadline is the entitlement period's `period_end` (and possibly an earlier portal ordering deadline). Use `period_end` for v1; a separate `orderingDeadline` column is out of scope.
- The `notification_preferences` table is currently **holder-scoped** (`holderId` unique, `web/src/db/schema.ts:479`). A workspace-level default is needed so a new workspace has sensible defaults without creating a row per holder. See Migrations.

**Migrations** (backward compatible, additive only)
- Add a workspace-level preferences table or nullable/defaulted columns. Options, pick one and document it:
  - (a) New table `workspace_notification_settings(workspace_id PK, email_enabled, days_before int[], channel, digest_hour_ist, created_at, updated_at)`. Purely additive, zero risk to running code.
  - (b) Add nullable columns to `notification_preferences` — awkward because that table is holder-scoped and has a `NOT NULL` `holderId`.
  - **Recommendation: (a).** It is additive, avoids reshaping an existing table, and lets a workspace have a default while holders can override.
- If a `reminder_log` backfill is needed for rows written before a schema change, write it as a hand-written migration in `web/drizzle/` following the pattern of the existing hand-written migrations (`0005`, `0007`, `0008`). Do **not** edit a generated migration.

**Files to touch**
- `web/src/db/schema.ts` (new table)
- `web/src/domain/reminders.ts` (new)
- `web/src/domain/reminders.test.ts` (new)
- `web/src/actions/reminders.ts` (new) — thin `getCtx()` wrappers
- `worker/src/batch.ts` (the Cloud Run Job entry point — invoke the reminder step from it)

**Tests**
- Domain unit tests for `computeDueReminders` covering every guard in the table above.
- A dedupe test: run dispatch twice for the same day, assert the second run sends zero envelopes and the `reminder_log` row count is unchanged.
- A tenant-isolation test: workspace A's dispatcher must never produce an envelope containing workspace B's instance.

**Non-goals.** No push notifications, no SMS, no in-app real-time push (websocket), no per-user timezone (Asia/Kolkata only).

---

### A-02 — Telegram digest channel

**Priority:** P1 · **Effort:** M · **Depends on:** A-01

**Problem.** The Telegram bot is already deployed and already links chats to workspaces, but it can only complete OTP challenges. There is no way for it to *inform* the user.

**Evidence**
- `web/src/app/api/webhooks/telegram/route.ts` — handles `/start <workspaceId>` linking and OTP extraction.
- `web/src/components/automation/otp-channels-section.tsx` — the user-facing place where a Telegram chat ID is configured today (buried under Automation → Setup & Channels).
- `web/src/db/schema.ts:523-532` — `automationSettings.telegramChatId` already stores the chat ID.
- `web/src/lib/telegram-client.ts` — a `TelegramClient` interface with `RealTelegramClient` / `MockTelegramClient` implementations and a `getTelegramClient()` factory. **Reuse this**; do not write a second HTTP client.

**User story.** *As a cardholder, I want a short daily Telegram message telling me what needs my attention, so that I can act without opening the web app.*

**Acceptance criteria**
1. A `telegram` send implementation of the `ReminderEnvelope` channel, using the workspace's configured `telegramChatId`.
2. Extend the existing `TelegramClient` interface in `web/src/lib/telegram-client.ts` with a `sendMessage(chatId, text, opts)` method (or a sibling `sendDigest` method), implemented on `RealTelegramClient` and stubbed on `MockTelegramClient`. Reuse `getTelegramClient()`; the existing `RealTelegramClient` already holds the bot token, so no new token plumbing is needed beyond confirming the env var name it reads.
2. The message is a **digest**, not one message per reminder: grouped by category (expiring / order-lapse / stale) with counts and a short list, and a deep link back to the relevant filtered `/benefits` view (the benefits page already accepts URL filters — see `web/src/app/(app)/benefits/page.tsx`).
3. The digest is capped (e.g. top 20 items, then "and N more — open the app").
4. If a workspace has no `telegramChatId`, the engine skips that workspace silently (no error, no empty message) and records nothing in `reminder_log` for it, so that enabling Telegram later still sends a first digest.
5. The `/start <workspaceId>` linking flow is reused to auto-populate `telegramChatId` when a user starts the bot — today it links a chat but the user must still paste the chat ID into the Automation setup form. The new flow must ask for confirmation before writing, and must not silently overwrite an existing chat ID.
6. The bot gains a `/remind` command that sends the digest on demand.
7. All Telegram sending is done server-side via the existing `RealTelegramClient`. Confirm the env var name it already reads for the bot token (do not introduce a second token env var); it must remain server-only and must never appear in a log line.

**Files to touch**
- `web/src/lib/telegram-client.ts` (extend `TelegramClient` with a message-sending method; add to `MockTelegramClient`)
- `web/src/app/api/webhooks/telegram/route.ts` — extend commands
- `web/src/components/automation/otp-channels-section.tsx` or a new `/profile` section (see A-05)

**Tests.** Sender unit test with a mocked fetch asserting the payload shape and that no voucher code appears in the rendered message. Webhook test asserting `/start <workspaceId>` links and `/remind` triggers a digest.

**Risks.** Telegram API rate limits (≈30 msg/s per bot) — a per-workspace digest keeps us far below that. Confirm the bot token is present in the prod and preprod Vercel environments (it already is, since OTP delivery works) and add it to `.env.example` if it isn't there yet.

---

### A-03 — Email digest channel

**Priority:** P2 · **Effort:** M · **Depends on:** A-01

**Problem.** `notification_preferences.email_enabled` defaults to `true`, but nothing sends email. The default is a lie.

**Evidence.** `web/src/db/schema.ts:480` — `emailEnabled: boolean("email_enabled").default(true)`.

**User story.** *As a cardholder who does not use Telegram, I want a daily email summary so that I do not need to check the app.*

**Acceptance criteria**
1. An `email` send implementation. Prefer sending via Supabase Auth's built-in SMTP (no new provider) if the workspace owner's email can be addressed; otherwise document the chosen provider.
2. The email contains a plain-text summary *and* an HTML version. The HTML version must not include voucher codes (link to the app instead).
3. The recipient is the workspace owner (from the Supabase auth user), not a holder label.
4. Sending respects `emailEnabled`.
5. If Supabase's built-in email service is rate-limited (it is, and it enforces a low per-hour ceiling on custom SMTP), document the actual limit in the item's notes and design the send path so the provider can be swapped without touching the engine.
6. Unsubscribe: the email must include a one-click link that disables email for that workspace. Implement it as a signed, expiring token stored in a new table, or reuse an existing signed-URL mechanism if one exists in `web/src/lib/`.

**Migrations.** If an unsubscribe-token table is added, it must be additive with a nullable `expires_at` and a unique token column.

**Risks.** Supabase built-in SMTP is not for production transactional mail; document the limitation in `docs/environments-and-deployment.md` and flag it for the operator.

---

### A-04 — WhatsApp digest channel

**Priority:** P3 · **Effort:** M · **Depends on:** A-01, A-02

**Problem.** The WhatsApp webhook handles inbound OTP only. Outbound WhatsApp requires Meta Business API approval and a per-message cost, so this is deliberately last.

**Acceptance criteria**
1. Reuse the verified `senderPhone` / Meta webhook plumbing in `web/src/app/api/webhooks/whatsapp/route.ts`.
2. Outbound send via the Meta Graph API with a template message (WhatsApp requires approved templates for business-initiated messages). Extend `web/src/lib/whatsapp-client.ts` (`WhatsAppClient` interface, with `MetaWhatsAppClient` / `TwilioWhatsAppClient` / `MockWhatsAppClient` implementations) rather than writing a new client.
3. `automationSettings.whatsappPhoneNumber` is the recipient.
4. Document the Meta template-approval prerequisite in `docs/automated-rupay-ordering-requirements.md` or a new `docs/whatsapp-templates.md`.
5. If the operator has not completed Meta approval, this item stays blocked — mark it clearly and do not block A-01/A-02 on it.

---

### A-05 — Reminder preferences UI

**Priority:** P1 · **Effort:** M · **Depends on:** A-01

**User story.** *As a cardholder, I want to choose when and how I am reminded, so that reminders are useful rather than noise.*

**Acceptance criteria**
1. A section on `/profile` (not buried in Automation) titled "Reminders" showing, per holder: channel on/off, digest time, and the `daysBefore` list.
2. `daysBefore` is editable as a multi-select of `7, 3, 1` (the schema default, `web/src/db/schema.ts:481`) plus `14` and `30`. Values are validated server-side and stored as an int array.
3. A "send a test reminder now" button, so the user can confirm the channel works before relying on it.
4. A "mute all reminders" switch at the workspace level.
5. The UI states plainly which reminders exist: coupon expiry, order lapse, stale order — each with a one-line explanation, so the user understands what "order lapse" means.
6. All writes go through a server action → domain function → `Ctx` pattern, with a tenant-isolation test. `workspaceId` is never taken from the client.

**Files to touch**
- `web/src/components/profile/profile-view.tsx` (or a new `web/src/components/profile/reminder-settings.tsx`)
- `web/src/actions/reminders.ts`
- `web/src/domain/reminders.ts`

---

### A-06 — In-app attention centre (bell + unread badge)

**Priority:** P2 · **Effort:** M · **Depends on:** A-01

**Problem.** Even with digests, a user who prefers the app has no single "what needs me" surface; the dashboard scatters it across four panels.

**User story.** *As a cardholder, I want a single badge showing how many items need my attention, so that I know whether to look further.*

**Acceptance criteria**
1. A bell icon in the app shell top bar (`web/src/app/(app)/app-shell.tsx`) showing an unread count of items needing attention right now: coupons expiring within 7 days, order deadlines within 7 days, stale orders.
2. Clicking it opens a panel listing the items grouped by type, each linking to the corresponding filtered `/benefits` view.
3. The count comes from a domain function reusing `computeDueReminders` so the badge and the digest never disagree.
4. The count is workspace-scoped and cached per request; do not add a background-polling client loop.
5. Items already surfaced in a digest are still counted (the count is "needs attention", not "unseen") — document this in the UI copy so it does not look like a read-receipt counter.

---

# Area B — Work queue / triage

> **Context.** `/benefits` is the product's core screen (the page even titles itself "Work queue"). It currently renders every matching instance with no pagination, holds filter state only in the URL, and offers no bulk operations. `REQUIREMENTS.md` §7 lists four questions the app must answer "at a glance"; none of them is answered by the current screen alone.

---

### B-01 — Active-filter chips on `/benefits`

**Priority:** P1 · **Effort:** S · **Depends on:** none

**Problem.** The user cannot see which filters are active. The only affordance is a "Clear all filters" button (`web/src/components/benefits/filters.tsx:139-143`), so the user has to remember what they set.

**Evidence.** `web/src/app/(app)/benefits/page.tsx` — filters are parsed from the URL and applied silently; no summary is rendered.

**User story.** *As a user, I want to see which filters are currently applied, so that I know why the list looks the way it does.*

**Acceptance criteria**
1. A row of removable chips appears above the list when any filter is active, each showing the filter's human-readable label and value (e.g. "Holder: Papa", "Status: Coupon Received", "Search: cab").
2. Each chip removes only its own filter and leaves the others intact.
3. Chips are derived from the same parsed filter object the page already builds — one source of truth, no duplicate parsing.
4. The chip row is keyboard navigable and each chip's remove control has an accessible name that includes the filter ("Remove holder filter").
5. The chip row is hidden entirely when no filter is active.

---

### B-02 — Search scope no longer silently ignores filters

**Priority:** P0 · **Effort:** S · **Depends on:** none

**Problem.** When `search_scope=all` is active, the holder / card / status / category filters are **ignored** but remain visible and clickable — only dimmed to 60% opacity with a `title` tooltip. A user who selects "Search across everything", types "cab", and then picks a holder sees no change in results but no error either. Silently ignoring a control the user just operated on is the worst kind of filter bug.

**Evidence.**
- `web/src/components/benefits/filters.tsx:147-150` — `opacity-60` + `title` attribute only.
- `web/src/app/(app)/benefits/page.tsx` — `searchScope` is passed through, and when `searchScope === 'all'` the other filters are dropped from the query.

**User story.** *As a user, I want filters to either apply or be visibly unavailable, so that I never act on a control that does nothing.*

**Acceptance criteria**
1. When `search_scope=all` is active, the scope-dependent filter controls are **disabled** (native `disabled` on the trigger, `aria-disabled`, dimmed) and the reason is shown as visible text next to the search input, not only as a `title` tooltip. `title` alone is invisible to touch users and screen-reader users on some platforms.
2. The visible explanation names the scope explicitly, e.g. "Searching every period, holder and card. Holder, card, status and category filters are off."
3. A disabled control must not be operable: clicking it does not open the dropdown and does not write to the URL.
4. Alternative accepted design: keep the filters enabled and actually apply them to the global search (i.e. `search_scope=all` means "search all periods" but still respect holder/card/status). If this design is chosen, the copy must change to match. Either outcome is acceptable; silently ignoring is not.
5. Regression test: with `search_scope=all` and a holder filter set, either the filter is applied to results or the control is disabled — asserted in the UI test or a component test.

---

### B-03 — Bulk status actions on the work queue

**Priority:** P1 · **Effort:** L · **Depends on:** B-05

**Problem.** The most repetitive operation in the product is moving an instance forward one step ("I ordered this", "the coupon arrived", "I used it"). Today each instance requires opening the drawer, clicking a status button, and closing it. A user with 20 benefits to mark does 20 round-trips. There is no bulk affordance anywhere.

**User story.** *As a user, I want to select several benefits and mark them all as ordered in one action, so that keeping the tracker current takes seconds instead of minutes.*

**Acceptance criteria**
1. Row checkboxes appear in the work queue; a sticky action bar appears when ≥1 row is selected.
2. Supported bulk operations: **Mark ordered** (→ `Ordered but Coupon not received`), **Skip** (→ `Skipped`), **Unskip**, **Mark coupon received** (→ `Coupon Received`), **Mark used** (→ `Coupon Redeemed`). Keep this list to the status transitions that carry no additional required data — do **not** bulk-record a sale (needs `sold_for`) or bulk-edit dates.
3. The bulk action is **one** server action that applies to a list of instance ids, not N calls. It must run in a single database transaction: all-or-nothing.
4. Every transition is validated by the **existing** domain rules — reuse `assertTransition` (`web/src/domain/instances.ts`) and `setStatus` per instance rather than re-implementing transition legality. A bulk action must not be able to produce a state a single-instance action would reject.
5. Partial failure handling: if one instance in the batch is invalid (e.g. workspace mismatch, illegal transition), the entire batch fails with a clear per-instance reason, and **no** instance is modified. Do not partially apply.
6. Instances whose id belongs to another workspace are rejected (tenant isolation) — this must have a dedicated test, per AGENTS.md.
7. The UI reports the outcome: "12 benefits updated" or the specific error with the offending benefit named.
8. Selection survives a filter change? No — clear selection when the filter set changes, and say so. (Do not silently keep a selection the user can no longer see.)

**Technical notes**
- Reuse `web/src/domain/instances.ts` `assertTransition` + `setStatus` inside a `ctx.db.transaction(...)`. The pattern already exists in the codebase — `ctx.db.transaction(async (tx) => { ... })` is used in `web/src/domain/workspace-data.ts:477`, `web/src/domain/catalog-admin.ts:174,211,259,295`, and `web/src/domain/generation.ts:69`. Follow that exact shape.
- A pure "which transitions are legal" helper should be extracted so the client can grey out impossible bulk targets before the user clicks — but the server must still re-validate.

---

### B-04 — Server-side pagination + filtering for `listInstances`

**Priority:** P1 · **Effort:** M · **Depends on:** none

**Problem.** `listInstances` has no `LIMIT`/`OFFSET` and returns every matching row; the client renders them all. A workspace with a few years of history across a family can accumulate thousands of instances, and every page load ships all of them.

**Evidence.** `web/src/domain/instance-queries.ts:439` — `listInstances` builds conditions and calls `query(ctx, conds…)` with no limit clause. `web/src/components/benefits/benefit-list.tsx` renders the full array.

**User story.** *As a long-term user, I want the work queue to load quickly regardless of how much history I have accumulated, so that the app stays usable.*

**Acceptance criteria**
1. `listInstances` accepts a `limit` (default 50, max 200) and a cursor or `offset`, and the total matching count is returned alongside the page via a `count(*)` query.
2. The benefits page renders a pager (prev/next + "showing X–Y of Z") that is URL-driven (`?page=2`) so a filtered view is linkable and the back button works.
3. The sort is deterministic across pages — the current sort (`period_end asc`, then benefit name) must be fully deterministic; if the secondary key can tie, add a unique tiebreaker (`id`) or the pager will show duplicates/skips across pages.
4. The empty state distinguishes "no results for this filter" from "no results at all" (the current `EmptyState` already attempts this — keep both branches correct under pagination).
5. Filter option lists (`listBenefitFilterOptions`, `listCategoryFilterOptions`) must **not** be paginated — they must always return all options, or a user cannot select a holder that is off-page.
6. A tenant-isolation test: paginating with an instance id from another workspace returns nothing from that workspace.

**Technical notes.** Do not put `limit` inside the `and(...)` conditions array; apply it to the query builder's limit/offset. Check how `query()` is defined in `web/src/domain/instance-queries.ts` before editing.

---

### B-05 — "Needs attention" saved views (default landing)

**Priority:** P1 · **Effort:** M · **Depends on:** B-01, B-04

**Problem.** The app answers "what do I do now?" by scattering it across the dashboard's four panels, the `ExpiringSoon` panel, and the raw table on `/benefits`. There is no single screen that is "my work", and the work queue's default state is "everything in this period, unfiltered".

**Evidence.** `web/src/components/dashboard/action-queue-cards.tsx` (three cards: needs ordering / awaiting coupon / coupon in hand), `web/src/components/dashboard/expiring-soon.tsx`, `web/src/app/(app)/benefits/page.tsx`.

**User story.** *As a user, I want one screen that lists only the things I can act on today, so that I can work through my benefits in a few minutes.*

**Acceptance criteria**
1. A new view mode on `/benefits` (URL param, e.g. `?view=attention`) that resolves to a concrete filter set:
   - **Order now** — `status=Not Ordered`, current period, `lapsed=0`, excluding `Skipped`/`Withdrawn`.
   - **Expiring soon** — `status=Coupon Received`, `sold_for IS NULL`, `expiryDate` within 14 days.
   - **Awaiting coupon** — `status=Ordered but Coupon not received`, order date older than 7 days (the `stale_order` set).
   - **Lapsed** — `status=Not Ordered` with a past `period_end`.
2. The three `REQUIREMENTS.md` §7 questions ("what can I order right now", "which coupons are expiring soon", "what hasn't been ordered") map one-to-one onto saved views, and each is reachable in one click from the dashboard cards (the dashboard cards already build `/benefits` URLs — see `web/src/components/dashboard/benefits-link.ts`).
3. Saved views are shareable/bookmarkable: each is a URL with explicit params, not hidden client state.
4. The attention view shows a count per bucket and an explicit "nothing needs you right now" state — a reassuring empty state, not a blank table.
5. The view must respect the workspace's `today` (Asia/Kolkata) and must not double-count an instance that qualifies for two buckets.
6. Optional but desirable: a `?view=attention` default landing for the workspace's *first* page after sign-in, once the workspace has been onboarded. Make this a workspace setting, not a hard-coded redirect.

**Files to touch**
- `web/src/components/benefits/filters.tsx` (view switcher)
- `web/src/app/(app)/benefits/page.tsx` (parse + resolve the view param into filters)
- `web/src/domain/instance-queries.ts` (support the `expiryDate` window and `sold_for IS NULL` conditions — these are new conditions, not expressible today)

---

### B-06 — Push `offerKind` / `lapsed` filtering into SQL

**Priority:** P2 · **Effort:** S · **Depends on:** B-04

**Problem.** Two filters are applied *after* the full result set is materialized, in JavaScript, on every request.

**Evidence.** `web/src/domain/instance-queries.ts:501-507`:
```
if (!isAll) {
  const offerFilter = f.offerFilter ?? 'voucher';
  if (offerFilter === 'voucher') items = items.filter((it) => it.offerKind !== 'discount');
  else if (offerFilter === 'discount') items = items.filter((it) => it.offerKind === 'discount');
  if (f.lapsed === '1') items = items.filter((it) => it.lapsed);
  else if (f.lapsed === '0') items = items.filter((it) => !it.lapsed);
}
```

**Acceptance criteria**
1. `offerKind` filtering becomes a SQL condition on the joined benefit's offer kind.
2. `lapsed` becomes a SQL condition derived from `period_end < today` and status — document the exact definition used in SQL so it matches `InstanceListItem.lapsed` exactly (the current JS predicate uses a precomputed `lapsed` flag, so the SQL must reproduce it, not approximate it).
3. The `isAll` branch (lifetime scope / search across everything) must keep its current behaviour of not applying these filters, unless B-02's alternative design is chosen.
4. A test asserts the SQL and the previous JS behaviour agree on a fixture set containing expired, skipped, withdrawn, discount and sold instances.

**Notes.** This becomes materially more important once B-04 lands; doing it first is fine but the query-builder changes will touch the same code.

---

# Area C — Onboarding & resilience

> **Context.** The product is invite-only for v1 (`REQUIREMENTS.md` §3), so a new user is a family member or friend invited by the system admin. Their first run is the highest-leverage moment in the product, and it is also the moment where the shared catalog's incompleteness hurts most (`REQUIREMENTS.md` §10: "inviting someone whose card isn't in the catalog yet ... requires the system admin to first create that row (as `uncurated`) before or when sending the invite").

---

### C-01 — Route error boundaries + retryable `ErrorPanel`

**Priority:** P0 · **Effort:** S · **Depends on:** none

**Problem.** There is **no** `error.tsx`, `global-error.tsx`, or `not-found.tsx` anywhere under `web/src/app`. Any unhandled server error in an authenticated page renders Next.js's default error screen, which tells a non-technical user nothing and loses the app's navigation. `AGENTS.md` explicitly requires that errors be logged and shown via `<ErrorPanel message={...} />` — but there is no boundary to catch what the pages don't catch.

**Evidence.**
- No `error.tsx` / `global-error.tsx` / `not-found.tsx` under `web/src/app` (verified by glob over the whole app dir).
- `web/src/components/dashboard/error-panel.tsx` — the only in-app error UI, and it offers only "Reload the page to try again" (no retry button), unlike `web/src/components/benefit-detail/benefit-drawer.tsx:140` which does have a retry.
- `web/src/app/(app)/loading.tsx` exists, so the loading side is covered; the error side is not.

**User story.** *As a user, if something goes wrong I want to see a friendly in-app message and a way to retry, so that a transient failure does not look like the app is broken.*

**Acceptance criteria**
1. `web/src/app/(app)/error.tsx` — a client error boundary scoped to the authenticated app. It must render the `ErrorPanel` (or a variant of it) with the error message, a "Try again" button that calls `reset()`, and a "Sign out" escape hatch.
2. `web/src/app/(app)/not-found.tsx` — an in-app 404 with navigation back to the dashboard (e.g. a stale `/benefits?...` bookmark or a deleted card link).
3. `web/src/app/global-error.tsx` — a root boundary that renders a self-contained HTML document (it cannot rely on the app layout).
4. `ErrorPanel` gains a `retry` action (optional prop) and is used consistently; the message shown must be `err instanceof Error ? err.message : String(err)` per `AGENTS.md`.
5. Errors are logged with a component-scoped prefix, e.g. `console.error('[benefits]', err)`, so logs identify the surface.
6. No stack trace, query text, or voucher code appears in the user-visible message. Sanitise before rendering if the message could contain one.

**Files to touch**
- `web/src/app/(app)/error.tsx` (new)
- `web/src/app/(app)/not-found.tsx` (new)
- `web/src/app/global-error.tsx` (new)
- `web/src/components/dashboard/error-panel.tsx` (add retry support)

---

### C-02 — Guarded data loading on all authenticated pages

**Priority:** P0 · **Effort:** M · **Depends on:** C-01

**Problem.** Only `/accounts` and `/profile` wrap their data fetch in `try/catch` → `ErrorPanel`. `/cards`, `/holders`, `/overrides`, `/automation`, and `/admin/catalog` let a DB error throw to the boundary, so one failed query takes down the whole page. `/automation` fetches `getAutomationDashboardAction()` completely unguarded.

**Evidence.** Page files under `web/src/app/(app)/`: `accounts/page.tsx` (guarded), `profile/page.tsx` (guarded), `cards/page.tsx`, `holders/page.tsx`, `overrides/page.tsx`, `automation/page.tsx`, `admin/catalog/page.tsx`, `admin/catalog/edit/page.tsx` (unguarded).

**User story.** *As a user, I want one broken section to fail on its own, so that the rest of the page still works.*

**Acceptance criteria**
1. Every authenticated page wraps its server-side data fetch in `try/catch`, logs with `console.error('[<page>]', err)`, and renders `<ErrorPanel message={...} />` in place of the failed section.
2. `/automation` is the highest priority — the page currently fails wholesale on one query failure.
3. The panel message is `err instanceof Error ? err.message : String(err)`.
4. Section-level isolation, not page-level: where a page composes several independent panels (like the dashboard already does in `web/src/components/dashboard/dashboard-content.tsx`), each panel gets its own boundary so one failure doesn't blank the page.
5. No silent swallowing: a caught error must be logged **and** shown. (Contrast with D-11, where an error is caught, logged nowhere, and hidden.)

**Files to touch.** `web/src/app/(app)/cards/page.tsx`, `holders/page.tsx`, `overrides/page.tsx`, `automation/page.tsx`, `admin/catalog/page.tsx`, `admin/catalog/edit/page.tsx`, and `web/src/components/automation/automation-dashboard.tsx` if the fetch lives there.

---

### C-03 — Surface silent client-side action failures

**Priority:** P1 · **Effort:** M · **Depends on:** C-01

**Problem.** Several client components catch action errors and only `console.error` them, so the user sees a UI that silently reverts. In the automation queue, a failed reorder or a failed auto-sort produces **no** feedback whatsoever.

**Evidence.**
- `web/src/components/automation/order-queue-section.tsx:82-84` (refresh), `:93-96` (auto-sort), `:117-119` (move to top) — errors logged, nothing shown.
- `web/src/components/benefits/filters.tsx` — filter option loading fails silently (see D-11).
- `web/src/components/holders/form-kit.tsx` has a `useRunAction` helper with pending/error state — **use it** as the house pattern for the rest of the app rather than inventing per-component handling.

**User story.** *As a user, when an action fails I want to see why, so that I can retry instead of wondering whether it worked.*

**Acceptance criteria**
1. Every `catch` in a client component that handles a server-action failure shows a visible error — a toast, an inline `role="alert"` message, or the `useRunAction` error state.
2. The error text is the action's error message, not a generic "Something went wrong", unless the underlying error is a network failure.
3. Where an optimistic UI update is reverted on failure (e.g. queue reorder), the revert is accompanied by an explanation.
4. A consistent mechanism is used across the app: extend `useRunAction` in `web/src/components/holders/form-kit.tsx` (or promote it to a shared `web/src/components/ui/`) and use it in the automation queue, benefits filters, and account sheet.
5. Voucher codes and booking IDs must never appear in these error messages.

---

### C-04 — Curation-status clarity: `uncurated` vs `no_benefits`

**Priority:** P1 · **Effort:** M · **Depends on:** none

**Problem.** `REQUIREMENTS.md` §5 is explicit: "A card showing zero benefits must never leave the user guessing whether that's correct or just not yet looked at." Today the only signal is a small badge (`web/src/components/cards/curation-badge.tsx`) on the card detail sheet, and the card-add flow does not make the distinction legible. A user whose card type is `uncurated` sees an empty benefits list and reasonably concludes they have no benefits.

**Evidence.** `web/src/components/cards/curation-badge.tsx`; `web/src/components/cards/card-detail-sheet.tsx`; `web/src/components/overrides/override-form.tsx` (the `add`/`suppress` override form is the only escape hatch, and nothing points a user to it).

**User story.** *As a user whose card shows no benefits, I want to know whether the bank genuinely gives me none or whether nobody has entered them yet, so that I know whether I need to add them myself.*

**Acceptance criteria**
1. Three distinct, plain-language states wherever benefits are shown for a card:
   - **Uncurated** — "Benefits for this card type haven't been entered yet. If you know what your card offers, add them yourself." → CTA to the `add` override form.
   - **No benefits** — "This card type is confirmed to have no benefits." → no CTA.
   - **Curated** — normal list.
2. The state is shown in the card detail sheet, on the card add/edit form after selecting a type, and in the benefits list when a card yields zero instances.
3. The copy is user-facing, not jargon: do not surface the raw token `uncurated` to end users. Keep the token in code and the admin UI.
4. A workspace can act on the uncurated state (C-05) without contacting the system admin.
5. The `curation-badge.tsx` component is the single source of these three states so the wording cannot drift between surfaces.

**Files to touch.** `web/src/components/cards/curation-badge.tsx`, `web/src/components/cards/card-detail-sheet.tsx`, `web/src/components/cards/card-form.tsx`, `web/src/components/cards/card-type-combobox.tsx` (show the state while choosing a type).

---

### C-05 — "Card type not in catalog" request path

**Priority:** P1 · **Effort:** M · **Depends on:** C-04

**Problem.** The catalog is curated by the system admin only (`REQUIREMENTS.md` §10). A user whose card type does not exist in `bank_card_types` cannot add the card at all — there is nothing to attach it to. The only path today is for the user to ask the admin out of band, and for the admin to create an `uncurated` row. There is no in-app request mechanism, and no way for the user to describe a card that is not in the catalog.

**User story.** *As a new user whose card isn't in the shared catalog, I want to say so in the app, so that I can still track my card instead of waiting for a manual admin step.*

**Acceptance criteria**
1. In the card-type picker (`web/src/components/cards/card-type-combobox.tsx`), a "My card isn't listed" option opens a request flow.
2. The request captures: bank, card name, last 4 digits, and an optional note. It is stored workspace-scoped and visible to the system admin.
3. The request creates a **draft**, not a curated catalog row. Only the system admin can promote a draft to a real `bank_card_types` row (existing `web/src/app/(app)/admin/catalog/edit/page.tsx` flow: `addCardTypesAction`, `setCurationStatusAction`).
4. While a request is pending, the user is told what happens next and that they can continue with a temporary `add` override if they know their benefits.
5. The admin catalog shows a "Requests" tab with pending requests and a one-click "create as uncurated" action.
6. A user must not be able to create catalog rows directly (that is a system-admin-only capability) — the request path must not leak a create capability.

**Migrations.** A new `catalog_card_type_requests` table is additive. Columns: `id`, `workspace_id`, `bank_name`, `card_name`, `last_four`, `note`, `status` (`pending`/`approved`/`rejected`), `created_at`, `resolved_at`, `resolved_by_user_id`. Add the composite FK `(workspace_id, ...)` pattern used by the other workspace tables, and a composite FK to `card_holders` if the request is holder-scoped. All nullable-with-default or additive — no changes to existing tables.

**Files to touch.** `web/src/db/schema.ts`, `web/src/components/cards/card-type-combobox.tsx`, `web/src/components/cards/card-form.tsx`, `web/src/components/admin/catalog-admin.tsx` (new tab), `web/src/domain/catalog-requests.ts` (new), `web/src/actions/catalog-requests.ts` (new).

---

### C-06 — Redundant `add`-override detection (catalog catches up)

**Priority:** P2 · **Effort:** M · **Depends on:** none

**Problem.** `REQUIREMENTS.md` §5: "If the shared catalog later adds a benefit a user had already covered with their own `add` override ... the user ends up with the same benefit twice unless they notice and retire their own override. The app should surface this."

**User story.** *As a user, I want to be told when the shared catalog has caught up with a benefit I added by hand, so that I can remove my duplicate override.*

**Acceptance criteria**
1. A domain function detects workspace `add` overrides whose benefit is now covered by an active catalog benefit on the same card.
2. Matching is **fuzzy** (normalized label / provider similarity), and the user is warned that this is a suggestion, not an automatic action. The requirement explicitly says "detecting the match is a judgment call, not something guaranteed to be automatic in v1".
3. The match is surfaced on the `/overrides` page as a dismissible warning banner, and on the card detail sheet.
4. The user is never auto-migrated. The action available is "review and remove my override" / "keep both".
5. The detection is advisory only and must not affect instance generation, ordering, or status.

**Technical notes.** `web/src/domain/benefit-label.ts` (`benefitOptionLabel`) and `web/src/domain/benefit-offer-kind.ts` (`inferOfferKind`) are the existing normalisation helpers — reuse them rather than writing a new comparator.

---

### C-07 — First-run onboarding wizard: coverage & empty states

**Priority:** P2 · **Effort:** M · **Depends on:** C-04

**Problem.** `web/src/components/onboarding/onboarding-wizard.tsx` (700 lines) covers creating a holder and a card. It does not cover the third thing every new user needs: understanding what the app will do for them each quarter, and what to do when their card's benefits are missing.

**User story.** *As a new user, I want a short, guided first run that gets me to a useful state, so that I understand what the app does for me.*

**Acceptance criteria**
1. The wizard covers: create a holder → add a card → confirm the card's benefits look right (curated / uncurated / none, per C-04) → an optional 20-second explainer of the order → use → use-it flow.
2. A new user's dashboard is not empty-looking: even with one card, the dashboard shows what the app is tracking rather than a blank state.
3. Each step is skippable and re-enterable; the wizard can be dismissed and resumed from the dashboard's welcome card (`web/src/components/dashboard/welcome-onboarding-card.tsx`).
4. The wizard state is persisted server-side or in a way that survives a page reload mid-wizard (today's `web/src/components/onboarding/onboarding-state.ts` is in-memory React state — decide explicitly whether mid-wizard reload is acceptable and document the choice).
5. If a card type is uncurated, the wizard's last step points at the `add` override form, so the user can leave the wizard with a working tracker.

---

# Area D — Accessibility, discoverability, hygiene

---

### D-01 — Real table semantics for the benefits list

**Priority:** P1 · **Effort:** M · **Depends on:** none

**Problem.** The benefits "table" is a CSS grid of `div`/`ul`/`li`/`span` elements with the header row explicitly `aria-hidden`. A screen-reader user gets a flat list of unlabelled fragments with no column headers and no cell/row relationships. The grid's `minWidth` of ~720px also forces horizontal scroll on narrow viewports (see D-07).

**Evidence.** `web/src/components/benefits/benefit-list.tsx:415-430` — the header row is `<div aria-hidden>` with `<span>` cells; the grid uses inline `gridTemplateColumns`.

**User story.** *As a screen-reader user, I want the benefits list to be navigable as a table, so that I can understand what each column contains.*

**Acceptance criteria**
1. Either:
   - (a) Convert to a semantic `<table>` with `<thead>`, `<th scope="col">`, `<tbody>`, and `<td>`, keeping the responsive card layout below `md` via CSS; or
   - (b) Keep the div grid but add `role="table"`, `role="row"`, `role="columnheader"`, `role="cell"` and remove `aria-hidden` from the header.
   - **(b) is recommended** — it preserves the existing CSS grid layout, the column picker, and the responsive behaviour with far less risk. The header `aria-hidden` must be removed either way.
2. The column picker's hidden columns are removed from the accessibility tree consistently (a hidden column must not be announced).
3. Row semantics: each row is currently a `<button>`; the button's accessible name is the concatenation of all visible cells, which is long and unhelpful. See D-02.
4. Keyboard navigation through the list must work (tab into a row, Enter/Space opens the drawer) and the open state must be announced.
5. A `<caption>` or visually hidden description of the table ("Benefit instances for 2026-Q3") is present.
6. Verify with a screen reader (VoiceOver on macOS at minimum) — a checklist of announced states is included in the PR description.

---

### D-02 — Accessible names for benefit rows

**Priority:** P2 · **Effort:** S · **Depends on:** D-01

**Problem.** A benefit row is a `<button>` whose accessible name is the concatenation of every visible cell, e.g. "Big Basket ₹500 Papa HDFC Select ••1234 Coupon Received". A user navigating by button hears a run-on string with no indication of what the button does.

**Acceptance criteria**
1. Each row button has an explicit `aria-label` such as "Open details: Big Basket, ₹500, on Papa's HDFC Select card ending 1234, status Coupon Received".
2. The label is built from the row's data, not from its rendered children.
3. The drawer that opens on activation is properly labelled (`aria-labelledby` pointing at the benefit name) and the focus returns to the originating row on close.

---

### D-03 — Visible labels + live result counts for filters

**Priority:** P2 · **Effort:** S · **Depends on:** none

**Problem.** The filter selects have no visible text labels — only `aria-label`s on the triggers and placeholder text. Users relying on visible labels (and anyone scanning the bar) can't tell what each select filters. Result counts also update silently with no live region.

**Evidence.** `web/src/components/benefits/filters.tsx` — selects carry `aria-label` but no visible label element; the result count is rendered by `web/src/components/benefits/benefits-content.tsx` with no `aria-live`.

**Acceptance criteria**
1. Every filter control has a visible label (visually hidden is acceptable where space is tight, but the label must be programmatically associated and reachable by the sighted user — prefer a visible short label).
2. A result count region with `aria-live="polite"` announces "42 benefits match" when filters change.
3. The search input has a visible label, not only a placeholder.
4. Contrast of the muted/dimmed filter states meets WCAG AA (dimming is used in B-02).

---

### D-04 — `EmptyState` announced to screen readers

**Priority:** P3 · **Effort:** S · **Depends on:** none

**Problem.** `web/src/components/layout/empty-state.tsx` renders no `role="status"` / `aria-live`, so when an empty state replaces a list, a screen-reader user is not told the content changed.

**Acceptance criteria.** Add `role="status"` (or an `aria-live="polite"` wrapper) to `EmptyState`; verify it does not double-announce on first paint (an empty state that renders on initial load should not be announced twice).

---

### D-05 — Search & filter for cards / holders / accounts / overrides

**Priority:** P1 · **Effort:** M · **Depends on:** none

**Problem.** Search exists only on `/benefits`. `/cards`, `/holders`, `/accounts`, and `/overrides` render their full collection with no search or filter. A user with a dozen cards and five holders must scan linearly.

**User story.** *As a user with many cards, I want to filter the card list by holder or by text, so that I can find one quickly.*

**Acceptance criteria**
1. `/cards` gains a text search (card name, bank, last 4) and a holder filter.
2. `/holders` gains a text search over holder names.
3. `/accounts` gains a text search over account labels.
4. `/overrides` gains a filter by card and by type (`add`/`suppress`) and by active/inactive.
5. Filters are URL-driven, consistent with `/benefits`, and show the same removable chips (B-01) so the pattern is uniform across the app.
6. The list components are refactored to accept a filtered list from the server, not to filter in the browser after fetching everything.

---

### D-06 — Search & filter for the admin catalog

**Priority:** P2 · **Effort:** M · **Depends on:** none

**Problem.** `web/src/app/(app)/admin/catalog/page.tsx` and `.../edit/page.tsx` render every variant and every card type. The admin maintains the shared catalog for all users, so this list grows without bound.

**Acceptance criteria.** A text search over card type name and bank, plus a filter by variant and by curation status, applied server-side.
**Note.** The system admin is the only user of this page, so this is lower priority than D-05 — but the catalog is the product's shared substrate, so its usability has outsized indirect value.

---

### D-07 — Mobile: benefits grid horizontal scroll & search field width

**Priority:** P2 · **Effort:** S · **Depends on:** D-01

**Problem.** Two mobile issues on the core screen:
1. The desktop grid sets `minWidth: ~720px` inside `overflow-x-auto` (`web/src/components/benefits/benefit-list.tsx:415-430`), so tablets in landscape and narrow desktop windows get a horizontal scroll area.
2. The search input is only `w-36` on mobile before expanding on focus (`web/src/components/benefits/filters.tsx`), which is too narrow to type into.

**Acceptance criteria**
1. Below the `md` breakpoint the stacked card layout is used (already exists — verify it is used at all widths below `md` and that the grid is not also rendered in the DOM, hidden by CSS, where it would still be focusable and announced).
2. The `minWidth` is applied only at `md` and above.
3. The mobile search field is full-width.
4. Verified on a 390px viewport (iPhone 14) and a 768px landscape tablet.

---

### D-08 — Delete dead `mobile-app-chrome.tsx`

**Priority:** P3 · **Effort:** S · **Depends on:** none

**Problem.** `web/src/app/(app)/mobile-app-chrome.tsx` is a second mobile header implementation, superseded by `AppShell` (`web/src/app/(app)/app-shell.tsx`), with no imports anywhere. Two mobile nav implementations in one repo will drift; someone will eventually edit the wrong one.

**Acceptance criteria.** Delete the file. Grep for any remaining reference (including dynamic imports) before deleting. If any part of it is still wanted, port that part into `AppShell` first, in the same PR.

---

### D-09 — Stop logging OTPs / chat IDs / phone numbers

**Priority:** P0 · **Effort:** S · **Depends on:** none

**Problem.** The webhook routes log OTP codes, chat IDs, and sender phone numbers to the server console. AGENTS.md states: "Voucher codes and booking IDs never appear in logs, errors, test output, or script output." OTPs and phone numbers are the same class of secret.

**Evidence.**
- `web/src/app/api/webhooks/telegram/route.ts:24` (full message text + chat id), `:82` (OTP + chat id), `:120` (OTP again), `:102` (chat id).
- `web/src/app/api/webhooks/whatsapp/route.ts:63` (full message text + phone), `:80` (OTP + phone), `:105` (phone), `:125` (OTP).

**User story.** *As a user, I want my OTP codes and phone number to never be written to server logs, so that a log leak can't be used to compromise my accounts.*

**Acceptance criteria**
1. No OTP value is ever written to a log, at any level. Log only that an OTP *was* detected and its length, if useful.
2. Chat IDs and phone numbers are masked (e.g. `…4821`, `+91******7890`).
3. The full inbound message body is not logged.
4. A repo-wide grep for `console.log` inside `web/src/app/api/` confirms no other secret-bearing log lines remain.
5. A unit test asserts the masking helper redacts the expected shapes (a test that asserts the log output contains no digits sequence of length ≥ 4 is acceptable).

**Files to touch.** Both webhook route files; add a shared `web/src/lib/log-redact.ts` if a helper is warranted.

---

### D-10 — Missing empty states

**Priority:** P3 · **Effort:** S · **Depends on:** none

**Problem.** Several surfaces render a bare count or an empty list with no explanation: the automation order queue when empty, the attempts-history section when there are no attempts, an admin catalog variant with no cards, and the "add cards from a list" flow.

**Acceptance criteria.** Each empty state uses the shared `EmptyState` component (`web/src/components/layout/empty-state.tsx`) with a title, a one-line explanation of *why* it is empty, and the next action (e.g. "Map a card to this portal account"). The order-queue empty state must distinguish "no pending items — you're all caught up" from "automation is disabled" from "no cards are mapped to an account", since those need different actions.

---

### D-11 — Filter-option load failure is swallowed silently

**Priority:** P1 · **Effort:** S · **Depends on:** C-02

**Problem.** If the filter option queries fail, the filter dropdowns silently disappear with no error shown and nothing logged. A user sees fewer filters and cannot tell whether the app is broken or there is nothing to filter.

**Evidence.** `web/src/app/(app)/benefits/page.tsx:51-54` — `catch (e) { unstable_rethrow(e); return { holders: [], cards: [], categories: [], portalAccounts: [] }; }` with the comment "filters degrade; the list itself reports its own errors". The `unstable_rethrow` re-throws Next.js control-flow errors (not-found, redirect) but swallows genuine DB errors into empty arrays.

**Acceptance criteria**
1. A genuine failure (not a `unstable_rethrow` case) is logged with `console.error('[benefits] filter options', err)` and shown to the user as a dismissible warning: "Some filters couldn't be loaded."
2. The benefits list itself still renders — degradation is fine, silence is not.
3. The same treatment is applied to any other place that returns empty arrays on a caught error.

---

### D-12 — Warn on `uncurated` catalog rows in the admin catalog

**Priority:** P3 · **Effort:** S · **Depends on:** C-04

**Problem.** The shared catalog is the substrate for every user. Rows left in `uncurated` mean every user of that card type sees an empty benefits list and must self-serve. The admin catalog shows curation status but gives no sense of which uncurated rows are actually in use by real workspaces.

**Acceptance criteria.**
1. In `web/src/app/(app)/admin/catalog/edit/page.tsx`, `uncurated` rows show how many workspaces have cards of that type (so the admin can prioritise curation).
2. A simple "uncurated and in use" filter/sort makes the actionable set obvious.
3. The count query is workspace-scoped and does not leak card or holder data to the admin view beyond a count (this is a system-admin surface, so a count is acceptable; the admin view must still not expose another workspace's card details).

---

## 2. Suggested execution order

1. **Week 1 — P0 correctness and safety:** D-09 (secret logging) → C-01 (error boundaries) → C-02 (guarded loading) → B-02 (silently ignored filters) → D-11 (silent filter failure).
2. **Week 2 — P1 work-queue foundations:** B-01 (chips) → B-04 (pagination) → B-06 (SQL filters) → B-05 (attention views) → D-05 (search elsewhere).
3. **Week 3 — P1 onboarding:** C-04 (curation clarity) → C-05 (catalog request path) → C-07 (wizard).
4. **Week 4+ — Area A (reminders):** A-01 (engine) → A-05 (preferences UI) → A-02 (Telegram) → A-06 (attention centre) → A-03 (email) → A-04 (WhatsApp, only if Meta approval exists).
5. **Alongside / as capacity allows:** B-03 (bulk actions, after B-05) → D-01/D-02/D-03 (a11y) → C-03 (surface action failures) → D-07 → D-10 → D-08 → D-12 → C-06.

**Sequencing rationale.** Area A is the highest user value but sits behind A-01, which is the largest single item (L). The P0 items are small (S) and remove user-visible breakage, so they go first. B-05 (attention views) should precede B-03 (bulk actions) so bulk actions operate on a coherent "action set" rather than an arbitrary table.

---

## 3. Done

_(Items move here as they land, with the PR link.)_
