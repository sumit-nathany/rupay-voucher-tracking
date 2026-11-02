# Voucher delivery email ingestion — Requirements

> **Status:** Proposed feature requirements. It extends the tracker and its
> existing portal-account automation model; it does not authorize a production
> email receiver until its implementation plan and provider choice are approved.
> **Depends on:** [REQUIREMENTS.md](../REQUIREMENTS.md) for tenancy and voucher
> security, and [automated-rupay-ordering-requirements.md](./automated-rupay-ordering-requirements.md)
> for portal-account semantics.

## 1. Goal

Let a workspace forward voucher delivery and order-confirmation emails to a
private tracker address. The tracker extracts only supported information,
matches it to an existing benefit instance, and either records the update or
asks the user to review it.

This is not a general-purpose mailbox, a way to sign in as the user, or a
replacement for the RuPay portal.

## 2. Identity and routing model

- A Supabase account email must be confirmed before a user may provision or
  access a workspace.
- An address used to receive voucher mail must be separately verified. It is
  not assumed to be the workspace login email, a holder email, or a portal
  login ID.
- A **portal account** is the routing boundary. The current model permits one
  account to map to several cards, and a card to map to several accounts; a
  direct card-email relationship would lose that meaning.
- Each enabled portal account gets a distinct, high-entropy, revocable inbound
  mailbox address. Forwarding mail to that address declares the portal account
  the message relates to.
- A verified email address may be linked to more than one portal account. It
  proves setup-time control of a mailbox; it is not a per-message authorization
  check, because forwarding commonly retains the original merchant `From`
  address.
- A portal login ID may be an email, phone number, or other identifier. Never
  infer a verified email identity by decrypting or comparing credentials.

## 3. Ingestion behavior

1. The email provider sends a signed event to a public webhook.
2. The service verifies the signature over the unmodified request body and
   performs idempotent receipt before parsing.
3. It resolves the recipient address to one active portal-account mailbox.
4. It extracts only fields from supported templates: booking/reference ID,
   voucher code/PIN, expiry date, merchant/provider, and card-last-four where
   present.
5. It matches in this order: workspace-unique booking ID; then the receiving
   portal account and its current card mappings plus extracted facts.
6. It updates an instance automatically only if exactly one valid match is
   found at high confidence. Otherwise it creates a review item and makes no
   instance change.

An order confirmation may set `Ordered but Coupon not received`, order date,
and booking ID. A voucher delivery may set encrypted code/PIN, expiry date,
and `Coupon Received`. Existing user-entered fields must never be silently
overwritten when they conflict with parsed data; the conflict requires review.

## 4. Security and privacy

- Inbound aliases are opaque capability tokens, never derived from workspace,
  card, account, email, or database IDs. They can be revoked and rotated.
- Verify provider signatures; reject unsigned, stale, malformed, oversized, or
  duplicate deliveries before parsing. The route is public only to the email
  provider, not to browser users.
- Do not log raw mail, headers, attachments, email addresses, voucher codes,
  PINs, booking IDs, or parsed secrets. Voucher codes retain the app's existing
  AES-GCM-at-rest protection.
- Store the smallest amount of source data needed for review and audit. Define
  a short raw-body/attachment retention period; retain structured audit facts
  without the secret values after expiry.
- Every table and query is workspace scoped. A webhook must use a narrowly
  defined internal ingestion context; it must not fabricate a browser session
  or call a UI server action.
- Every automatic mutation has an immutable audit record identifying the source
  message, parser version, match reason, and fields changed. Users can correct
  an imported result through the normal instance workflow.

## 5. User experience

- Account settings show verified forwarding addresses and portal-account inbox
  addresses, with copyable forwarding instructions and explicit revoke/rotate
  controls.
- The portal-account inbox is unavailable until the account owner has a
  confirmed login email and at least one verified forwarding address is linked
  to that portal account.
- A review queue shows the safe metadata, extraction result, candidate benefit
  instances, conflict reason, and accept/reject action. Codes remain masked
  unless the existing explicit reveal flow is used.
- Initial rollout supports a small allow-list of known templates. Unknown mail
  is kept for review (subject to retention), never guessed into an update.

## 6. Acceptance criteria

1. An unconfirmed Supabase user cannot receive a workspace or use app data.
2. Only a verified email can enable a portal-account mailbox; revoking either
   link stops future automatic processing immediately.
3. A message sent to a revoked, unknown, or malformed recipient cannot alter
   any workspace data.
4. Replayed provider events and duplicate source messages create at most one
   inbound record and one instance mutation.
5. A booking ID matches only within its workspace; otherwise matching is
   constrained by the mailbox's portal account and mapped cards.
6. Ambiguous, unrecognized, or conflicting messages require user review.
7. Tests cover signature rejection, tenant isolation, idempotency, alias
   rotation, parsing, matching, state transitions, and no-secret logging.
