# Build status

- **Updated:** 2026-11-12
- **Branch:** `arena/d3d3055c-aanapurna` (active)

## Current status

**The UI refresh and the local checks below are verified within their documented scope. The repository is not cleared for staging, a pilot, or production.** `OPERATIONS_ENABLED` remains `false`. Verification used an isolated local database and loopback SMTP sink; no production database, external mail account, or live operational service was configured or changed.

## Completed in the repository

- Refreshed the public landing page, role-specific entry points, responsive navigation, accessibility page, authentication screens, role-aware workspace, and loading/empty/error/retry states.
- Added a backend-derived public impact endpoint and UI contract. It reports the honest empty state when no qualifying verified records exist; no meals or impact are fabricated.
- Added `/near-iim-calcutta` and the validated server-side IndiaRestros directory proxy, attribution, retry/error states, and clearly dated fallback record. Halla Bowl is a public directory listing only—not an Annapurna Link partner, approved food source, or offer. The provider's data-use terms still need confirmation before expansion.
- Added `DECISIONS/ADR-0001-public-restaurant-discovery.md` describing provider choice, attribution, safeguards and the remaining terms caveat.
- Added Docker/Compose build files, local environment-generation files and operational documentation. Compose execution remains pending on a Docker-capable host.
- Fixed Better Auth's `rate_limit.id` mismatch: Better Auth emits string IDs, so the schema now uses `text`; migration `drizzle/20261112164011_better_auth_rate_limit_text_id.sql` applies the change.
- Updated migration/database checks and local Drizzle/Graphile Worker setup to use separate database URLs and least-privilege roles.
- Added an opt-in local SMTP sink bound only to `127.0.0.1` to make signup/email-verification integration repeatable without an external mail service. It does not log message contents and writes its inbox with owner-only permissions.

## Checks most recently run

- `npm test` — **PASS, 41 tests across seven files**, including synthetic non-empty impact aggregation, active/pending role-navigation policy, migration/security checks and origin-protection cases.
- Full Playwright browser suite — **PASS, 13 tests** with real empty-impact and isolated auth checks enabled. A route-wide public/auth accessibility and overflow test covers 14 routes at 320px and 1440px.
- Auth integration verified local signup, actual email verification, login, a pending Helper request, ordinary-user denial from the admin API, and redirect from the operations route. No account was approved and no operational action was run.
- Axe scans — **PASS for selected WCAG 2.0/2.1 A/AA and 2.2 AA rules** across 14 public/auth routes at 320px and 1440px, plus focused homepage/signup/login states. Automated checks do not replace manual review or establish conformance.
- Responsive checks — **PASS across those 14 public/auth routes at 320px and 1440px**, and on the homepage at 320, 390, 760, 1024 and 1440px. Protected workspace screens were not included.
- `npm run typecheck`, `npm run lint`, and `npm run build` — **PASS**.
- `npm audit --audit-level=moderate` and `npm audit --omit=dev --audit-level=moderate` — **PASS, zero vulnerabilities**.
- Isolated local `npm run db:migrate` and `npm run db:check` — **PASS**: eight migrations, 22 RLS tables, nine required functions, no problems.
- Actual local `/api/public/impact` — **HTTP 200**, `status: "empty"`, all five backend metrics zero. A separate PGlite migration test verifies positive synthetic fixture aggregation and keeps recorded units distinct; it does not turn fixtures into public data. `/api/health` — **HTTP 200**, database healthy, `realOperationsEnabled: false`. After integration testing the real local database is empty: users, organizations, donations and delivery receipts are all zero.
- `git diff --check` — **PASS**.

## Remaining unverified or blocked

- Active/authorized Generator, Receiver, approved Helper and platform-staff workflows; privileged mutations and real operational records — **not tested**. Active/pending role navigation is covered by unit tests, and the local auth test verifies denial for a pending non-platform account. Non-empty aggregation is tested only with synthetic PGlite fixtures; no non-empty real-PostgreSQL data or public metric is claimed.
- Docker image build and Compose startup — **not run; Docker Engine/Compose is unavailable in this sandbox**.
- External/production SMTP delivery, password-reset delivery, production worker recovery/retries, admin bootstrap, private-upload malware scanning, production backups/restore and deployment configuration — **not verified**.
- Public API dataset terms and long-term reuse rights are not fully established; the page displays one attributed listing only.
- Human approvals for launch geography, policy, legal applicability, privacy/retention, partner consent and security remain pending. No partnership or launch approval is implied by the directory listing or these local checks.

## Next concrete actions

1. In a controlled, isolated staging setup, validate database roles/migrations and worker/email/reset behavior; test role-specific flows with authorized synthetic fixtures and keep `OPERATIONS_ENABLED=false`.
2. Verify Docker/Compose, upload scanning, backup/restore and external services on a supported host.
3. Complete the manual protected-workspace and accessibility reviews, then obtain required human policy/legal/privacy/security and partner approvals before any pilot. Keep `OPERATIONS_ENABLED=false` until those approvals and operational checks are recorded.
