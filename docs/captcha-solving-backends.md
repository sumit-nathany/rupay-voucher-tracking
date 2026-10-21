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

## The free options, honestly

- **NopeCHA's keyless free tier** works without an account, but it is tied
  to the calling IP and is rate-limited. From our own address it answered
  `{"error":11,"message":"Rate limit reached"}` straight away, and from a
  cloud IP it would be worse. Fine for occasional use, not for something the
  worker depends on.
- **2Captcha's demo page** lets you try a type in the browser, but it still
  wants your own API key, so it is not a free API.
- **CapMonster** is the cheapest paid option at $0.60 per 1,000, with the
  proxy included. Their FAQ offers a **$0.10 test balance on request** —
  email support and ask. It is now wired into the worker.

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
