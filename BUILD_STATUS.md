# Build status

## Recovery, Windows and CI follow-up — 2026-11-13

- Added a guarded disposable PostgreSQL custom-format `pg_dump`/`pg_restore` drill. A real PostgreSQL 14.24 run with fictional domain fixtures passed: restored donation, receipt, inspection and migration counts, selected RLS/grants, and worker schema ownership. A separate run proved an existing restore target is refused and preserved. This is not a production backup, upload recovery, off-host encryption, point-in-time recovery or a complete restore verification. PostgreSQL 16 execution is now defined in CI but has not yet been observed.
- Added a Windows 2025 GitHub-hosted native PostgreSQL/start.bat/authentication smoke job, and a no-email-sent, explicit authenticated TLS SMTP connection probe (`npm run smtp:verify`) for a human operator's own provider. Neither Windows nor a real SMTP provider has been tested here; verification requires actual infrastructure and credentials, and successful connectivity alone is not delivery validation.
- The sandbox cannot reach Docker's binary download or container registry, and Docker Engine is absent. Compose and GitHub-hosted jobs remain unverified until the branch is run on GitHub. Human safety/legal/partner approvals and real production backup, mail delivery and deployment remain mandatory; no authorization is implied and operations remain disabled.

---

## Arrival, inspection and browser workflow — 2026-11-13

**Not approved for pilot or production.** Real operations remain disabled; test-only fixtures and approvals are fictional. This section supersedes older observations and outstanding items below, which are retained as historical context.

- Added assigned-Helper arrival and receiving-organisation inspection/acceptance with observations, role/ordering checks, immutable fields and auditable events. The Receiver may reveal the one-time code only after both declarations; the assigned Helper may verify it only then. These are declarations, not independent certification or proof of food safety. Migration `20261113074000_arrival_inspection_gate.sql` adds constraints, triggers and code-access checks. Existing completed historical records are not retroactively certified or changed.
- PostgreSQL 18 disposable integration: PASS after migration, including wrong-role/order attempts, direct pre-inspection code-consumption denial, inspection retry/conflict handling, consumed-code RLS privacy, wrong-code lock and replay denial. The runtime-role check passed with ten migrations, 22 RLS tables and nine expected functions. An initial bare `npm run db:check` failed because shell environment variables had not been loaded; rerunning with `node --env-file=.env --import tsx scripts/check-db.ts` passed, and the native README instructions were corrected. This is not an exhaustive security audit.
- Authenticated Chromium browser workflow: PASS on a fresh disposable local database: real fictional fixture sign-ins, listing and Receiver acceptance, competing Helper claims, collection, arrival, Receiver inspection, wrong-code feedback, OTP completion, Generator/Receiver/admin receipt and verified impact. The test seeds synthetic approvals, does not exercise live email or real approvals, and does not test every role/route/failure. An initial failure was a test selector collision with Next's route announcer, then corrected. The Next dev server emitted intermittent `destination stream errored while writing data` and smooth-scroll warnings despite the passing run; investigate them in the target environment. Playwright traces/screenshots/video were off, but failure diagnostics may still contain page content; test artifacts are private and should be deleted.
- Public browser suite: 11 PASS, 2 deliberately skipped opt-in tests. The separate real signup/verification/Helper-request browser test also passed in the earlier run; that earlier run had six other browser failures when using the unstable `--single-process` argument. The ordinary browser download failed (`ECONNRESET`); an independently installed npm-distributed Chromium was used without that argument. This workaround is not added as a project dependency and is not equivalent to the pinned Playwright browser.
- Latest `npm run lint`, `npm run typecheck`, `npm test -- --reporter=dot` (48 tests), `npm run build`, `npm audit --audit-level=moderate` (zero reported vulnerabilities) and `git diff --check` — PASS.
- Added CI definitions for the guarded browser workflow and Docker Compose build/health smoke. These jobs have **not** run on GitHub in this session. Docker Engine/Compose and Mailpit were unavailable here; `apt` could not access Debian mirrors, so no Docker runtime validation is claimed. Windows, external SMTP, backups/restores and public deployment remain untested.
- See `LAUNCH_CHECKLIST.md` for human decisions and remaining safety, security and operational gates. Keep `OPERATIONS_ENABLED=false` outside explicitly isolated tests. Do not claim a complete pilot or launch until those gates are actually met.

---

## Domain integration follow-up — 2026-11-13

**Still not pilot- or production-approved.** No real operations were enabled. The test below temporarily sets the operations flag only inside its test process against a dedicated empty local `annapurna_link_test` database; its organisations, policy, approvals and people are fictional. `.env` and deployed configuration remain unchanged. The test creates identities directly as fixtures, calls domain services with explicit identities, and executes database access using the restricted application role; it is not an authenticated HTTP or browser end-to-end test.

### Changes

- Fixed Helper review's row lock so it locks the helper row rather than requiring update access to another user's joined profile.
- Fixed RLS/`INSERT ... RETURNING` interactions that prevented creation of donations and delivery jobs; generated identifiers are used before insert. Reordered offer acceptance within its transaction so the Receiver gains authorized access to the pickup record before the handover checks.
- Added migration `drizzle/20261113073000_fix_donation_helper_rls.sql` to fix an incorrectly scoped donation ID in the Helper update policy. `scripts/check-db.ts` now requires nine migrations.
- Fixed a deadlock between two competing Receiver reservations by locking the donation before either offer; added a server-side check preventing pickup before the agreed window opens.
- Added a guarded `npm run test:local-domain` service-level real-PostgreSQL integration test and wired it into the defined CI job. The test requires a completely empty, locally hosted `annapurna_link_test` database, refuses production or enabled operations in its environment, and leaves fictional records in the throwaway database. README documents setup.

### Evidence in this environment

- `npm run local:migrate` and restricted role database check — PASS on isolated PostgreSQL 18; nine migrations, 22 RLS-enabled tables and nine expected functions. A second test invocation against the populated database was safely refused.
- `RUN_LOCAL_DOMAIN_TEST=true npm run test:local-domain` — PASS on an empty disposable test database. It covered synthetic onboarding and administrator review, two-person test policy approval, paused operation and input/policy rejection, matching, two Receiver reservation attempts (one successful), two Helper claims (one successful), early-pickup rejection, code visibility under the restricted app role, wrong code, five-attempt lock, concurrent code verification (one receipt), replay denial, three in-app completion notifications, verified impact and safety hold. The test checks OTP absence in audited details/notification text for that run; it is not a comprehensive log or privacy audit.
- Local signup/verification/login/logout/reset smoke test — PASS again with the worker and loopback test sink against the isolated database. This is separate from the domain test and did not use Mailpit.
- `npm run lint`, `npm run typecheck`, `npm test -- --reporter=dot` — PASS (47 unit/migration tests); `npm run build` — PASS; `npm audit --audit-level=moderate` — PASS (zero vulnerabilities); `git diff --check` — PASS.
- Not run here: Docker/Compose, Mailpit, Windows launcher, the GitHub-hosted CI job, browser/Playwright tests (browser download is blocked by the sandbox network), and production SMTP/deployment/restore. PostgreSQL 17 CI is configured, not observed. Earlier failed integration runs exposed bugs and were corrected; this is not a full load or race audit.

### Next work / safety gates

Historical note: at that point the delivery code was shown after pickup without a recorded arrival/inspection. See the newer section above for the subsequent implementation; a complete audited exception flow and wider tests are still needed before pilot. Other remaining requirements include authenticated browser-to-receipt testing, expiry/worker recovery and SMTP retry coverage, exhaustive RLS/OTP/access tests, complete recall/refusal/exception workflows and outbox coverage, secure uploads, runbooks/legal/privacy documentation, backup/restore and independent security and qualified food-safety/legal reviews. Human approval for geography, partners, operating policy and launch is still required. Keep `OPERATIONS_ENABLED=false` outside isolated tests.

---


## Current follow-up — 2026-11-13

Branch `arena/08bf8cef-aanapurna`, base `bafc7a76dc50a3b350ab44df0a7df4d1ed92283`. This is **local-development work, not a finished or approved pilot/production platform**. `OPERATIONS_ENABLED=false` is retained. The historical status below describes prior work and its environment, not newly repeated results.

### Implemented in this follow-up

- Added an optional Docker-free native development path using a separately installed real PostgreSQL server, a locally bootstrapped database and least-privilege app/auth/worker roles, checked-in migrations, worker and explicitly test-only private SMTP inbox. `start.bat` now launches the native path after its documented one-time setup. Existing Docker setup remains available; its runtime image now includes the `public` directory.
- Disabled the Better Auth session cookie cache after a real local test showed that a copied logged-out cookie remained valid during the 60-second cache period. A fresh test now checks immediate logout replay denial, as well as verification/reset delivery and reset replay denial.
- Added native setup safety tests, real-PostgreSQL/auth smoke script, CI job definition for PostgreSQL 17, `DATABASE.md`, and `DECISIONS/ADR-0002-native-development.md`. Reviewed the two supplied repositories: they are a catalog and coding guidelines, not the application or a database. Updated `BASELINE_AUDIT.md`.

### Observed checks

- `npm ci` — PASS; npm reported deprecated eslint and esbuild-kit packages; no audit vulnerabilities at install.
- Native database setup and `npm run local:migrate` — PASS using an isolated temporary PostgreSQL 18 instance installed separately outside this repository. Re-running setup refused to overwrite existing roles/data. Runtime role check: eight applied migrations, 22 RLS-enabled tables, nine expected functions, no reported problems. This does not establish full RLS isolation or validate PostgreSQL 17/Compose.
- `npm run local:start` — PASS on this Linux sandbox: worker and loopback SMTP sink started, `/` and `/api/health` returned HTTP 200, real operations disabled. Windows launcher not executed here.
- `RUN_LOCAL_AUTH_TEST=true npm run test:local-auth` — PASS with fictional local data: signup, rejection before verification, actual local verification email, login, admin API denial, logout and old-cookie replay denial, reset email, reset token replay denial, old-password denial, new-password login. Local sink is not Mailpit or a production SMTP provider. One earlier repeated run hit the local auth rate limit; retry after the window passed succeeded. Production session revocation has not been independently reviewed.
- `npm run lint`, `npm run typecheck`, `npm test -- --reporter=dot` — PASS (47 tests across eight files); `npm audit --audit-level=moderate` — PASS, zero reported vulnerabilities. `npm run build` — PASS. Initial new test type errors were corrected before these results.
- Browser/Playwright tests — NOT RUN this follow-up: Chromium is not installed and download from `cdn.playwright.dev` failed due to the environment's network restrictions. No current browser or accessibility result is claimed.
- Docker/Compose/image, the new GitHub Actions job, Mailpit and Windows native setup — NOT RUN in this environment. Docker is absent. The CI job must run on GitHub to be verified.

### Remaining work and gates

Complete and verify the requested end-to-end donation/offer/concurrent assignment/pickup/OTP/receipt flow with real PostgreSQL and separate authorized identities, tenant/RLS and OTP security tests, worker failure/recovery, safety/recall and all privileged workflows. The existing implementation is not proof of completion. Also complete missing requested documentation, legal/food-safety/privacy review, real SMTP, storage scanning, backup/restore testing, production hardening and human launch approvals. No real donations, partner onboarding or public deployment are authorized. Continue from these items without treating the current smoke test as production validation.

---


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
