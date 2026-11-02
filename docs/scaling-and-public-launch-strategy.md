# RuPay Tracker: Scaling & Public Launch Strategy

This document outlines the performance bottlenecks, architectural limitations, and strategic roadmap for transitioning the RuPay Card Benefit Tracking & Automation platform from a private tool into a public-facing multi-tenant SaaS.

---

## 1. Executive Summary & Context

During single-user testing, noticeable latencies were observed across screen transitions, queue queries, and Telegram interactive callbacks. Analysis revealed that these issues were not caused by high query volume or database size, but rather by **architectural anti-patterns and cross-network hops**:

1. **Auth Waterfall**: Sequential HTTPS requests to Supabase Auth (`auth/v1/user`) on every Server Component invocation.
2. **Cross-Continental Routing**: Telegram webhooks and default Vercel serverless functions executed in Frankfurt (`fra1`) while Supabase Postgres was hosted in Mumbai (`bom1`), adding ~160ms latency per query.
3. **Algorithmic N+1 Query Patterns**: Queue eligibility loops executed sequential row queries and concurrent full-table syncs within standard HTTP page loads.
4. **Pool Deadlocks**: Restrictive client-side pooling caps (`max: 2`) starved concurrent `Promise.all` executions.

While the web and database tier can be scaled to thousands of concurrent users using standard caching and stateless authentication patterns, **automated ordering via RuPay's Truztee Portal represents a severe non-linear scaling bottleneck**.

---

## 2. Tier 1: Web Application & Database Scalability

### Architectural Bottlenecks at 1,000+ Users

```
[1,000+ Concurrent Users]
          │
          ▼
   [Vercel Serverless] (Dozens of cold/warm Lambdas)
          │
          ├── 1. Auth Bottleneck ──> Supabase Auth API Rate Limits (~30-50 req/sec)
          ├── 2. DB Pool Choke ────> Supavisor pooler saturation on port 6543
          └── 3. Uncached Reads ───> Repetitive full scans for static catalog data
```

### Necessary Architectural Transitions

| Area | Current Implementation | Target Public Scale Architecture |
| :--- | :--- | :--- |
| **Authentication Verification** | `supabase.auth.getUser()` makes network HTTPS calls to Supabase Auth API per request. | **Stateless Local JWT Verification**: Edge middleware verifies JWT signature against Supabase public keys with zero network hops. |
| **Catalog & Reference Data** | Fresh SQL queries for banks, card types, and benefit definitions on each page visit. | **Edge Read Caching (Redis / Upstash)**: Shared catalog data is immutable per day/month. Cached at edge with 1h–24h TTL. |
| **Queue Computation** | `syncGlobalOrderingQueue()` runs inside HTTP Server Actions and RSC loaders (`/automation`). | **Decoupled Asynchronous Workers**: Web application performs read-only operations. Queue re-computation is delegated to cron jobs or background queue brokers (e.g., BullMQ, Inngest). |
| **Database Pooler Tuning** | Serverless connections connect directly to transaction pooler (`prepare: false`). | Maintain Supavisor transaction pooler; ensure queries are batched and composite indexes are created on `(workspace_id, status)` and `(workspace_id, card_id)`. |

---

## 3. Tier 2: The RuPay Truztee Automation Bottleneck

The primary operational constraint is external: **RuPay's Truztee Portal is a third-party, closed system with anti-bot defenses, human OTP verification, and strict inventory limits.**

```
Quarter Rollover (e.g. Jan 1st, Apr 1st, Jul 1st, Oct 1st)
                         │
                         ▼
   [5,000 Users × 4 Cards = 20,000 Entitled Benefits]
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
     [Voucher Inventory]    [Truztee Portal]
     Depleted in 24-48 hrs   IP blocks, 20-min locks, CAPTCHA escalation
```

### Key Scaling Challenges

#### 1. The Quarter-Rollover Inventory Crunch
- High-value vouchers (BookMyShow, Swiggy, Uber, Amazon) often deplete within **24 to 48 hours** of a new quarter.
- If 2,000 users have 8,000 cards waiting on day 1 of a quarter, all orders must execute within that 48-hour window.

#### 2. Throughput & Browser Automation Math
- Each order requires **60–120 seconds** of browser automation:
  `Login -> Solve CAPTCHA -> Navigate Catalog -> Cart Selection -> Trigger 3DS -> Wait for Human OTP -> Submit OTP -> Confirm`.
- **Sequential Execution**: 8,000 orders × 90 seconds = **720,000 seconds = 200 continuous hours (8.3 days)**. Vouchers will be exhausted before the queue finishes.
- **Parallel Execution**: Running 30–50 concurrent headless browser instances from datacenter IPs (Google Cloud Run / AWS) will trigger:
  - Immediate IP blacklisting by Truztee WAF / Cloudflare Turnstile.
  - Escalated CAPTCHA challenges and session invalidations.
  - Substantial CAPTCHA solver expenses.

#### 3. The 20-Minute Portal Account Lock
- Truztee locks a portal account and benefit type for **20 minutes** upon initiating an order (`POST /api/Select/addUserTransaction`).
- Multiple cards sharing the same portal account cannot be processed in parallel.

#### 4. The Human OTP Bottleneck
- Automation requires the user to forward a 3DS SMS OTP via Telegram/WhatsApp within 60–120 seconds.
- In a mass-scale concurrent run, a high percentage of users will be asleep, busy, or fail to submit OTPs in time, causing aborted transactions, retry backoffs, and queue lockups.

---

## 4. Security, Compliance & Legal Liability

Operating automated ordering for public users introduces legal, compliance, and trust obligations far beyond a personal tracking app:

1. **Card Credentials & PCI-DSS Scoping**:
   - Storing card numbers, expiry dates, and cardholder names server-side introduces compliance scope and significant liability in the event of any data breach.
2. **Account Blocking Liability**:
   - If RuPay or issuing banks flag automated portal accounts for bot activity, affected users may hold the platform responsible for deactivated accounts or lost vouchers.
3. **Zero-Knowledge Architecture Requirement**:
   - For a public launch, server-side master encryption keys must be eliminated. Users must hold their own encryption keys derived from client-side master passwords (as outlined in `docs/zero-knowledge-encryption.md`).

---

## 5. Strategic Phased Roadmap

To achieve public scale sustainably, the service should decouple **benefit intelligence/tracking** from **heavy cloud automation**.

```mermaid
flowchart TD
    subgraph Phase 1: Core SaaS [Phase 1: Public SaaS - Benefit Tracker]
        A["Smart RuPay Benefit Tracker"] --> B["Automated Quota & Expiry Alerts"]
        A --> C["Voucher Valuation & Deal Optimizer"]
        A --> D["Manual 1-Click Deep Links to Portal"]
    end

    subgraph Phase 2: Client-Side [Phase 2: Assisted Client-Side Automation]
        E["Chrome Extension / Desktop Helper"] --> F["Runs Locally on User's Machine & IP"]
        E --> G["Local Auto-Fill & Instant OTP Handling"]
    end

    subgraph Phase 3: Premium Cloud [Phase 3: Managed Cloud Automation]
        H["Dedicated Residential Proxy Pools"] --> I["Strict Rate Limiting & VIP Tiers"]
        H --> J["White-Glove Automated Redemption"]
    end

    Phase 1 --> Phase 2
    Phase 2 --> Phase 3
```

### Phase 1: High-Performance Public Tracker (Zero Automation Risk)
- **Features**: Card tracking, entitlement period calculation, family holder management, voucher vault (encrypted codes), WhatsApp/Telegram expiry notifications, direct deep-links to Truztee redemption pages.
- **Benefits**:
  - Zero risk of IP bans or Truztee dependency.
  - No card PINs or CVVs required.
  - Highly performant: easily scales to 100,000+ users on standard serverless tiers.

### Phase 2: Client-Side Browser Extension
- **Features**: A Chrome/Brave browser extension that performs order automation locally on the user's computer.
- **Benefits**:
  - Runs through the user's personal residential IP, bypassing datacenter bot detection.
  - Captures 3DS OTPs directly from the user’s local browser session without relay delays.
  - Eliminates server-side browser hosting costs (Cloud Run) and CAPTCHA service costs.

### Phase 3: Controlled Managed Automation (VIP / Premium)
- **Features**: Server-side Cloud Run automation limited to power users or paid tiers.
- **Infrastructure Requirements**:
  - Residential proxy rotation (e.g., BrightData, Oxylabs) to prevent IP throttling.
  - Strict global concurrency limits (e.g., max 5–10 concurrent transactions).
  - Paced ordering distributed across the entitlement window.
