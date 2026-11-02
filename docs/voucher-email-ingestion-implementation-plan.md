# Voucher delivery email ingestion — Implementation plan

> **Status:** Proposed implementation plan for
> [voucher-email-ingestion-requirements.md](./voucher-email-ingestion-requirements.md).
> This is a future additive feature; no migration, provider credentials, or
> receiving domain should be created until its provider and retention policy are
> explicitly approved.

## 1. Preconditions

1. Reconcile `REQUIREMENTS.md` and `PLAN.md` with the already-shipped portal
   account and automation subsystem.
2. In Supabase, keep public self-signup disabled and enable email confirmation.
3. Configure a transactional email sender for address-verification mail.
4. Select an inbound-email provider that supports a custom receiving domain,
   signed webhooks, event IDs, raw/structured message retrieval, and a clear
   retention/deletion policy. Record its exact signature scheme in code and
   tests; do not trust a provider name or undocumented header convention.

## 2. Authentication correction (first release)

Before any mailbox UI is exposed, create a small auth guard shared by the auth
callback and `getCtxAndUser()`:

- `user.email_confirmed_at` must be non-null.
- The callback must check this before calling `provisionWorkspace()`.
- `getCtxAndUser()` must check it before resolving/provisioning membership, so
  a direct request with a valid but unconfirmed session cannot bypass the
  callback.
- Return a specific `AuthzError` that the UI maps to “Confirm your email to
  continue.” Do not create a workspace as a side effect of this failure.

Unit-test confirmed, unconfirmed, existing-member, and concurrent-first-login
cases. Keep `workspace_members.user_id` as the stable identity; this does not
replace it with an email key.

## 3. Additive database design

All tables live in `app`; all workspace-owned foreign keys use the existing
composite-FK/scoping conventions. Names are illustrative and can be refined
while generating the migration.

| Table | Essential columns and invariants |
| --- | --- |
| `verified_email_addresses` | `id`, `workspace_id`, canonicalized email, status (`pending`, `verified`, `revoked`), `verified_at`, `revoked_at`; unique `(workspace_id, normalized_email)`. |
| `email_verification_challenges` | address ID, hashed single-use token, expiry, consumed time, request/rate-limit metadata. Never persist the raw token. |
| `portal_account_email_addresses` | composite-scoped link between a portal account and a verified address; unique pair; disabling/revoking blocks its mailboxes. |
| `inbound_mailboxes` | portal account, opaque alias token/address, active/revoked/rotated timestamps; unique provider recipient token. Do not use a card ID here. |
| `inbound_messages` | provider event and message IDs, mailbox ID, receipt time, sender/subject metadata only if required, retention deadline, parse state/version, source fingerprint, review state; unique provider-event ID and a source-message dedupe key. |
| `inbound_message_matches` | message, candidate instance, confidence/reason, decision, applied timestamp, audit-safe field names. |

Raw body or attachment references must be optional, encrypted where retained,
and deleted by a scheduled cleanup. Do not put an inbound address or plaintext
email into the existing encrypted portal-credentials blob: mailbox lifecycle
and verification are independent of credentials.

The migration must be additive and backward compatible: new tables/indexes
only, nullable columns or safe defaults, no destructive changes. Generate it
with Drizzle, inspect it, then run the complete PGlite migration/test suite.

## 4. Domain boundary and routes

- Add `src/domain/inbound-email.ts` for verification, mailbox lifecycle,
  idempotent receipt, matching, review decisions, and retention cleanup.
- Define a small internal ingestion context containing database access,
  workspace ID resolved from the mailbox, and IST date. It must not accept a
  caller-provided workspace ID and must not impersonate `getCtx()` or a member.
- Add thin authenticated actions for settings/review UI. They obtain a normal
  `Ctx`, call the domain layer, and tenant-scope every operation.
- Add one public route, for example `/api/webhooks/email-provider`. Exempt only
  that exact route from session middleware; verify the provider signature using
  raw bytes before JSON/form parsing, validate event shape, and return quickly.
- The receiver records a deduplicated event before work that may be retried.
  If asynchronous processing is introduced, use a persisted job/state rather
  than an in-memory promise.

## 5. Parser and matching

Start with deterministic parser modules per known sender/template. Each parser
returns a typed extraction plus a parser version; it neither writes the database
nor decrypts credentials.

Matching is a transaction:

1. Resolve the active alias to a portal account and workspace.
2. If present, find `benefit_instances` by the existing workspace-unique
   booking ID.
3. Otherwise restrict candidates to cards actively mapped to that portal
   account, then score provider, offer, last-four, date, and status.
4. Require one unambiguous candidate and no conflict with manually supplied
   booking ID, code, expiry, or status.
5. Apply the established domain transitions and encrypted-code helper, then
   write the match/audit decision in the same transaction.

Never match solely on merchant text or recipient address. A portal account can
map several cards, and the same card can map several portal accounts.

## 6. Operations, retention, and testing

- Add a protected scheduled cleanup route/job to delete expired raw source
  material and attachments. Its cadence need not be precise; its authorization
  and idempotency do.
- Bound body and attachment sizes and allowed content types before retrieval.
- Centralize redaction for webhook and parser errors. Test that log output has
  no OTPs, voucher codes, booking IDs, full email addresses, or message bodies.
- Add PGlite tests for every migration and domain rule, plus route tests for
  signature checks and replay resistance. Add tenant-isolation tests for every
  authenticated action and internal mailbox resolution path.
- Test the complete lifecycle with a provider sandbox: verify source address,
  enable mailbox, forward supported confirmation and voucher messages, rotate
  the alias, revoke the address, and confirm each state has the required effect.

## 7. Delivery sequence

1. Email-confirmation gate and tests.
2. Verification/address/mailer schema and settings UI.
3. Mailbox alias lifecycle and provider webhook receipt with no mutation.
4. Review queue and manual application of a parsed result.
5. High-confidence automatic updates for a small template allow-list.
6. Retention cleanup, operational metrics, and a production rollout behind a
   workspace-level feature flag.
