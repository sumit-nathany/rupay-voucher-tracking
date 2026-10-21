# Captcha solving backends

The worker can solve the portal's login CAPTCHA in four ways. This note says
what each one costs, what state it is in today, and how to switch between
them.

## The four backends

**CapMonster is the one to use.** It is the cheapest of the three, the
proxy is included in the price, and unlike CapSolver its minimum top-up is
small. Their FAQ also says a **$0.10 test balance is available on request**
— email their support and ask for it, which is 166 solves and costs nothing
to try.

| Backend | How it works | Cost | State today |
|---|---|---|---|
| **CapSolver** | Third-party API. Sends the sitekey and page URL, gets back a token. | **$0.80 per 1,000** solves | The secret exists but **the key is dead** (`ERROR_KEY_DENIED_ACCESS`) |
| **2Captcha** | Third-party API, same shape. | $1 – $2.99 per 1,000 | Not configured. The code is there. |
| **NopeCHA** | Third-party API. The key is **optional** — without one it uses a free tier tied to the calling IP. | Roughly $0.011 – $0.083 per 1,000 (derived from their plans) | Not configured. The code is there. |
| **In-browser audio + Gemini** | The worker clicks the audio challenge, transcribes it with Gemini, types the answer back. | One Gemini call per solve, no per-solve fee | Implemented, but **Google blocks the audio challenge from cloud IP addresses** — it returns "Your computer or network may be sending automated queries" instead of the clip |

The order they are tried in is in `worker/src/captcha-solver.ts`:
**CapMonster**, then CapSolver, then NopeCHA, then 2Captcha, then the audio
path, then it waits for a human.

A backend that rejects its key is disabled for the rest of the run rather
than retried, so one dead key does not cost a minute per account.

## Switching to a third-party API

No code change is needed. Put a valid key in Secret Manager and the worker
picks it up on the next run.

```bash
# 1. Get a key from the provider's dashboard.
#    CapMonster:  https://capmonster.cloud/en/          (and ask support for
#                 the $0.10 test balance)
#    CapSolver:   https://dashboard.capsolver.com/passport/register
#    2Captcha:    https://2captcha.com/registration
#    NopeCHA:     https://nopecha.com/dashboard

# 2. Store it.
printf '%s' 'THE_KEY' | gcloud secrets create CAPSOLVER_API_KEY \
  --project=rupay-order-worker-prod --replication-policy=automatic --data-file=-

# 3. It is already mounted by worker/infra/deploy.sh, so redeploy the job's
#    template to pick up a *new* secret version. Running jobs keep the
#    template they started with.
worker/infra/deploy.sh
```

A job that is already running keeps the secret version it started with, so
the change takes effect on the next run.

## Checking a key before you deploy it

```bash
# CapMonster
curl -s -X POST https://api.capmonster.cloud/getBalance \
  -H 'content-type: application/json' \
  -d "{\"clientKey\":\"$KEY\"}"
# -> {"errorId":0,"balance":0.1}  or
# -> {"errorId":1,"errorCode":"ERROR_KEY_DOES_NOT_EXIST",...}

# CapSolver
curl -s -X POST https://api.capsolver.com/getBalance \
  -H 'content-type: application/json' \
  -d "{\"clientKey\":\"$KEY\"}"
# -> {"errorId":0,"balance":12.34}  or
# -> {"errorId":1,"errorDescription":"account authorization is invalid: Code(41)"}
```

The worker also does this itself before it opens a browser, so a bad key is a
one-line error rather than a failed unattended run.

## What it actually costs

A single solve is $0.0006 on CapMonster, $0.0008 on CapSolver and
$0.001 – $0.003 on 2Captcha.

The portal allows one order per account per 24 hours, and the CAPTCHA is only
needed when a session has expired — so the worker needs a handful of solves a
week, not a stream of them. **A $1 top-up on CapMonster is 1,600 solves**, and
on CapSolver it is 1,250. A dollar is months of cover, so there is no need to
hunt for a free trial.

CapSolver's minimum top-up is $6, which is why CapMonster is the better fit
here: it is the cheapest per solve *and* it does not make you buy $6 of
credit you will not use for months.

## The free options, actually verified

Everything below was checked against the vendor's own pages on 2026-10-21.
The three that are worth doing stack up to roughly 270 free solves.

### 1. YesCaptcha — 1,500 points, about 100 free tokens

Their homepage says: *"Register now for 1500 points (usable 100 times).
Contact customer service to claim."*

- 1,000 points = ¥1, and a v2 token (`NoCaptchaTaskProxyless`) costs **15
  points** — so 1,500 points is 100 tokens.
- **How to claim:** register at `https://yescaptcha.com/auth/register`
  (email verification code), then ask their support — Telegram
  `@yescaptcha_official`, WeChat `@yescaptcha_official`, or the contact form
  in their docs. Say "claim signup bonus points".
- **Gotcha:** the balance has to be **more than 10 points** before you can
  create a task, so the bonus has to actually land before you call the API.
- They also sell `ReCaptchaV2Classification` — the "which squares do I
  click" answer rather than a token — for **6 points**, which is the same
  thing our own service does, sold per challenge.
- Referring a friend earns you 20% of their spend, and them a VIP level one
  step below yours, which is at least a 2% bonus on every later top-up.
- Now wired into the worker as `YESCAPTCHA_API_KEY`.

### 2. CapMonster — $0.10 on request, about 166 free tokens

Their docs say: *"After registering with CapMonster Cloud, you can receive
$0.1 to your balance to test the service."*

- Register, then ask their support chat or `support@capmonster.cloud` for
  it. **Not granted to throwaway-email accounts.**
- $0.10 at $0.60 per 1,000 is **166 solves**.
- They also give **ZennoPoster users 5,000 free captchas** — worth asking
  for in the same message.
- Unused balance is refundable within **3 days** of purchase, so a small
  top-up is risk-free.
- Now wired into the worker as `CAPMONSTER_API_KEY`.

### 3. AZCaptcha — $0.10 free credit, no card

- **$0.10 free credit after email verification**, no credit card needed.
- Minimum top-up **$5**, credits never expire, and unused credit is
  refundable within 30 days if less than 10% has been used.
- Their reCAPTCHA v2 **grid** recognition is **$0.10 per 1,000** — by far
  the cheapest grid rate anywhere.
- Not wired in yet; it is a small addition if we want a third.

### Also worth knowing

- **NopeCHA** gives **100 free credits every day**, and the recognition API
  needs no account and no key. The token API needs a free account for a key.
  One catch: *"Free credits are not available from high-risk IP addresses,
  such as VPNs or proxies"* — which is worth remembering, because the worker
  runs on a cloud address. I tried the keyless tier from here and got
  `{"error":11,"message":"Rate limit reached"}` straight away.
- **2Captcha** has no coupon, but signing up through an **affiliate link**
  is advertised as worth a 5–10% first-deposit bonus, and unused balance is
  refundable within 30 days, so a small top-up is risk-free.
- **CapSolver** — the $6 minimum is confirmed by their own blog, and they
  advertise a signup code **`CAP26`** for "bonus credits" (the amount is not
  published anywhere, so treat it as "some bonus"). The code `capsolver26`
  is 50% off BrightData proxies, which is only useful if you buy proxies.
- **NoCaptchaAI** is **$0.25 per 1,000** for v2 with **no minimum** and no
  card, if we ever want the cheapest paid option with no commitment.
- **BestCaptchaSolver** will do a free test if you email
  `help@bestcaptchasolver.com`.
- **Anti-Captcha** has a "Demo Credits" page in the customer area, amount
  unpublished.

### Two corrections

- **Cloud credits do not pay for captcha APIs.** The $300 Google Cloud
  welcome credit, the $100–200 from AWS, and the $100 from Azure's student
  pack can only be spent on that cloud's own products. A captcha-API invoice
  cannot be covered by any of them. What cloud free tiers *do* cover is
  running **our own** solver: Cloud Run's free tier (2M requests a month,
  360,000 GB-seconds of memory, 180,000 vCPU-seconds) hosts it at no
  marginal cost, and a Cloud Run Job bills on the same meters. That is the
  real near-zero path, and it is the one we have already built.
- **Coupon-aggregator codes are dead.** Sites like couponswift and
  couponmister advertise "25% off 2Captcha" and similar, but 2Captcha
  publishes no coupon field and there is no evidence any of those codes is
  accepted. Do not waste time entering them. The same goes for the
  "YesCaptcha coupon" — there is no coupon box on their form any more; the
  mechanism is a referral link.

## Why a third-party API is the right interim answer

The worker runs on Cloud Run, so its browser comes from a Google IP address,
and Google treats those as suspect. That is why the in-browser audio path is
blocked and why our own solving service gets a full image puzzle every time
instead of a checkbox being waved through.

A third-party solver mints the token **from their own IP**, in their own
browser. That sidesteps the whole trust problem: the token is already
accepted-grade when it arrives, and the worker only has to put it in the
form.

It also costs almost nothing at our volume, and it is the path the worker
already supports. The service in `recaptcha-solver` is the better long-term
answer — it removes the per-solve fee and the third-party dependency — but it
needs the 4×4 image path to be reliable first, and today it is not.
