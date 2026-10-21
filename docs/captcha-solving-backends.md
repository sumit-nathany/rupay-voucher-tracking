# Captcha solving backends

The worker can solve the portal's login CAPTCHA in four ways. This note says
what each one costs, what state it is in today, and how to switch between
them.

## The four backends

| Backend | How it works | Cost | State today |
|---|---|---|---|
| **CapSolver** | Third-party API. Sends the sitekey and page URL, gets back a token. | **$0.80 per 1,000** solves | The secret exists but **the key is dead** (`ERROR_KEY_DENIED_ACCESS`) |
| **2Captcha** | Third-party API, same shape. | $1 – $2.99 per 1,000 | Not configured. The code is there. |
| **NopeCHA** | Third-party API. The key is **optional** — without one it uses a free tier tied to the calling IP. | Roughly $0.011 – $0.083 per 1,000 (derived from their plans) | Not configured. The code is there. |
| **In-browser audio + Gemini** | The worker clicks the audio challenge, transcribes it with Gemini, types the answer back. | One Gemini call per solve, no per-solve fee | Implemented, but **Google blocks the audio challenge from cloud IP addresses** — it returns "Your computer or network may be sending automated queries" instead of the clip |

The order they are tried in is in `worker/src/captcha-solver.ts`:
CapSolver, then NopeCHA, then 2Captcha, then the audio path, then it waits
for a human.

## Switching to a third-party API

No code change is needed. Put a valid key in Secret Manager and the worker
picks it up on the next run.

```bash
# 1. Get a key from the provider's dashboard.
#    CapSolver:  https://dashboard.capsolver.com/passport/register
#    2Captcha:   https://2captcha.com/registration
#    NopeCHA:    https://nopecha.com/dashboard

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
curl -s -X POST https://api.capsolver.com/getBalance \
  -H 'content-type: application/json' \
  -d "{\"clientKey\":\"$KEY\"}"
```

A working key answers with a balance. The current one answers with
`{"errorId":1,"errorDescription":"account authorization is invalid: Code(41)"}`.

## What it actually costs

A single solve is $0.0008 on CapSolver and $0.001 – $0.003 on 2Captcha.

The portal allows one order per account per 24 hours, and the CAPTCHA is only
needed when a session has expired — so the worker needs a handful of solves a
week, not a stream of them. **A $1 top-up on CapSolver is 1,250 solves**, and
on CapMonster (the cheapest at $0.60 per 1,000) it is about 1,600. A dollar
is months of cover, and there is no need to hunt for a free trial.

## The free options, honestly

- **NopeCHA's keyless free tier** works without an account, but it is tied
  to the calling IP and is rate-limited. From our own address it answered
  `{"error":11,"message":"Rate limit reached"}` straight away, and from a
  cloud IP it would be worse. Fine for occasional use, not for something the
  worker depends on.
- **2Captcha's demo page** lets you try a type in the browser, but it still
  wants your own API key, so it is not a free API.
- **CapMonster** is the cheapest paid option at $0.60 per 1,000 and offers a
  free trial, but it is not wired into the worker.

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
