# UI/UX test report

- **Status:** The requested interface refresh is implemented and the checks listed below pass within their stated scope. Synthetic non-empty aggregation is tested in PGlite, but no non-empty real-data metric is claimed; some authorized operational workflows remain untested. This is not a launch or accessibility-conformance approval.
- **Date:** 2026-11-12
- **Branch:** `arena/d3d3055c-aanapurna` (active)

## Environment and safety boundaries

- `OPERATIONS_ENABLED=false` throughout. The local auth test account never received approval, and no real donation, delivery, policy decision or partner decision was performed. Positive impact rows exist only as deterministic fixtures in the disposable PGlite migration test.
- Verification used a separate local PostgreSQL database, `annapurna_uiux_20261112`, with the project migrations and database configuration check. No production database or external mail service was used.
- The local authenticated browser test used a random `example.test` account, an isolated loopback-only SMTP sink, and the local worker. The verification email was cleared after the run; the disposable database was reset and migrated again. Current user, organization, donation and receipt row counts are all zero.
- Temporary Chromium was used for Playwright. Trace capture is disabled for the opt-in auth test, and Next.js dev request logging ignores Better Auth action URLs that may contain one-time credentials. The local sink does not log message contents. No test screenshots or mail content are retained in the repository.

## Checks run

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Unit, migration and security tests (`npm test`) | **PASS — 41 tests, 7 files** | Includes a PGlite synthetic verified-impact aggregate fixture, active/pending role-navigation policy, impact contracts/routes/migrations, and six origin-protection cases including the strict same-origin Referer fallback. |
| Typecheck (`npm run typecheck`) | **PASS** | `tsc --noEmit`. |
| Lint (`npm run lint`) | **PASS** | Includes the local-only SMTP integration fixture. |
| Dependency audits (`npm audit --audit-level=moderate`; production-only audit) | **PASS — 0 vulnerabilities** | Both full and production-only dependency trees. |
| Production build (`npm run build`) | **PASS** | Optimized Next.js build and page-data generation completed. This does not verify deployment or production services. |
| Full browser suite (`npm run test:e2e -- --workers=1 --timeout=90000`, with the two opt-in flags) | **PASS — 13 tests** | Public impact states/retry and real local DB empty response, role-prefilled signup, expired-session/password control, axe/keyboard/reduced-motion/responsive checks, real local auth workflow, directory attribution/fallback, and route-wide public/auth axe scan. |
| Tracked local SMTP/auth rerun | **PASS — 1 test** | Signup → actual verification email captured by `scripts/test-smtp-sink.mjs` → email verification → login → pending Helper request → admin API denial and operations-route redirect. The sink binds only to loopback and does not log message contents. |
| Isolated database configuration (`npm run db:migrate`, `npm run db:check`) | **PASS** | Eight migrations; 22 RLS tables; 9 required functions; no reported problems. |
| Live local health and impact endpoints | **PASS** | `/api/health` HTTP 200, database `ok`, `realOperationsEnabled: false`; `/api/public/impact` HTTP 200 with `status: "empty"` and all five backend metrics zero. |
| Automated accessibility scans | **PASS for selected checks** | Axe WCAG 2.0/2.1 A/AA and 2.2 AA tags reported no violations on 14 public/auth routes at 320px and 1440px, plus targeted homepage/signup/login states. This is not a conformance audit or manual review. |
| Responsive public pages | **PASS at 320px and 1440px on 14 routes; homepage also at 390, 760 and 1024px** | Playwright checked document width for overflow and exercised public navigation at narrow homepage widths. Protected workspace routes remain outside this viewport sweep. |
| Keyboard/reduced-motion spot checks | **PASS for tested interactions** | Skip-link focus, keyboard menu activation, and reduced-motion handling. This is not a complete keyboard or screen-reader review. |
| Visual spot-check | **PASS for public homepage at 390px and 1440px** | Protected workspace screens were not visually reviewed with authorized role accounts. |
| `git diff --check` | **PASS** | No patch whitespace errors. |

## Journey coverage and limitations

| Journey / surface | Status | What was actually exercised / what remains |
| --- | --- | --- |
| Public site and role-specific entry points | **PASS (browser)** | Render, accessible labels, navigation, role-request preselection, responsive menu, empty/unavailable impact states and retry. Requested roles do not grant approval. |
| Database-backed public impact | **PASS for real empty state and synthetic aggregate logic** | The actual local API returned HTTP 200, `status: "empty"`, and five zero metrics from the fresh database. A separate PGlite migration test inserted deterministic synthetic verified rows and confirmed `app_public_impact()` returns 15.25 servings, 3 verified deliveries, 2 verified organisations, 1 active Helper and 1 verified Generator; 7 boxes were not converted into servings. These are test fixtures, not real or public activity. No non-empty real-PostgreSQL dataset was used. |
| Public directory near IIM Calcutta | **PASS (browser)** | Tests cover the attributed listing, saved fallback, live app proxy and retry. The listing is explicitly not an Annapurna Link partner or offer; upstream availability and data-use terms remain external considerations. |
| Signup, email verification and login | **PASS (isolated local integration)** | A random local account received a real verification message through the test sink, verified it, signed in, and reached the workspace. External SMTP, password-reset delivery and logout were not tested. |
| Helper onboarding and permission boundaries | **PASS for pending/non-platform account** | The account submitted a Helper request and saw pending status; `/api/admin/overview` returned 403, `/app/operations` redirected to `/app`, and health still reported operations disabled. No Helper approval or operational permission was granted. |
| Workspace navigation policy | **PASS (unit tests)** | Active Generator and Receiver membership routes, active versus pending Helper links, pending organization membership, all four platform roles and ordinary-user boundaries are checked. These tests do not exercise protected server workflows or real approved identities. |
| Generator listing creation/edit/history | **NOT TESTED** | No authorized Generator or operational test record; `OPERATIONS_ENABLED` remains false. Photo upload and draft-save are still unsupported by the backend. |
| Receiver offer response | **NOT TESTED** | No authorized Receiver or offer record. |
| Approved Helper claim/pickup/delivery/receipt | **NOT TESTED** | No authorized Helper/job. Receiver-only one-time-code permissions were not exercised in an authorized delivery. |
| Admin, Safety, Support and Security review mutations | **NOT TESTED** | Unprivileged access denial is covered; privileged decision workflows were not run with a bootstrapped or seeded staff identity. Authorization was not bypassed. |
| Support/privacy submissions and failure retries | **NOT TESTED in an authenticated browser journey** | Client loading/error/empty/retry behavior is implemented; no authorized account/backend fixture exercised a complete submission. |
| Protected workspace responsiveness / manual accessibility review | **NOT TESTED / PARTIAL** | Public/auth routes are axe-scanned and overflow-checked at 320px and 1440px; the homepage is also checked at additional widths. No protected-session viewport review, complete keyboard pass, assistive-technology review or qualified WCAG audit was performed. |
| Docker Compose, production services and controlled launch | **NOT TESTED / NOT APPROVED** | Docker/Compose, production PostgreSQL/SMTP, upload scanning, backups and required human approvals remain external gates. |

## Follow-up needed

1. In an authorized isolated staging setup, test active role-specific Generator, Receiver, approved Helper and platform staff journeys with synthetic test records while keeping live operations disabled.
2. The impact function's positive aggregation and unit semantics are covered with synthetic PGlite fixtures; if a real PostgreSQL non-empty path is required, use a separately authorized disposable database and clearly label all fixtures. Do not present synthetic or test data as public impact.
3. Complete protected-workspace viewport and visual review, full keyboard and screen-reader/manual accessibility review.
4. Validate Docker, private-upload scanning, external SMTP, migration/backup/restore procedures and worker recovery on a controlled environment. Obtain qualified policy, partner, privacy, legal and security approvals before any pilot.
