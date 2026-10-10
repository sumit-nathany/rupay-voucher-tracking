# Automated RuPay Ordering — Requirements

> **Status:** Proposed feature requirements.
> **Depends on:** [REQUIREMENTS.md](../REQUIREMENTS.md) for the tracker-wide product, security, and tenancy requirements. This document is authoritative only for automated ordering.
> **Phase:** Post-v1 proposal for the later ordering phase in [PLAN.md](../PLAN.md). It does not change v1 scope or authorize implementation/rollout until that phase is approved.

---

## 1. Context and terminology

RuPay is an Indian card network. Banks issue RuPay debit and credit cards, and some of those cards are enrolled in the **RuPay Benefits** programme. The RuPay Benefits portal lists the benefits available for each eligible card: for example, merchant vouchers, subscriptions, discounts, travel offers, or service offers.

A cardholder must sign in to the RuPay Benefits portal and **order** an available benefit before the benefit's ordering deadline. The precise set of benefits is not universal: it depends on both the card product and the benefit. A benefit may reset every month, quarter, half-year, or calendar year. For example, one card may provide a grocery voucher every quarter and a streaming subscription once per year, while another card has a different set and frequency of benefits.

The existing RuPay Voucher Tracker is the user's tracking portal for this benefit lifecycle across multiple cards and cardholders. It maintains the shared card-benefit catalogue and lets a workspace track which benefits are available, ordered, received, used, skipped, withdrawn, or sold. It generates a separate benefit instance for each entitlement period, so a yearly or half-yearly benefit is not accidentally treated as newly available every quarter. This application does not replace the RuPay Benefits portal; it records and organizes the user's benefit activity around it.

The RuPay Benefits workflow has two separate actions:

1. **Order** a benefit on the RuPay Benefits portal. This normally creates a booking and a coupon is delivered later.
2. **Use** the received coupon with the merchant before its expiry date.

This feature automates the first action only. Although the portal may call its action “redeem,” this document uses **order** to avoid confusing it with spending a voucher at a merchant.

An eligible tracker instance is normally in the `Not Ordered` status. A successful portal order changes it to `Ordered but Coupon not received`; the existing tracker remains responsible for recording a received coupon and its later merchant use.

The portal limits a RuPay account to one benefit order per rolling 24-hour period. A workspace can contain several holders and cards, but a portal account is a separate automation boundary: cards attached to the same portal account share that limit.

## 2. Goal

The tracker must be able to order selected, unclaimed RuPay benefits automatically once per day, according to user-configured rules, while preventing duplicate orders and protecting portal credentials.

The feature must give the user a clear record of what was attempted, ordered, deferred, skipped, or needs manual attention.

## 3. Scope

### In scope

- A workspace owner configures one or more RuPay portal accounts and maps its tracked cards to them.
- The owner creates, enables, pauses, and prioritizes ordering rules.
- A daily job selects at most one safe candidate per portal account and orders it through the portal.
- Rules may restrict ordering to particular cards or benefits.
- For a catalogue benefit with mutually exclusive offers, a rule may specify the portal offer to choose automatically.
- The job records confirmed bookings, attempts, and sanitized failures in the tracker.
- The user can pause all ordering automation or a single portal account immediately.

### Out of scope

- Spending a received code on a merchant website or app.
- Collecting, reading, or automatically storing issued coupon codes from email/SMS/the portal.
- Bypassing CAPTCHA, OTP, device verification, rate limits, or other portal security controls.
- Guessing portal endpoints, card/BIN identifiers, or another person's account/card information.
- Ordering more than one benefit per portal account in 24 hours.

## 4. User configuration

### Portal accounts and cards

For each portal account, the user must be able to:

- Give it a local label (for example, “Papa’s RuPay login”).
- Save the credentials required for unattended portal login.
- Map one or more tracker cards to the corresponding registered portal card and required portal identifiers.
- View its connection state: connected, paused, credentials expired, challenge required, portal changed, or needs attention.
- Pause or disconnect the account without deleting tracker history.

The app must validate that a mapped card belongs to the current workspace. It must not treat a card holder label as proof that two cards share a portal login.

### Ordering rules

An ordering rule must contain:

- Its portal account.
- Enabled/disabled state.
- A priority, where a lower number runs before a higher number.
- One or more selected tracker cards and/or benefits; an omitted filter means every mapped card/benefit on that account.
- For a pick-one benefit, the chosen portal offer. If the configured offer is not available at run time, that candidate is skipped and reported; the worker must not choose a substitute.

For a matching pick-one instance, an enabled rule without a valid default for that instance's catalog version cannot nominate it. Report it as `choice_required` and continue to the next candidate in selection order; do not silently select another offer. At most one candidate may be submitted per portal account in a run.

Only an enabled rule can nominate an instance for automated ordering. The user can disable a rule or the global automation switch at any time; the next job must honor that change before login and again immediately before submission.

## 5. Eligibility and selection

On its daily run, the system must consider only instances that:

- Belong to an active, mapped card in the workspace.
- Have status `Not Ordered`.
- Are not withdrawn, skipped, sold, or already associated with a confirmed or unresolved uncertain portal-order attempt.
- Have not passed their order deadline.
- Match an enabled rule for the card's portal account.

For each portal account, the system must:

1. Skip it if it is paused, needs attention, or has a confirmed or uncertain submission in the preceding 24 hours.
2. Sort otherwise eligible candidates by enabled-rule priority, then earliest order deadline, then stable instance ID. A candidate whose required pick-one default is missing or invalid is not eligible; report the reason and continue to the next candidate in this order.
3. Select only the first candidate.
4. Acquire an account-level lock, then re-check the global pause state, account state, instance status, and 24-hour limit before login and again before the final portal submission.

The 24-hour guard is measured from `submission_started_at`, set immediately before the final portal submission. A candidate reservation made before login does not start the 24-hour window. If the worker cannot determine whether a submission reached the portal, it must block the account for 24 hours from `submission_started_at` rather than risk a duplicate order. An in-progress reservation or submission must also block another worker from reserving a different candidate for that account.

If a worker exits with an active attempt, an expired pre-submission reservation may be cancelled only when no portal submission began. An expired attempt whose submission began must be treated as uncertain, require manual portal reconciliation, and never be retried automatically.

## 6. Portal integration behavior

The real portal flow must be captured and verified with the account owner's own session before implementation. The implementation may use Playwright, documented portal APIs, or both, but may only call endpoints and submit fields confirmed during that capture.

For a selected candidate, the worker must:

1. Start a fresh, isolated browser/session for its portal account.
2. Log in using decrypted credentials.
3. Resolve the mapped portal card and selected offer.
4. Verify that the offer is still available and that the portal presents the expected order confirmation path.
5. Submit one order exactly once.
6. Record success only when the portal returns an unambiguous confirmation or booking/reference ID.

On confirmed success, the tracker must atomically store the safe booking/reference ID and order date, set the instance to `Ordered but Coupon not received`, and mark the attempt `confirmed`. If the portal confirms an order but an existing manually entered booking reference conflicts, preserve that tracker field, retain the confirmed portal reference in the attempt record, update the instance status and order date, set the account to `needs attention`, and require manual reconciliation before further automation.

On a rejection known to occur before submission, the instance remains `Not Ordered` and the attempt is marked `failed_pre_submit`. A retry is allowed only on a later scheduled run if no request could have reached the portal.

On timeout, connection loss, malformed response, browser crash after submission, or any other ambiguous outcome, the instance remains `Not Ordered`, the attempt is marked `uncertain`, and the portal account is paused from further automatic ordering for at least 24 hours from `submission_started_at`. The user must see an action-required notice and resolve the portal result manually before ordering resumes. If the user confirms that a booking exists, record the confirmed reference and update the instance as ordered. If the user confirms that no booking exists, mark the attempt `resolved_no_order`; the instance remains eligible after the 24-hour window. In either case, clear `needs attention` only after the user records the resolution.

If login presents OTP, CAPTCHA, device verification, an expired credential, or an unrecognized portal flow, the worker must stop before ordering, mark the account `needs attention`, and report a generic reason. It must never attempt to solve, relay, or bypass that challenge. The account state `needs attention` also applies to ambiguous outcomes and tracker reconciliation conflicts; it must be cleared only through an explicit user action after resolving the issue.

## 7. Data and audit requirements

The implementation must retain enough non-sensitive data to explain automation behavior:

- A portal-account record, owned by a workspace, with encrypted credential material and operational status.
- Card-to-portal-account mappings and the confirmed portal identifiers needed to act on the user's own cards.
- Ordering rules and their selected pick-one offer IDs.
- A run record for each daily execution, including start/end time, status, and aggregate counts.
- One attempt record per candidate submission, including instance, portal account, rule, safe booking/reference ID when confirmed, attempt state, timestamps, and a sanitized error category.

Portal credentials, JWTs, cookies, session IDs, OTPs, raw portal payloads, and voucher codes are secrets. They must not be returned from server actions, displayed in the UI, written to logs, sent to telemetry, or committed to source control.

All automation records must follow the existing workspace-isolation model: every access is scoped to the authenticated user's workspace, and a user cannot discover whether another workspace has a portal account or attempt record.

## 8. Hosting and scheduling

- The automation worker runs as a Google Cloud Run Job in `asia-south1` (Mumbai).
- Cloud Scheduler triggers one daily run using the Asia/Kolkata timezone.
- The job has maximum parallelism and maximum instances set to one. Account-level locking remains mandatory because scheduler delivery and manual recovery can overlap.
- Google Secret Manager stores the worker's operational secrets and the encryption-key material; encrypted per-user portal credentials remain in the application's database.
- Vercel continues to host the tracker UI/API and Supabase continues to provide database/authentication services.
- A Google Cloud budget alert must be configured before enabling the scheduler. Document the estimated monthly cost for the configured workload; the feature must not depend on free-tier availability for correctness.

## 9. User experience requirements

The tracker must provide an Automation area that shows:

- Global automation state and an immediate pause-all control.
- Each portal account's state, mapped cards, last run outcome, and next eligible time.
- Ordering rules, their priority and selected pick-one defaults.
- The latest run's selected candidate, successful order, skips, failures, and required user action.
- A concise, safe explanation for failures, without raw portal responses or credentials.

When an account needs attention, the UI must explain the needed manual action—for example, reconnect credentials, complete portal verification independently, or check whether a booking was created—before allowing automated ordering to resume. For an uncertain attempt, the user must be able to record whether a booking was found and provide its safe reference, or confirm that no booking exists. Show any remaining account cooldown after resolution.

## 10. Acceptance criteria

The feature is ready when all of the following are true:

1. Portal terms and account-owner authorization have been reviewed and permit the intended automation; an enabled rule can then successfully order one low-risk, eligible benefit through the verified portal flow.
2. The tracker records the portal booking/reference ID, order date, and `Ordered but Coupon not received` status only after confirmed success.
3. Concurrent workers cannot reserve separate candidates for the same portal account, and a second run within 24 hours of `submission_started_at` does not submit another order for that account.
4. A disabled rule, global pause, missing/invalid pick-one default, invalid selected offer, expired deadline, skipped instance, or non-`Not Ordered` instance is never submitted.
5. A post-submission timeout is shown as uncertain and cannot be retried automatically.
6. A worker interruption before submission releases only a proven pre-submission reservation; an interruption after submission begins is surfaced as uncertain and requires manual reconciliation.
7. A user-confirmed booking resolves an uncertain attempt as confirmed; a user-confirmed absence resolves it as `resolved_no_order` and allows retry only after the 24-hour account window.
8. OTP, CAPTCHA, expired credentials, and changed portal behavior stop the account safely without placing an order.
9. Portal secrets and voucher codes are absent from UI responses, application logs, worker logs, telemetry, and test fixtures.
10. Tests cover candidate selection, locking, 24-hour enforcement, confirmation handling, uncertain results, manual resolution, and tenant isolation.
