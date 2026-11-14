# Master prompt compliance review

Reviewed against the 26-section build prompt ("Annapurna Link — single master build prompt") on the
current branch, after inspecting the repository rather than trusting earlier summaries.

Status vocabulary, used strictly:

- **Done** — implemented, and evidence exists in the repository or in a recorded run.
- **Partial** — the mechanism exists but a required part is missing or unexercised; the specific gap is named.
- **Missing** — nothing implements it yet.
- **Blocked (owner)** — code and configuration are as complete as they can be without a human account,
  secret, purchase or approval.

Nothing below is marked Done because a build passed. A build proves compilation, not that food moved.

---

## Section-by-section

| § | Requirement | Status | Evidence (path) | Gap / next action |
|---|---|---|---|---|
| 1 | No abandoned tasks, no fake features | **Partial** | Pause banners and truthful states throughout (`src/components/app-shell.tsx`, `src/app/api/health/route.ts`); `BUILD_STATUS.md` maintained; sample data now isolated and labelled (`src/domain/demo-workspace.ts`, `/preview`) | No `TODO`/`FIXME` sweep in CI yet; a lint rule or grep gate would make the rule enforceable |
| 2 | Mission, seven roles, multi-org, server-side rules | **Done** | 31 tables in `src/db/schema.ts`; platform roles `operations_admin`, `support_agent`, `safety_officer`, `security_admin`; memberships allow several organisations per user | — |
| 3 | GitHub reality, self-hostable stack, adapters | **Done** | `Dockerfile`, `docker-compose.yml` (db, mailpit, migrate, web, worker), `docker-compose.production.yml`, `infra/caddy/Caddyfile`, `infra/postgres`; Next 16.4.6 / React 19.3.1 / Drizzle 0.45.4 / Better Auth 1.7.21 / Graphile Worker 0.18.0; `.nvmrc` = 22 | `deploy-pages.yml` still publishes the separate static `github-pages/` folder; keep it clearly out of the application path |
| 4 | Visual identity, responsive, states | **Done** | Palette and tokens in `src/app/globals.css`, `DESIGN_SYSTEM.md`, `UI_UX_AUDIT.md`, `UI_UX_TEST_REPORT.md` | Browser-viewport checks could not be re-run here (Chromium download blocked in this sandbox) |
| 5 | Discovery and living documentation | **Done** | `README.md`, `BASELINE_AUDIT.md`, `BUILD_STATUS.md`, `DATABASE.md`, `DESIGN_SYSTEM.md`, `LAUNCH_CHECKLIST.md`, `HOSTED_DEPLOYMENT.md`, `AUTHENTICATION_IMPLEMENTATION_REPORT.md`, `DECISIONS/ADR-0001`, `ADR-0002`, plus new: `ARCHITECTURE.md`, `SECURITY_THREAT_MODEL.md`, `PRIVACY_DATA_MAP.md`, `OPERATING_MODEL.md`, `FOOD_SAFETY_CONTROLS.md`, `LEGAL_RESEARCH_REGISTER.md`, `TEST_PLAN.md`, `OPERATIONS_RUNBOOK.md`, `INCIDENT_RESPONSE.md`, `PARTNER_ONBOARDING.md`, `PRODUCT_REQUIREMENTS.md` | `LEGAL_RESEARCH_REGISTER.md` and `FOOD_SAFETY_CONTROLS.md` are explicitly unverified drafts awaiting qualified review; that is an owner action, not a missing document |
| 6 | Authentication lifecycle | **Done** (delivery **Blocked (owner)**) | `src/lib/auth.ts` — `requireEmailVerification`, `sendVerificationEmail`, `sendResetPassword` via the outbox; `scripts/bootstrap-admin.ts`; `AUTHENTICATION_IMPLEMENTATION_REPORT.md` | Verification and reset mail cannot reach a real inbox without owner SMTP credentials; the capture transport (`smtp.ethereal.email`) accepts but does not deliver |
| 7 | Domain model, migrations, constraints, RLS | **Partial** | 31 tables, 13 checked-in migrations, 24 tables with RLS and 70 policies, append-only `audit_events`/`custody_events`, unique active-assignment and single-receipt constraints | No `FORCE ROW LEVEL SECURITY`; no separate `donation_items` (one item per listing); no `food_categories` table (categories are strings constrained by the policy JSON); no recall record table |
| 8 | Generator experience | **Done** | `/app/listings`, `/app/listings/new`, `/app/listings/[id]`, `components/listing-form.tsx`, `createDonation` in `src/domain/service.ts` | — |
| 9 | Receiver experience | **Done** | `/app/offers`, `/app/offers/[id]`, `components/offer-actions.tsx`, capacity columns on `organizations` | Capacity is declared per organisation, not per receiving window |
| 10 | Helper experience and atomic claim | **Done** | `/api/jobs/[id]/claim`, `/app/deliveries`, `tests/integration/local-domain.ts` (concurrent claim) | — |
| 11 | Matching, reservation, lifecycle | **Partial** | Donation status enum covers draft→delivered plus expired/cancelled/refused/on_hold/recalled; `activePolicy()` enforces the approved policy; worker expires overdue records | Matching is offer-based and largely manual; there is no explainable candidate-scoring engine with an "why ineligible" view |
| 12 | OTP, custody, receipts, idempotency | **Done** | `delivery_codes` (hashed + encrypted), `/api/jobs/[id]/code` (Receiver only), `/api/jobs/[id]/verify`, unique receipt constraint, attempt limit | — |
| 13 | Safety, incidents, refusals, recalls | **Partial** | `food_safety_incidents`, `/api/jobs/[id]/incident`, `/api/admin/incidents`, `on_hold`/`recalled` statuses, refusal paths | Recall is now a first-class record (`recall_records`, migration 13) with reason, author, previous status, affected receipt snapshot and closure note. Remaining: quarantine workflow with evidence attachments |
| 14 | Outbox, notifications, worker | **Done** | `email_outbox`, `src/worker/outbox-drain.ts`, `/api/worker/drain` with GitHub OIDC, in-app `notifications`, `/app/notifications` | No notification preferences table; real-time is polling, not SSE |
| 15 | Admin, support, compliance consoles | **Partial** | `/admin` plus `/api/admin/{organizations,helpers,incidents,policies,service-areas,overview}`; support queue; reason + audit on decisions | Recall register added to the console (issue, list, close, with reasons). Remaining: no audit-log viewer, no dual approval for high-risk changes |
| 16 | India legal, privacy, data rights | **Partial** | `/privacy` and `/terms` marked draft; `data_requests` + `/api/data-requests`; `PRIVACY_*` gaps in `LAUNCH_CHECKLIST.md` | `LEGAL_RESEARCH_REGISTER.md` missing; no retention/anonymisation job; account erasure is not possible under the append-only guard (documented gap) |
| 17 | Security engineering | **Partial** | RLS via `withUserContext` (`src/db/index.ts`), least-privilege DB roles, `api_rate_limits`, origin allowlist (`src/lib/http.ts`), hardened responses via `next.config.ts` `headers()` (added this branch), Caddy headers | CSP is report-only (no nonce pipeline yet); no automated dependency/secret scanning steps in CI beyond `npm audit`; no external penetration test |
| 18 | Analytics and impact | **Done** | `public.app_public_impact()` (migration `20261112165901`), `/api/public/impact`, `src/components/public-impact.tsx`, contract tests | — |
| 19 | Testing incl. real PostgreSQL and E2E | **Partial** | 146 unit/integration tests over 19 files (PGlite migrations, RLS, concurrency, crypto, rate limits); Playwright specs in `tests/e2e/`; `scripts/test-local-auth.mjs`, `test-auth-security.mjs`, `test-auth-roles.mjs`, `run-local-workflow.mjs` | Playwright could not run in this sandbox (browser download blocked); the last green browser run is recorded in `BUILD_STATUS.md` |
| 20 | CI/CD, Docker, deployment | **Partial** | `.github/workflows/ci.yml` (typecheck, lint, tests, config preflight, audit, build), `deploy-pages.yml`, `worker-drain.yml`; compose stack; `HOSTED_DEPLOYMENT.md` | No image build/publish or controlled production deploy workflow; no automated backup job; hosted deployment is Vercel, not the Docker topology |
| 21 | Observability, backup, incident response | **Partial** | `/api/health` (status, database, email), structured logs, `scripts/test-local-backup.mjs` | Worker heartbeat now written by the worker and reported by `/api/health` as ok/stale/never_seen with an age. Remaining: no queue-depth metric, failed-send counts only in the admin overview, restore still scripted but not exercised here |
| 22 | Public and application routes | **Partial** | 34 pages implemented, including `/verify-email`, `/forgot-password`, `/reset-password`, `/app/*`, `/admin`, `/preview` (new, public) | `/app/profile` added: password change, session list and revocation, access summary. Remaining: organisation switcher UI, `/app/receipts` index |
| 23 | Execution order / release slice | **Done** | The end-to-end slice exists as code and as the local workflow script | It has never run against real partners; see the gates in `LAUNCH_CHECKLIST.md` |
| 24 | Completion definition and final report | **Partial** | This document plus `BUILD_STATUS.md` | The final report must be regenerated per release, not written once |
| 25 | Human approval gates | **Done** (as policy) | `LAUNCH_CHECKLIST.md`, `src/lib/production-config.ts` warnings, `OPERATIONS_ENABLED` gating | Approvals themselves are owner actions; none are recorded |
| 26 | Final directive | — | — | — |

---

## What this branch changed

1. **Sign-in is now optional for reading.** A public walkthrough at `/preview` renders the whole
   handover — listing, offer with partial acceptance, dispatch conflict, custody timeline, the
   single-use code's *shape only*, receipt, and clearly-labelled sample totals — from
   `src/domain/demo-workspace.ts`. The page is a statically rendered server component: no database,
   no request, no JavaScript needed, `noindex, follow`.
2. **The sample cannot pass as real data.** Every organisation, person and reference is fictional,
   contacts use the reserved `example.org` domain, and no code value exists anywhere in the fixture.
   `demoWorkspaceProblems()` re-checks the same invariants production records rely on (quantity
   ordering, one winning Helper, ordered custody events, unique references, no code material), and
   `tests/demo-workspace.test.ts` holds the fixture to them.
3. **Entry points.** Header (`Preview`), mobile menu, footer and the landing hero each link to the
   walkthrough; the sign-in page states plainly that signing in is optional for reading and required
   only for acting.
4. **Security headers moved into the application.** They previously existed only in
   `infra/caddy/Caddyfile`, so the hosted deployment served responses without them. `next.config.ts`
   now sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
   `Cross-Origin-Opener-Policy`, a report-only CSP, and `no-store` on `/api/auth/*` (which can carry
   a one-time credential in the URL). `tests/security-headers.test.ts` asserts all of it, including
   that the public impact endpoint keeps its own cache policy.

Verified in this sandbox: `tsc --noEmit`, `eslint .`, `vitest run` (19 files / 146 tests), `next build`
(`/preview` prerendered as static), and an HTTP fetch of `/preview` returning 200 with the sample
notice and `noindex`.

## Second batch — 2026-11-14

1. **Worker heartbeat.** The worker writes `service_health` on start, on every drain, every 30 seconds
   and on shutdown; `/api/health` reports `ok` / `stale` / `never_seen` with an age and the last error.
   A dead worker is now visible instead of a queue quietly filling.
2. **Recall records.** `recall_records` (migration 13) makes a recall evidence rather than a flag:
   one open recall per donation, previous status and affected receipt count snapshotted at issue time,
   author and closure note, RLS limited to operations/safety for writes and to visible participants for
   reads, no delete policy or grant. `recallDonation`, `listRecalls` and `closeRecall` stop the
   donation, append a custody event, notify Generator/Receiver/Helpers and audit the decision, and the
   operations console gained a recall register with a donation picker.
3. **Account security.** `/app/profile` changes a password (current password required, optional
   sign-out of other sessions) and lists or revokes sessions. Session tokens stay on the server; the
   browser only ever receives session ids, a coarse device summary and a masked network.
4. **Eleven documents** written: architecture, threat model, data map, operating model, food-safety
   controls, legal register, test plan, runbook, incident response, partner onboarding, requirements.
   The safety and legal ones are explicitly unverified drafts awaiting a qualified reviewer.
5. **Tests:** 168 across 21 files, including catalogue assertions that the recall table is RLS
   protected with three policies and no delete grant, that the worker may write the heartbeat while
   the app role may only read it, and that the new validation schemas reject smuggled ids.

---

## The next five things, in order

1. ~~The missing documents~~ — written: `ARCHITECTURE.md`, `SECURITY_THREAT_MODEL.md`,
   `PRIVACY_DATA_MAP.md`, `OPERATING_MODEL.md`, `FOOD_SAFETY_CONTROLS.md`,
   `LEGAL_RESEARCH_REGISTER.md`, `TEST_PLAN.md`, `OPERATIONS_RUNBOOK.md`, `INCIDENT_RESPONSE.md`,
   `PARTNER_ONBOARDING.md`, `PRODUCT_REQUIREMENTS.md`. The two safety/legal documents are drafts that
   need a qualified reviewer, which is an owner action.
2. ~~Worker heartbeat~~ — done: the worker writes `service_health` and `/api/health` reports
   ok/stale/never_seen. Next: queue-depth and failed-send metrics, and an alerting threshold.
3. ~~Account and session screens~~ — done: `/app/profile` changes a password and revokes sessions
   without exposing tokens. Next: an organisation switcher and a `/app/receipts` index.
4. ~~Recall records~~ — done: `recall_records` with reasons, author, affected receipts and closure.
   Next: a quarantine workflow with evidence attachments.
5. **Still open, in this order:** account erasure/anonymisation (the append-only guard blocks it),
   retention automation, `FORCE ROW LEVEL SECURITY`, a nonce-based CSP, browser evidence from a
   machine that can install Chromium, and a real restore drill.

The three owner actions that gate real operations are unchanged and are recorded in
`HOSTED_DEPLOYMENT.md` and `LAUNCH_CHECKLIST.md`: owner registration (so a password exists), real SMTP
credentials, and approval of the `0.1.0-iim-calcutta` policy before `OPERATIONS_ENABLED` is switched on.
