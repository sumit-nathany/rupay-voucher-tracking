# Automated RuPay Ordering — Implementation Plan

> **Status:** Detailed proposed implementation plan for review. This document implements the product behavior in [automated-rupay-ordering-requirements.md](./automated-rupay-ordering-requirements.md); it does not replace it.
> **Tracker conventions:** [REQUIREMENTS.md](../REQUIREMENTS.md), [PLAN.md](../PLAN.md), and [rupay-portal-api.md](./rupay-portal-api.md) remain the source for existing tracker behavior and known portal observations.
> **Phase:** Post-v1 proposal for the later ordering phase in [PLAN.md](../PLAN.md). This plan does not revise v1 scope or authorize implementation/rollout until that phase is approved.

---

## 1. Design summary

Add a private automation subsystem that selects one eligible benefit per RuPay portal account, submits it through the portal, and writes the confirmed outcome back to the existing tracker. The application remains a Next.js/Vercel application backed by Supabase PostgreSQL; browser automation runs separately as a short-lived Google Cloud Run Job.

The implementation intentionally separates these concerns:

| Concern | Owner | Reason |
| --- | --- | --- |
| Configuration, rules, audit UI | Next.js server actions | Uses the existing authenticated workspace session and UI conventions. |
| Source of truth and concurrency guard | Supabase PostgreSQL | A transaction protects state changes across web and worker processes. |
| Portal login and browser/API interaction | Cloud Run Job + Playwright | It needs a real browser runtime and must never run in an interactive user request. |
| Daily trigger | Cloud Scheduler | Starts the job once per day in Asia/Kolkata time. |
| Worker secrets | Google Secret Manager | Keeps deployment and database credentials out of source control. |

No browser-side code accesses the database directly, controls the worker, receives portal credentials, or sees session/JWT values from the RuPay portal.

## 2. Preconditions and discovery gate

The current portal notes document authenticated *read* endpoints and a one-hour `jwt`/`sessionid` session, but do not document the actual login, registered-card lookup, or order-submission request. The ordering code must not be written by guessing those calls.

### 2.1 Capture the confirmed portal flow

Before enabling any write path, use the account owner's own portal account to perform one deliberate, low-risk manual order in a normal browser. Capture a sanitized trace containing:

- Login page URLs, fields, validation behavior, and whether authentication requires password/PIN, OTP, CAPTCHA, or device verification.
- The endpoint or browser action that lists cards registered to the signed-in account, including the authoritative card mapping and `cardbinid` source.
- The endpoints/pages that select a service, select an offer, and submit an order.
- Every request field essential to ordering, the confirmation response/page, and the booking/reference identifier.
- The portal's pre-submission and post-submission error states.

Store only a redacted fixture: substitute tokens, passwords, names, card numbers, booking IDs, and all personally identifying values. Do not commit a browser HAR containing cookies or raw responses.

### 2.2 Discovery acceptance gate

Do not merge or enable the submission adapter until all of the following are known from the trace:

1. How a fresh worker login is performed without reusing a user's browser session.
2. How one of the user's mapped tracker cards is resolved to a portal card.
3. How the worker verifies an offer is available before submission.
4. How a successful order can be distinguished from a page load, validation error, or transport acknowledgement.
5. Which result field is safe to store as `rupay_booking_id`.
6. Whether the portal's terms and the account owner's authorization permit the intended automation.

Do not implement or enable a write path until the portal flow is confirmed and the terms/authorization check is resolved. If login requires a challenge that cannot be completed unattended, the initial release supports account status `challenge_required` only. It does not implement a CAPTCHA solver, OTP relay, browser streaming, or an unsafe challenge workaround.

## 3. Database design and migrations

Add a new Drizzle migration after the existing schema migrations, and add the corresponding definitions to `web/src/db/schema.ts`. All workspace-owned tables live in the existing `app` schema and follow its defense-in-depth constraints.

### 3.1 `automation_settings`

One row per workspace.

| Column | Type / constraint | Purpose |
| --- | --- | --- |
| `workspace_id` | PK and FK to `workspaces.id` | Tenant ownership. |
| `enabled` | boolean, default `false` | Global pause-all control. New workspaces start paused. |
| `updated_at` | timestamptz | Audit/display state. |

The worker must check this flag in the candidate query and re-check it inside the locked selection transaction.

### 3.2 `portal_accounts`

One row per set of credentials on the RuPay portal; it is not a card holder.

| Column | Type / constraint | Purpose |
| --- | --- | --- |
| `id` | UUID PK | Portal-account identifier. |
| `workspace_id` | non-null FK; unique `(workspace_id, id)` | Tenant boundary and composite-FK parent. |
| `label` | text, unique per workspace | User-facing local name only. |
| `credentials_encrypted` | text, non-null | AES-256-GCM ciphertext of the observed login fields. |
| `status` | checked enum | `connected`, `paused`, `credentials_expired`, `challenge_required`, `portal_changed`, `needs_attention`. |
| `last_confirmed_order_at` | timestamptz nullable | Fast display only; eligibility is calculated from attempts. |
| `last_checked_at` | timestamptz nullable | Operational status. |
| `status_detail_code` | text nullable | Safe, finite error category only; never portal text. |
| `created_at`, `updated_at` | timestamptz | Audit timestamps. |

Credentials must be encrypted with a new `PORTAL_CREDENTIAL_ENCRYPTION_KEY`, not the voucher-code key. The plaintext is a versioned JSON object whose fields are established in the discovery trace. It must never contain a transient `jwt`, cookie, session ID, OTP, or CAPTCHA answer. Use AES-256-GCM with associated data `portal_account.id`, matching the tracker’s established encryption pattern.

### 3.3 `portal_card_mappings`

Map a workspace's physical tracker card to exactly one portal account and its verified portal identity.

| Column | Type / constraint | Purpose |
| --- | --- | --- |
| `id` | UUID PK | Mapping ID. |
| `workspace_id`, `portal_account_id`, `card_id` | non-null | Scope and references. |
| `portal_card_id` | integer/text, as verified | The portal’s card-product identifier. |
| `portal_cardbin_id` | integer/text nullable until confirmed | Identifier required by the portal for that registered card. |
| `portal_card_label` | text nullable | Sanitized confirmation display; not a full card number. |
| `active` | boolean, default true | Disable a mapping without deleting history. |

Constraints:

- Unique `(workspace_id, card_id)` so a tracker card cannot be ordered through two portal accounts.
- Unique `(portal_account_id, card_id)`.
- Composite FKs to `(workspace_id, id)` on both `cards` and `portal_accounts`; this prevents cross-workspace references at the database layer.

### 3.4 Rule tables

Use normalized filters so the UI can support a rule that applies to several cards/benefits without serializing workspace IDs or mutable names into JSON.

`ordering_rules` has `id`, `workspace_id`, `portal_account_id`, `name`, `enabled`, `priority`, `created_at`, and `updated_at`. A lower priority number wins. Rule names are unique within an account.

`ordering_rule_cards` has `(rule_id, card_id)` as its logical identity. An empty set means all active mappings for the rule's portal account.

`ordering_rule_benefits` has `(rule_id, benefit_id)` as its logical identity. An empty set means all eligible benefits for selected cards. It references the stable `benefits.id`, not a catalog version, so a corrected catalog version does not silently disable a rule.

`ordering_rule_option_defaults` has `(rule_id, benefit_id)` as its logical identity and an `option_id`. It applies only to pick-one benefits. During execution, the worker must verify that `option_id` belongs to the instance's `generated_from_version`; an unavailable/retired choice skips the candidate instead of falling back to another offer.

All rule child tables must use composite FKs where the parent carries a workspace ID. Input validation must reject a card, benefit, or option that does not match the rule's workspace/account/card type.

### 3.5 Job, attempt, and audit tables

`ordering_job_runs` records each Cloud Run invocation: `id`, `scheduled_for`, `started_at`, `finished_at`, `status` (`running`, `completed`, `failed`), aggregate count fields, and a sanitized `failure_code`. It is operational data and does not require a workspace ID because one execution can process multiple workspaces.

`portal_order_attempts` is the durable idempotency and audit ledger. A confirmed portal order remains `confirmed` even if tracker reconciliation needs user attention; use a safe `failure_code` such as `tracker_reference_conflict` for that reconciliation condition, and set the portal account to `needs_attention`.

| Column | Purpose |
| --- | --- |
| `id`, `job_run_id` | Attempt identity and invoking job. |
| `workspace_id`, `portal_account_id`, `rule_id`, `instance_id` | Scope and provenance. |
| `state` | `reserved`, `submitting`, `confirmed`, `failed_pre_submit`, `uncertain`, `resolved_no_order`, `cancelled`. |
| `reserved_at`, `submission_started_at`, `finished_at`, `lease_expires_at` | Exact timing for the rolling limit, active reservation recovery, and audit trail. |
| `booking_reference` | Safe portal booking/reference identifier only after confirmation. |
| `failure_code` | Finite safe code such as `credentials_expired`, `challenge_required`, `offer_unavailable`, `portal_changed`, `network_pre_submit`, `network_post_submit`, `concurrent_change`, `reservation_lease_expired`, `worker_lost_after_submit_started`, or `tracker_reference_conflict`. |

Constraints and indexes:

- Unique `(instance_id)` where `state IN ('reserved', 'submitting', 'confirmed', 'uncertain')`, via a partial unique index. This makes an instance in-flight, confirmed, or unresolved-uncertain ineligible for another automatic attempt; `resolved_no_order` releases the instance after the account cooldown.
- Partial unique index on `portal_account_id` where `state IN ('reserved', 'submitting')`. An active reservation blocks another worker from reserving a different instance for the same account while browser work is in progress.
- `lease_expires_at` is non-null for `reserved` and `submitting` attempts. Renew the reservation lease while login/offer checks are active; when changing to `submitting`, set the lease beyond the adapter's bounded submit timeout and finalization grace period.
- Index `(portal_account_id, submission_started_at DESC)` for the rolling 24-hour lookup.
- Index `(workspace_id, instance_id)` and composite FKs to enforce tenant consistency.
- `booking_reference` is unique when non-null if the portal’s reference format is globally stable; otherwise use unique `(portal_account_id, booking_reference)`.

Do not delete attempts during normal operation. Retention, if ever needed, must retain a final redacted audit record and never remove data needed to prevent duplicated submission.

### 3.6 Schema migration verification

- Add migration SQL and Drizzle definitions together.
- Run existing PostgREST lockdown verification after migration; new application tables must not become directly accessible through the Supabase anon/authenticated roles.
- Add migration tests against local Postgres/PGlite where supported, plus a deployed-Supabase verification for grants and constraints.

## 4. Application encryption and worker identity

### 4.1 Credential encryption module

Create `web/src/lib/portal-credentials.ts` with:

- `encryptPortalCredentials(plaintext, portalAccountId)` and `decryptPortalCredentials(ciphertext, portalAccountId)`.
- A `v1.` ciphertext format, 12-byte IV, AES-256-GCM authentication tag, and associated data equal to the portal-account UUID.
- Strict validation of a versioned credential object before encryption and after decryption.
- Generic error messages that do not reveal plaintext, ciphertext, or key details.

The web app needs the key only to encrypt credentials submitted during setup. Store `PORTAL_CREDENTIAL_ENCRYPTION_KEY` as a server-only Vercel secret and as a Google Secret Manager secret mounted only into the Cloud Run Job. Never use a `NEXT_PUBLIC_` variable for it.

### 4.2 Worker database identity

The worker is a trusted server-side component, not an end-user session. It connects through the Supabase transaction pooler with a dedicated database credential stored in Secret Manager. It must still apply workspace predicates to every workspace-specific query; it cannot rely on database RLS for per-workspace selection.

Give the worker only the database and secret-access permissions required for this feature. Cloud Scheduler may invoke the Cloud Run Job, but it must not have database credentials or Secret Manager access.

## 5. Domain/API implementation

### 5.1 New modules

Add these modules under `web/src`:

- `domain/automation.ts`: workspace-scoped setup/rule reads and writes, candidate eligibility query construction, and safe view types.
- `domain/automation-worker.ts`: transaction-safe reservation, finalization, account-status updates, and worker-only queries.
- `actions/automation.ts`: thin server-action wrappers that call `getCtx()` and never accept `workspace_id` from the browser.
- `lib/portal-credentials.ts`: encryption helpers described above.
- `lib/portal-client.ts`: typed adapter interface and error normalization shared by fixtures and the worker.

The worker package may live in `worker/` at repository root. It imports only server-safe shared modules and the Drizzle schema; it must not import React, Server Actions, or cookie-bound session code. Add a package/workspace configuration only if needed to make those imports explicit and testable.

### 5.2 Server-action contracts

All browser inputs are strict Zod objects. Useful actions include:

- `getAutomationDashboardAction()` → settings, safe account summaries, rules, and recent attempts for the current workspace.
- `saveAutomationSettingsAction({ enabled })`.
- `createPortalAccountAction({ label, credentials })`, `updatePortalAccountAction(...)`, `pausePortalAccountAction({ id })`, and `disconnectPortalAccountAction({ id })`.
- `savePortalCardMappingAction({ portalAccountId, cardId, portalCardId, portalCardbinId, ... })`.
- `createOrderingRuleAction(...)`, `updateOrderingRuleAction(...)`, `deleteOrderingRuleAction({ id })`.
- `resolveUncertainAttemptAction({ attemptId, resolution, bookingReference? })`, scoped to the current workspace and available only for an `uncertain` attempt.

The account read models must expose `hasCredentials: boolean`, account status, and safe timestamps—not ciphertext, portal login IDs, cookies, or raw mapping fields that constitute sensitive card data.

### 5.3 Status ownership

Do not make the ordinary `setStatus` action capable of manufacturing an automated success. The worker’s `finalizeConfirmedOrder()` transaction is the only code path that may simultaneously:

1. Verify an attempt is still `submitting` for the chosen instance/account.
2. Verify the instance is still `Not Ordered` in the same workspace.
3. Set `benefit_instances.order_status` to `Ordered but Coupon not received`.
4. Set `order_date` to the Asia/Kolkata date of confirmation.
5. Set `rupay_booking_id` only if the tracker field is empty or matches the confirmed reference. If it conflicts with a human-entered value, preserve that field, retain the portal reference in the confirmed attempt, set the account to `needs_attention`, and surface manual reconciliation. Continue updating the instance status and order date as described above.
6. Mark the attempt `confirmed` and update `portal_accounts.last_confirmed_order_at`.

This transaction protects against a user manually changing the instance while the portal browser is open.

## 6. Candidate selection, locking, and state machine

### 6.1 Candidate query

The worker loads only candidates satisfying all conditions below:

- `automation_settings.enabled = true`.
- Portal account is `connected` and not paused.
- Card mapping is active and belongs to an active tracker card.
- Benefit instance belongs to the same workspace, is `Not Ordered`, has `order_deadline >= Asia/Kolkata today`, and has no blocking attempt.
- At least one enabled matching rule exists.
- The instance is not sold, skipped, withdrawn, or already otherwise actioned.

Resolve competing rules deterministically: lowest `priority`, then oldest `created_at`, then UUID. A matching pick-one instance must have a valid option default on the winning rule or it is reported as `choice_required` and skipped.

### 6.2 Per-account serialization

Cloud Run executes one job instance at a time, but that alone does not protect against duplicate Cloud Scheduler delivery, a retry, or an operator starting a second execution. Before reserving a candidate, acquire `pg_try_advisory_xact_lock(hash(portal_account_id))` within a database transaction.

Within that transaction:

1. Reload account, settings, candidate, and the latest blocking attempts using `FOR UPDATE` where appropriate.
2. Refuse selection if the account already has an active `reserved` or `submitting` attempt, or if any `confirmed`, `uncertain`, or `resolved_no_order` attempt has `submission_started_at >= now() - interval '24 hours'`.
3. Insert an attempt in `reserved` state.
4. Commit. The transaction-scoped advisory lock serializes reservation creation; the active-account partial unique index keeps the reservation exclusive after this transaction ends and while browser work runs.

Immediately before the browser submits, start a second transaction that re-checks settings, account status, rule enabled state, instance status, deadline, and 24-hour limit; set `submission_started_at` and change the attempt to `submitting` atomically. If any condition changed, mark the attempt `cancelled` and do not submit. Set `submission_started_at` immediately before the final portal action, never when initially reserving the candidate.

### 6.3 Attempt state transitions

```text
reserved -> failed_pre_submit | cancelled | submitting
submitting -> confirmed | failed_pre_submit | uncertain
uncertain -> confirmed       (user verifies booking)
uncertain -> resolved_no_order (user verifies no booking)
```

`confirmed`, `uncertain`, and `resolved_no_order` block that account for 24 hours from `submission_started_at`. `failed_pre_submit` and `cancelled` do not consume the daily allowance and may be considered on a future daily run. The worker must use the conservative `uncertain` branch whenever it cannot prove no portal submission occurred. An active `reserved` or `submitting` attempt blocks new reservations regardless of its age; stale active attempts require explicit recovery and must never be silently discarded.

Before selecting candidates, recover expired active attempts transactionally. An expired `reserved` attempt with no `submission_started_at` is safe to mark `cancelled` with `reservation_lease_expired`, because the state machine has not begun a portal submission. An expired `submitting` attempt must become `uncertain`, set the account to `needs_attention`, and remain blocked until the user checks the portal and resolves it; never retry it automatically. A workspace-scoped resolution action must let the user record either a confirmed booking (transition to `confirmed`, store the safe reference, and update the instance) or no booking (transition to `resolved_no_order`, leave the instance `Not Ordered`). Both resolutions clear `needs_attention` only after recording the user's decision; `resolved_no_order` remains subject to the 24-hour account cooldown. Lease renewal and recovery must use the account lock and update predicates so a live worker cannot be recovered concurrently.

## 7. Portal adapter and Playwright worker

### 7.1 Adapter interface

Define a narrow interface independent of browser selectors:

```ts
interface PortalOrderClient {
  login(credentials: PortalCredentials): Promise<void>;
  resolveMappedCard(mapping: PortalCardMapping): Promise<ResolvedPortalCard>;
  verifyOffer(request: OrderRequest): Promise<VerifiedOffer>;
  submitOrder(request: VerifiedOrderRequest): Promise<ConfirmedOrder>;
  close(): Promise<void>;
}
```

All errors become a closed `PortalFailureCode` union. The adapter must never return raw HTML, unredacted response bodies, cookies, request headers, or tokens to its caller.

Use a `FakePortalOrderClient` for deterministic tests. Use `PlaywrightPortalOrderClient` only after the discovery gate produces stable selectors/API contracts.

### 7.2 Browser safety

- Create a new Playwright browser context per portal account and close it in `finally`.
- Disable tracing, video, screenshots, and request-body logging in production by default; any temporary troubleshooting artifact must be manually redacted and kept outside source control.
- Set a bounded timeout for navigation and selector/API waits. A timeout after a final submission is always `uncertain`.
- Use one account at a time and a polite delay only where confirmed portal behavior needs it; do not parallelize or scrape unrelated cards/offers.
- Do not persist `storageState`, cookies, JWTs, or session IDs between jobs. A fresh login avoids using the portal’s one-hour session as durable credential storage.

### 7.3 Worker entry point

The job entry point performs:

1. Create `ordering_job_runs` row.
2. Recover expired active attempts using the account lock, then list candidate portal accounts with eligible instances.
3. For each account, reserve at most one candidate using the locking flow.
4. Decrypt only that account's credentials immediately before login.
5. Use the adapter to login, resolve card, verify offer, re-check/reserve submission, and submit.
6. Finalize confirmed, failed-pre-submit, or uncertain state transactionally.
7. Dispose browser context and in-memory credentials before processing the next account.
8. Finish the job-run row with aggregate safe counts.

The process continues to other accounts after an account-level failure. A fatal database/schema/configuration failure marks the job run failed and exits non-zero so Cloud Run reports the execution failure.

## 8. Cloud deployment

### 8.1 Cloud Run Job

Create a container image with Node.js, the worker package, and Playwright Chromium plus required OS dependencies. The job runs in `asia-south1` (Mumbai) with:

- Maximum tasks: 1; parallelism: 1.
- A bounded task timeout slightly above the longest expected single-account portal flow.
- No public HTTP ingress.
- A dedicated service account with access only to the required Secret Manager secrets and logging.
- Environment configuration that names secret versions and database endpoint, never embeds secret values in source or command arguments.

The Secrets are:

- `PORTAL_CREDENTIAL_ENCRYPTION_KEY`.
- Worker database connection string.
- Any portal adapter configuration established by discovery, only if it is truly secret.

Set Cloud Logging exclusions or application-level redaction to ensure credentials, cookies, tokens, code values, and portal payloads cannot be emitted even in errors.

### 8.2 Scheduler and invocation authorization

Create one Cloud Scheduler job in `asia-south1` with timezone `Asia/Kolkata`. It invokes the Cloud Run Jobs `:run` API once daily using an OIDC service account dedicated to scheduling. Grant that service account only permission to run this one job; it does not get Secret Manager or database access.

Scheduler delivery can repeat after a transient failure. The job-run records, per-account advisory locks, reservations, and partial unique indexes—not delivery exactly-once assumptions—prevent duplicate orders.

### 8.3 Delivery pipeline and configuration

- Add a versioned worker Dockerfile and `.dockerignore` that excludes `.env*`, browser artifacts, fixtures with real data, and all local credential files.
- Build and deploy from a protected CI workflow after tests pass. Tag images with the commit SHA.
- Keep GCP project ID, service-account identities, secret names, and schedule in documented deployment configuration, not application code.
- Configure a Google Cloud billing budget and an alert before enabling Cloud Scheduler. Set maximum job instances to 1 as a hard cost/concurrency guard.
- Use separate development/staging/production GCP projects and Supabase databases. Never test live ordering against production credentials from a development deployment.

## 9. User interface implementation

Add an authenticated `/automation` route and navigation item. The page has four sections:

1. **Global control:** enabled/paused state, explanation of the daily schedule, and a pause-all button.
2. **Portal accounts:** create/edit account, secure credential replacement, account status, mappings, last confirmed order, next eligible time, and pause/disconnect controls.
3. **Rules:** create/edit/disable ordering rules, card/benefit filters, priority, and required default pick-one choice.
4. **History and action required:** latest job runs and attempts, safe outcome labels, booking reference where confirmed, and clear manual recovery steps. For an uncertain attempt, let the user record “booking found” with its safe reference or “no booking found”; explain that the account remains rate-limited until 24 hours after submission started.

Use the existing sheet/drawer, form, Zod-validation, and server-action error-display conventions. Credential inputs are always blank on read; replacing credentials is an explicit write-only action. Do not add a “run now” button in this phase—the sole trigger is the daily schedule, avoiding an unreviewed concurrent execution path.

## 10. Tests

### 10.1 Unit and domain tests

- AES-GCM credential encryption/decryption, wrong-key failure, tamper rejection, and associated-data binding to portal account ID.
- Every server action validates input, rejects cross-workspace IDs, and does not return ciphertext.
- Rule matching: empty vs explicit card/benefit filters, disabled rules, ordering priority, deterministic ties, and option-default membership.
- Eligibility: status, deadline, card/mapping activity, global pause, account state, sold/withdrawn/skipped rows, and existing blocking attempts.
- 24-hour boundary: exactly 24 hours, 23:59:59, time-zone-safe dates, and confirmed/uncertain attempts measured from `submission_started_at` rather than `reserved_at`.
- Finalization race: a manual user update after selection but before submission cannot be overwritten.

### 10.2 Database integration tests

- Composite foreign keys reject a mapping/rule/attempt that crosses workspaces.
- Partial unique index blocks a second in-flight/confirmed/uncertain attempt for the same instance.
- Two concurrent worker transactions for one portal account produce no more than one `reserved` attempt.
- After the reservation transaction commits and releases its advisory lock, a concurrent worker still cannot reserve a different instance for that account while the first attempt is `reserved` or `submitting`.
- An expired `reserved` attempt with no submission timestamp becomes `cancelled`; an expired `submitting` attempt becomes `uncertain` and requires manual resolution.
- Confirmed finalization atomically updates attempt, instance status, order date, booking ID, and account timestamp.
- User resolution of an uncertain attempt is workspace-scoped, records either a confirmed booking or `resolved_no_order`, preserves audit history, and keeps the 24-hour account guard.
- PostgREST lockdown remains effective for every new automation table.

### 10.3 Portal adapter tests

Use only sanitized fixtures and the fake client to test:

- Confirmed order with a booking ID.
- Offer unavailable before submission.
- Credentials expired, OTP/CAPTCHA/device verification, and changed selector/API contract.
- Network failure before submission (`failed_pre_submit`).
- Timeout/connection loss after final submission (`uncertain`).
- A portal response that looks successful but lacks a reliable confirmation (`uncertain`).

### 10.4 End-to-end and live validation

- Run the worker against a staging database with fake adapter fixtures and assert UI history/statuses.
- Perform one supervised production-like test with a deliberately chosen low-risk real benefit after the discovery gate. Confirm the portal contains one booking and the tracker contains one matching `confirmed` attempt and `Ordered but Coupon not received` instance.
- Re-run the scheduler/job immediately after that order; prove no second account order is submitted.
- Inspect deployed logs/telemetry for the run and verify no secret, code, raw response, or full card detail is present.

## 11. Rollout sequence and kill switch

1. Land migration, domain layer, UI, fake adapter, and tests with global automation disabled.
2. Complete the manual portal-flow discovery, verify portal terms and account-owner authorization, and review the sanitized fixture/adapter contract.
3. Deploy the Cloud Run Job and Scheduler with the schedule disabled; validate secret access and database connectivity without portal submission.
4. Enable one staging/test portal account and run only adapter fixtures.
5. Enable one real production account and one narrow, low-risk rule; supervise the first daily job.
6. Enable additional accounts/rules after successful review of bookings, logs, and 24-hour enforcement.

The immediate kill switch is `automation_settings.enabled = false`; it is checked before candidate selection and immediately before portal submission. A portal-account pause is the narrower kill switch. Disabling the Cloud Scheduler job is the infrastructure-level fallback. None of these delete attempts or alter existing tracker status/history.

## 12. Explicit review questions

An external reviewer should verify these items before implementation begins:

1. Whether the exact portal ordering flow permits unattended login without OTP/CAPTCHA. Portal terms and account-owner authorization are release gates, not optional implementation details.
2. Whether `rupay_booking_id` is the correct durable portal confirmation identifier or whether a separate automation reference column is required.
3. Whether the current application's non-public `app` schema / PostgREST lockdown covers all new migration objects, including sequences and functions.
4. Whether a dedicated worker database role can be made sufficiently narrow without breaking Drizzle migrations or existing deployment practices.
5. Whether rule scope and default pick-one option IDs remain valid through catalog-version changes, and whether the UI gives enough warning for stale rules.
6. Whether a daily cadence is correct when the portal’s rule is rolling 24 hours rather than calendar-day based.
7. Whether the configured workload's monthly cost estimate and budget alert fit the account's billing policy.
