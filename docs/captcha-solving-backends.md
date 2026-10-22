# Captcha solving backends

The worker does **not** solve CAPTCHAs itself. All reCAPTCHA solving is
delegated to the external **ReCaptcha Solver service** — a separate Cloud Run
service in the same GCP project. The worker sends the portal's login page URL
to the service and receives a verified token back; it never holds a solver API
key or attempts a solve locally.

This note describes the backends the **service** can use, for operators who
maintain the service:

| Backend | How it works | Cost | State today |
|---|---|---|---|
| **AZCaptcha** | Third-party API. The service sends the sitekey and page URL, gets back a token. | $1.00 per 1,000 tokens; the grid is $0.10 per 1,000 | $0.10 of free credit once the email is verified, no card needed |
| **CapSolver** | Third-party API. Same shape as AZCaptcha. | $0.80 per 1,000 solves | The secret exists but **the key is dead** (`ERROR_KEY_DENIED_ACCESS`) |
| **2Captcha** | Third-party API, same shape. | $1 – $2.99 per 1,000 | Not configured. The code is there. |
| **NopeCHA** | Third-party API. The key is **optional** — without one it uses a free tier tied to the calling IP. | Roughly $0.011 – $0.083 per 1,000 | Not configured. The code is there. |
| **Local vision (ia-solver)** | The service runs a YOLO classifier over the image challenge grid in-browser. | One compute instance, always on | Implemented and available. Works best with a warm browser profile. |
| **In-browser audio + Gemini** | The service clicks the audio challenge, transcribes it with Gemini, types the answer back. | One Gemini call per solve, no per-solve fee | Implemented, but **Google blocks the audio challenge from cloud IP addresses** — it returns "Your computer or network may be sending automated queries" instead of the clip |
| **YesCaptcha** | Third-party API. Same shape as AZCaptcha. | ¥0.015 per token | Available; 1,500 free points on signup. |

The order they are tried in is set by `CAPTCHA_PROVIDER` on the service, and
**only the named backend is called**. The default is `yescaptcha`.

A backend that rejects its key is disabled for the rest of the run rather
than retried, so one dead key does not cost a minute per solve.

## Switching the service's backend

No worker code change is needed. Set the `DEFAULT_SOLVER_PROVIDER` environment
variable on the ReCaptcha Solver Cloud Run service:

```bash
# In recaptcha-solver/infra/config.env:
DEFAULT_SOLVER_PROVIDER=yescaptcha   # or: ia-solver, capsolver, etc.
```

The service's `/v1/health` endpoint reports the active default provider.