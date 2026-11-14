# Architecture

Annapurna Link is a modular monolith: one Next.js application, one PostgreSQL database, one
background worker process, three adapters (email, storage, maps) behind interfaces. There is no
microservice and no second source of truth.

Current as of commit `52e71ec` on branch `arena/5b937561-aanapurna`.

## Components

| Component | Where | Responsibility |
|---|---|---|
| Web application | `src/app` (Next.js 16.4.6 App Router, React 19.3.1, TypeScript strict) | Server-rendered pages, route handlers, server-side session checks. No privileged database call is exported to the browser. |
| Domain services | `src/domain/service.ts`, `src/domain/validation.ts` | Every state transition, policy check, authorisation decision and audit write. Zod schemas validate all input. |
| Database access | `src/db/index.ts`, `src/db/schema.ts`, `drizzle/*.sql` | 31 tables, 13 checked-in migrations, Drizzle ORM. Three pools: `annapurna_app` (runtime), `annapurna_auth` (Better Auth), `annapurna_worker` (queue + outbox). Migrations run as a fourth, separate role. |
| Identity | `src/lib/auth.ts`, `src/lib/identity.ts` | Better Auth 1.7.21: email/password, verification, reset, database-backed rate limits, HTTP-only session cookies. `getIdentity()` returns the server-side role and membership picture, never a browser-supplied one. |
| Background worker | `src/worker` | Graphile Worker 0.18.0 on PostgreSQL. Cron `drain-email-outbox` every minute, heartbeat every 30 seconds, graceful shutdown on SIGTERM/SIGINT. |
| Outbox | `src/worker/outbox-drain.ts`, `/api/worker/drain` | Transactional email outbox with bounded retries. The same drain code runs as a long-lived worker or as a short-lived authenticated scheduler call (GitHub OIDC). |
| Private storage | `src/app/api/documents/[id]`, `PRIVATE_STORAGE_DIR` | Verification documents outside the public web root, served only through an authorised handler. Adapter exists so an S3-compatible store can be added without touching business logic. |
| Reverse proxy | `infra/caddy/Caddyfile` | TLS, request limits, hardening headers for the Docker topology. The same headers are now also emitted by the application (`next.config.ts`), so the Vercel deployment is not the weaker path. |
| CI | `.github/workflows/ci.yml` | Typecheck, lint, 168 tests, production-config preflight, Playwright, dependency audit, production build, plus native PostgreSQL, Compose and Windows smoke jobs. |

## Trust boundaries

1. **Browser → web application.** Untrusted. Every request is re-authenticated server-side; `Origin`
   is checked on mutations (`assertSameOrigin`); rate limits are enforced per user and per IP
   (`api_rate_limits`).
2. **Web application → PostgreSQL.** The runtime role is not the table owner, has no `BYPASSRLS`, and
   reaches tenant data only inside `withUserContext(userId, …)`, which opens a transaction, sets
   `app.user_id`, and lets 70 row-level-security policies decide what exists for that caller.
3. **Worker → PostgreSQL.** A separate role that can write the queue, the outbox and its own
   heartbeat, and nothing in the food or personal data tables.
4. **Application → SMTP provider.** The only outbound network dependency in the core flow. Failures
   are recorded in the outbox rather than reported as delivered.
5. **Application → private storage.** Local private directory today; the interface is the boundary,
   not the filesystem.

## The delivery path

```
Generator creates listing         → donations (offered) + custody event + policy version snapshot
Receiver accepts (partial ok)    → donation_offers (accepted) + job (open)
Helper claims                    → delivery_jobs (assigned) via one conditional UPDATE
Helper collects                  → delivery_jobs (collected) + custody event + inspection record
Helper records arrival           → delivery_jobs (arrived); the code becomes visible to the Receiver
Receiver shares 6-digit code     → app_consume_delivery_code() verifies hash, consumes, 5-attempt lock
Helper submits code              → delivery_jobs (delivered) + exactly one delivery_receipts row
                                 → custody event + outbox notifications + impact aggregate
```

Each step is one transaction. Partial failure leaves the previous state, not a half-written one:
the code consumption, job state, receipt insert and notification enqueue commit together or not at
all. Expiry is enforced twice — by the worker, and independently inside the acceptance and
claim functions — so a stale page or a stopped worker cannot resurrect an expired listing.

## Recall path

`recallDonation()` takes a row lock on the donation, refuses a second open recall, snapshots the
previous status and the number of receipts already issued, sets `donations.status = 'recalled'`,
writes a `recall_records` row, appends a custody event, notifies the Generator, the Receiver and any
assigned Helper, and audits the decision. Closing a recall records who closed it and why; the
donation stays recalled.

## Data flows that leave the system

- Email through the configured SMTP provider (verification, reset, operational notices).
- Outbound links to OpenStreetMap for directions. No paid maps API, no geocoding of addresses.
- Nothing else. There is no analytics vendor, no third-party script, no error-reporting SaaS.

## Deliberate constraints

- **Matching is rule-based.** `app_find_receiver_candidates()` filters on verification, service
  area, category and capacity. No model decides whether food is safe.
- **No AI safety decisions.** Image or text assist, if ever added, must be advisory and reviewed by
  a qualified human.
- **UTC storage, Asia/Kolkata display.** Every timestamp is `timestamptz`; the service area's
  timezone drives display.
- **Impact is derived, not accumulated.** `app_public_impact()` counts verified receipts only.

## Known architectural gaps

- RLS is enabled on 24 tables but not `FORCE`d. The runtime role is not the owner, so policies do
  apply; `FORCE` would additionally protect against a future grant mistake.
- CSP is report-only: the application has no nonce pipeline yet, so enforcing it today would break
  Next.js inline bootstrap scripts.
- The Vercel-hosted deployment runs the web tier only. The worker is a separate process and must be
  hosted where long-lived processes are allowed (Docker topology).
- Account erasure is not possible under the append-only audit guard. A documented anonymisation
  path is required before real personal data is processed.
