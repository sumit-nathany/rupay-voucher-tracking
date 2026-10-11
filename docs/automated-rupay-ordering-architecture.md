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

## 3. Automation Daemon & Multi-Account Chained Scheduling

Instead of a fixed calendar cron (which cannot adapt to rolling 24h intervals across multiple accounts), the system uses a **continuous event loop daemon** (`worker/src/daemon.ts`).

### 3.1 Dynamic Schedule Evaluation (`getNextEligibleRunTime`)
Located in `web/src/domain/automation.ts`, `getNextEligibleRunTime(db, workspaceId)` queries all connected portal accounts:
1. If any account has `cooldownUntil <= now` (or null), it returns `{ eligibleNow: true, nextRunAt: now, accountLabel }`.
2. If all connected accounts are in cooldown, it sorts them by `cooldownUntil` ascending and returns the earliest unlock timestamp: `{ eligibleNow: false, nextRunAt: earliest.cooldownUntil, accountLabel: earliest.label }`.

### 3.2 The Chained Wake-Up Event Loop (`worker/src/daemon.ts`)
```ts
while (true) {
  const nextRun = await getNextEligibleRunTime(db);

  if (!nextRun.eligibleNow && nextRun.nextRunAt) {
    const delayMs = nextRun.nextRunAt.getTime() - Date.now();
    // Sleep until the exact unlock time of the earliest account
    await sleep(delayMs);
    continue;
  }

  // Account is eligible now!
  await runAutomationJob({ db, client });

  // Account 1 just finished and recorded its 24h cooldown.
  // Loop restarts immediately -> getNextEligibleRunTime finds Account 2!
  // Daemon sleeps until Account 2's unlock time.
}
```

### 3.3 Multi-Account Execution Sequence
1. **Initial State:** Account 1 unlocks at 06:40 PM IST; Account 2 unlocks at 09:15 PM IST.
2. **06:40 PM IST:** Daemon wakes up $\rightarrow$ executes Account 1 $\rightarrow$ Account 1 sets cooldown to tomorrow 06:40 PM.
3. **Chaining:** Daemon re-evaluates the queue. Account 2 is now the earliest pending account.
4. **Sleep:** Daemon sleeps until 09:15 PM IST.
5. **09:15 PM IST:** Daemon wakes up $\rightarrow$ executes Account 2 $\rightarrow$ repeats for subsequent accounts.

### 3.4 Dynamic UI Header Sync
The web application header (`web/src/components/automation/automation-header.tsx`) queries `getNextEligibleRunTime` on page load:
- Displays: `Next run: Today at 06:40 PM IST (when coolfriendamit0506@gmail.com unlocks)`
- The moment Account 1 finishes, any page visit or action updates the header to show Account 2's time.

---

## 4. Browser Automation & CAPTCHA Session Strategy

### 4.1 Per-Account Profile Isolation (Strategy B)
To allow unattended scheduled runs without re-solving Google reCAPTCHA each time:
1. Each portal account uses an independent persistent user profile directory on disk:
   `worker/.browser-data/account_<portalAccountId>/`
2. **One-Time Onboarding:** When a new RuPay account is connected, the operator opens a live browser window once using `worker/src/browser-runner.ts`, logs in with credentials, and solves the reCAPTCHA manually.
3. **Persistent Session:** Playwright preserves the resulting `jwt` cookie and storage state inside that account's profile directory.
4. **Scheduled Execution:** The daemon boots Playwright with that account's profile, navigates directly to `https://rupayselect.truztee.com/#/offers`, verifies `jwt` cookie presence, and executes card/offer selection without hitting the login screen.

### 4.2 Handling Expired Sessions & Challenges
If a portal session expires:
1. The runner checks for `jwt` cookie presence after page load.
2. If absent and reCAPTCHA is presented:
   - In unattended mode: Sets account status to `challenge_required` or `needs_attention` and exits cleanly without throwing errors or locking the account.
   - An alert/notification is triggered for the operator to perform a 1-click re-authentication.

---

## 5. Operational Commands

From `worker/`:

```bash
# Run one-off browser runner against the active pre-prod database
npm run browser:preprod

# Start the continuous multi-account daemon
npm run daemon:preprod
```

From `web/`:

```bash
# Apply pending schema migrations (including cooldown_until)
npm run db:migrate:preprod

# Run test suite (PGlite in-memory Postgres)
npm test
```
