# Automated RuPay Ordering — Architecture & Operational Runbook

> **Context:** Architectural specification, discovery findings, and operational guide for the automated RuPay voucher ordering subsystem. Supplements [automated-rupay-ordering-requirements.md](./automated-rupay-ordering-requirements.md) and [automated-rupay-ordering-implementation-plan.md](./automated-rupay-ordering-implementation-plan.md).

---

## 1. Executive Summary & Discoveries

During live browser instrumentation and portal analysis of the RuPay Select platform (`rupayselect.truztee.com` / `apirupayselect.truztee.com`), several critical operational behaviors were discovered:

### 1.1 Entitlement & Card Matching Model
- **Account-Level Entitlement:** The RuPay portal **does not track or store individual physical 16-digit card numbers or last 4 digits**.
- Benefit entitlements (e.g. 1 per quarter for a specific bank card type) are enforced strictly at the composite level of **`(portal_account, cardtypeid, quarter)`**.
- A physical card's validation only occurs downstream at the payment gateway during a nominal ₹2 charge.
- Registered cards available for selection appear in the portal header's `<select id="cardSelect">` dropdown, where each option value is formatted as `${cardtypeid}_${cardbinid}` (e.g., `"151_208"` for PNB Salary Imperial).

### 1.2 Authentication & CAPTCHA Mechanics
- **Google reCAPTCHA v2:** The portal login form requires solving a standard Google reCAPTCHA (`textarea#g-recaptcha-response`).
- **Automatic solve (fallback):** when a session has expired and the login form is reached, the runner solves the reCAPTCHA unattended via the captcha solver in `worker/src/captcha-solver.ts` (`autoSolveRecaptcha`), which tries a third-party solving service (CapSolver / 2Captcha / NopeCHA, per configured API key) and falls back to the in-browser **audio challenge** path transcribed with Gemini. The runner continues the login only when the solver reports a **verified** token.
- **Session Persistence:** Once logged in, the portal stores a JWT authentication token in cookies (`jwt`) and browser storage.
- Using a persistent browser profile directory (`chromium.launchPersistentContext`) preserves these cookies across runs. Unattended runs bypass the login form and CAPTCHA completely as long as the session remains active.
- To avoid session collisions across multiple RuPay accounts, each account uses an isolated profile directory: `.browser-data/account_<portalAccountId>/`.

### 1.3 Booking Initiation API Contract
- Initiating an order triggers an API call:
  ```http
  POST https://apirupayselect.truztee.com/api/Select/addUserTransaction
  Content-Type: application/json
  Cookie: jwt=<session_token>
  sessionid: <negated_timestamp>

  {
    "tamount": 2,
    "pid": 62,
    "order_status": "Initiated",
    "cardtypeid": 151,
    "cardbinid": 208
  }
  ```
- **On Success:** Returns an HTML form injection redirecting to the payment gateway (CCAvenue / Razorpay).
- **On 24-Hour Limit:** If any booking was already made by this account in the preceding 24 hours:
  ```json
  {
    "code": 1,
    "message": "Booking Limit Reached: You have already availed a booking in the last 24 hours. Try again after 11 Oct 2026 18:40 hrs.",
    "response": []
  }
  ```

---

## 2. 24-Hour Cooldown & Rate Limit Architecture

The RuPay portal enforces a strict rolling 24-hour window per portal account across all registered cards.

### 2.1 Database Schema (`app.portal_accounts`)
Column added via migration `0014_portal_accounts_cooldown_until.sql`:
- `cooldown_until` (`timestamptz nullable`): The exact UTC timestamp until which this portal account is blocked from placing any order.
- `status_detail_code` (`text nullable`): Category code (e.g., `'daily_limit_reached'`).

### 2.2 Parsing & Storage (`web/src/lib/portal-cooldown.ts`)
- Portal error messages express dates in Indian Standard Time: `DD Mon YYYY HH:mm hrs` (e.g. `11 Oct 2026 18:40 hrs`).
- `parsePortalCooldownDate(message)` parses this string into a standard UTC `Date` object (`2026-10-11T13:10:00.000Z`).
- If an order initiation receives a limit message, `recordPortalAccountCooldown(db, accountId, cooldownUntil, 'daily_limit_reached')` immediately persists the unlock timestamp.

### 2.3 Candidate Filtering (`web/src/domain/automation.ts`)
Inside `findCandidatesForAccount(db, accountId, today)`:
- If `account.cooldownUntil && account.cooldownUntil > now`, the account is immediately disqualified and returns `null`.
- Prevents redundant browser boots, failed transactions, and account lockouts.

---

## 3. Scheduling: the deployed batch job, and the local daemon

The 24-hour limit is enforced in the database (`app.portal_accounts.cooldown_until`), so eligibility can be *computed* at any moment rather than *awaited*. That single fact determines the deployed shape.

### 3.1 The deployed shape: a Cloud Run Job, swept hourly

Each execution of the Cloud Run Job:
1. Lists connected portal accounts and evaluates eligibility for each.
2. For every eligible account, reserves at most one candidate and orders it.
3. Records the outcome, releases the account's advisory lock, and moves on.
4. Exits.

The job holds no state between executions. Cloud Scheduler runs it every hour in `Asia/Kolkata`. Because the cooldown lives in the database, running more often cannot over-order — a sweep that finds an account still cooling down simply does nothing for it. Hourly also keeps the "next eligible time" shown in the UI accurate to within the hour.

### 3.2 Why not a persistent daemon

A long-lived event-loop daemon was the original design, and `worker/src/daemon.ts` still implements it. It was dropped as the *deployed* shape because:

- **The precision it buys is not needed.** Waking exactly at an unlock instant only matters if an order must land within minutes of the window opening. A benefit's ordering window is days long and the portal's own limit is one order per account per 24 hours, so a 15-minute-granularity schedule is more than sufficient.
- **The session advantage it buys is illusory.** The portal's `jwt` cookie expires one hour after login, so a daemon that sleeps for hours between runs has a cold session anyway and must solve the CAPTCHA on each run — exactly like the batch job. A persisted profile cannot outlive the gap between runs.
- **It is the more expensive and less observable shape.** A daemon is an always-on bill with no natural run boundary, no per-execution record, and no per-execution timeout. A job is billed per execution, self-limits, and produces one Cloud Logging entry per run.
- **It is harder to reason about concurrency.** A process that can wake and act at any moment needs the same locking discipline as a job, but is harder to reason about and to reproduce.

The daemon is **retained as a local development and operations tool** — useful when you want to watch a run happen immediately instead of at the next tick. It exercises the same domain code as the job.

### 3.3 Shared Eligibility Logic (`getNextEligibleRunTime`)

Located in `web/src/domain/automation.ts`, `getNextEligibleRunTime(db, workspaceId)` queries all connected portal accounts:
1. If any account has `cooldownUntil <= now` (or null), it returns `{ eligibleNow: true, nextRunAt: now, accountLabel }`.
2. If all connected accounts are in cooldown, it sorts them by `cooldownUntil` ascending and returns the earliest unlock timestamp: `{ eligibleNow: false, nextRunAt: earliest.cooldownUntil, accountLabel: earliest.label }`.

The batch job uses this function to decide what to order; the UI uses it to display the next run time. One implementation, two consumers.

### 3.4 Dynamic UI Header Sync

The web application header (`web/src/components/automation/automation-header.tsx`) queries `getNextEligibleRunTime` on page load:
- Displays: `Next run: Today at 06:40 PM IST (when the second account unlocks)`
- Because eligibility is computed from live database state, any page visit or action reflects the most recent run.

---

## 4. Browser Automation & CAPTCHA Session Strategy

### 4.1 Per-Account Profile Isolation (local development only)

The deployed job logs in fresh on every execution and keeps no browser profile, cookie jar, or session state between runs (see [implementation-plan.md §7.2](./automated-rupay-ordering-implementation-plan.md)). The per-account profile directory is therefore a **local development convenience only**, never written by the deployed job.

For local runs, to avoid re-solving Google reCAPTCHA every time:
1. Each portal account uses an independent persistent user profile directory on disk:
   `worker/.browser-data/account_<portalAccountId>/`
2. **One-time onboarding:** When a new RuPay account is connected, the operator opens a live browser window once using `worker/src/browser-runner.ts`, logs in with credentials, and solves the reCAPTCHA manually. This establishes a session that subsequent local runs reuse, so the CAPTCHA is normally not encountered again.
3. **Persistent session:** Playwright preserves the resulting `jwt` cookie and storage state inside that account's profile directory. It expires one hour after login, so even locally the session only survives a short window.
4. **Execution:** the runner boots Playwright with that account's profile, navigates to `https://rupayselect.truztee.com/#/offers`, checks for a `jwt` cookie, and executes card/offer selection.

> `worker/.browser-data/` must be excluded from the container image build (`.dockerignore`). It holds live portal sessions.

### 4.2 Handling Expired Sessions & Challenges
If a portal session expires:
1. The runner checks for `jwt` cookie presence after page load.
2. If absent and reCAPTCHA is presented:
   - **Automatic solve (preferred for unattended runs):** the runner asks the captcha solver in `worker/src/captcha-solver.ts` to solve the challenge, and continues the login only when the solver reports a **verified** token. Locally, `launchPersistentContext` persists the refreshed session back into the account profile directory; the deployed job discards the profile when the execution ends.
   - If the solve fails — audio challenge unavailable, transcription unsuccessful, or the token rejected — the runner sets the account status to `challenge_required` or `needs_attention` and exits cleanly without throwing errors or locking the account.
   - An alert/notification is triggered for the operator to perform a 1-click re-authentication.
3. **OTP and device verification are never solved or relayed.** If either is presented, the runner stops and routes the account to the operator exactly as in (2).

#### Two solver flows

The runner can solve the challenge two ways, chosen by `CAPTCHA_PROVIDER`.

| | **Third-party token service** (default: `azcaptcha`) | **Shared solving service** (`service`) |
|---|---|---|
| Code | `worker/src/captcha-solver.ts` | `worker/src/captcha-service-solver.ts` + `worker/src/captcha-service-client.ts` |
| Selected when | `CAPTCHA_PROVIDER` is a token backend — `azcaptcha` by default | `CAPTCHA_PROVIDER=service` |
| How it works | The worker clicks the checkbox in its own browser and asks the provider for a token, then puts the token into its own page | The service opens the portal's login page in its own browser, solves it there, and returns a token, which the runner puts into its own page |
| Where it runs | Inside the worker's container | A separate Cloud Run service (`recaptcha-solver`) in the same project |
| Cost | Per-solve fees | A service to keep running |

The token service is reached over the public API with the provider's key. The
shared service is reached over IAM: the worker sends a Google identity token,
plus the shared secret as `X-Solver-Key`. Either way the token is bound to
the sitekey and the page's origin rather than to the browser that obtained
it, so handing it back to the worker's page is valid for the portal.

> The portal has no `#/login` route — the login form is a modal that opens on
> the offers page, so a solver that opens the page itself has to click the
> Login button to reach the widget.

> The deployed job **discards its browser profile** at the end of each execution, so every run starts with no session and needs the solver. The service keeps one browser profile warm across requests, which is why it can usually get through in seconds rather than showing a full image challenge.

---

## 5. Operational Commands

From `worker/`:

```bash
# One batch run: order whatever is eligible right now, then exit.
# This is exactly what the Cloud Run Job executes.
npm run batch:preprod

# Start the continuous multi-account daemon (local development / operations only)
npm run daemon:preprod
```

From `web/`:

```bash
# Apply pending schema migrations (including cooldown_until)
npm run db:migrate:preprod

# Run test suite (PGlite in-memory Postgres)
npm test
```
