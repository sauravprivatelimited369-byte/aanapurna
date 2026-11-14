# Annapurna Link — authentication implementation report

**Date:** 2026-11-13
**Branch:** `arena/5b937561-aanapurna`
**Scope:** real registration, email verification, login, password recovery, sessions, logout, trusted role routing, backend RBAC, database protection, deployment configuration and executed security tests.

> **Status in plain language:** the code now implements a real backend authentication system and the complete account lifecycle was exercised against a disposable real PostgreSQL 17 database and a real SMTP delivery path through a loopback test sink. The app builds, typechecks, lints, and its automated auth/security/role tests pass. **This is not a claim of production readiness.** A production database, a real transactional email provider, a verified domain, secure deployment secrets, CI re-run, independent security review, and human launch approval are still owner-only actions. GitHub does not provide a running database, auth server, SMTP service or domain.

---

## 1. What was found in the repository

Inspection of the existing checkout showed:

- **Framework:** Next.js 16.4.6 App Router, React 19, TypeScript, Tailwind CSS.
- **Backend/database:** PostgreSQL with Drizzle ORM, SQL migrations in `drizzle/`, separate least-privilege database roles, row-level security, Graphile Worker, Nodemailer/SMTP.
- **Authentication already present:** Better Auth 1.7.21 with a Drizzle PostgreSQL adapter. Passwords are provider-hashed in `public.account.password`; sessions, verification tokens, password-reset tokens and rate limits are stored in PostgreSQL. This was **not** a localStorage/fake login system.
- **Identity/RBAC already present:** `getIdentity()` reads trusted `platform_roles`, active `organization_memberships`, `helper_profiles`, `user_profiles.account_status` and the Better Auth session on the server. Admin APIs and `/app/operations` require platform roles. A restricted one-time `bootstrap:admin` command grants the first Admin role.
- **Gaps found before this work:** public signup collected too few fields; no dedicated `/api/register` endpoint; no requested role dashboards; no pending/suspended account pages; no explicit email-delivery truthfulness in the UI; no complete auth security test suite; no trusted post-login destination resolver; strict dashboard checks would have denied valid secondary roles; no owner-facing production auth report.
- **Environment variable names inspected, values not exposed:** `DATABASE_URL`, `AUTH_DATABASE_URL`, `WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `AUTH_SECRET`, `OTP_HASH_KEY`, `OTP_ENCRYPTION_KEY`, `EMAIL_ENCRYPTION_KEY`, `APP_URL`, `SMTP_FROM`, `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE`, `DATABASE_SSL`, `OPERATIONS_ENABLED`. No secret values are printed or committed here.

**Decision:** preserve the existing stack. Better Auth + PostgreSQL/Drizzle + Graphile Worker/Nodemailer is a complete, maintained, supported combination already wired to the repository. Introducing Supabase Auth or a second auth system would have unnecessarily replaced working functionality and created two disconnected identity systems. No new external auth provider was required.

---

## 2. Architecture

```text
Browser (React client components)
  -> same-origin POST /api/register  --------------------------.
  -> Better Auth HTTP endpoints (/api/auth/[...all])           |
  -> /auth/continue (server component)                         |
                                                              v
Next.js server: strict Zod validation, CSRF checks, DB-backed rate limits
  -> Better Auth signUpEmail / signInEmail / verification / reset / signOut
  -> databaseHooks: validate intake, create private profile, audit events,
                    guard session creation, activate verified account
  -> PostgreSQL: user, account, session, verification, rate_limit,
                 user_profiles, registration_profiles, platform_roles,
                 organization_memberships, helper_profiles, audit_events
  -> encrypted email_outbox -> Graphile Worker -> Nodemailer SMTP
  -> trusted role resolver -> /admin | /generator | /receiver | /helper
                              | /account/pending | /account/suspended
```

Roles are **never** taken from the signup dropdown, a URL parameter, `localStorage`, or editable browser state. The dropdown only records a requested role. After login, `/auth/continue` reads the validated session and the database-derived identity and redirects to a fixed server-side path. Every dashboard page calls `requireDashboardRole()`; every protected API calls `requireIdentity()` and explicit domain authorization.

---

## 3. Database changes

Eleven ordered SQL migrations now exist. The new additive migration is `drizzle/20261113190000_auth_registration_and_guards.sql`; `drizzle/meta/_journal.json` and the PGlite migration test list were updated.

It adds:

- Transient Better Auth intake columns on `public."user"`: phone, organisation name/type, address, city/area, state, postal code, profile notes. These are cleared after the durable profile is stored.
- `public.registration_profiles`: primary key/FK to `user(id)` with `ON DELETE CASCADE`, organisation/Helper check constraint, area index, `created_at`/`updated_at`, verification status default `submitted`.
- RLS on `registration_profiles`: owner or authorised platform staff can `SELECT`; the app role may `INSERT` only its own row with status `submitted`. There is deliberately **no** app `UPDATE` or `DELETE` grant/policy.
- `app_guard_user_profile_status()` trigger: the `annapurna_app` role cannot change its own `account_status` or `demo_account` flag. The existing `security definer` `app_mark_user_verified()` can still activate a verified account.
- `session_expires_at_idx` for session-expiry cleanup/lookup.
- `GRANT USAGE ON TYPE organization_type TO annapurna_auth` so Better Auth can write the transient enum column.

Existing protections retained: unique `user.email`, `NOBYPASSRLS` app/auth/worker roles, narrow column grants, `platform_roles` RLS requiring `security_admin` for privileged inserts/deletes, append-only audit trigger, and separate DB roles. Runtime check now reports **23 RLS-protected tables, 10 required functions, 11 applied migrations, no BYPASSRLS**.

`user_profiles.account_status` is distinct from organisation/Helper approval. Email verification activates the account; a Generator/Receiver/Helper still has no operational role until a trusted human review creates/approves the corresponding organisation membership or Helper profile. New registrations therefore remain pending.

---

## 4. Backend implementation

### Registration — `POST /api/register`

- Same-origin/CSRF check through `assertSameOrigin()`.
- Strict server-side `registrationSchema` validation: full name, email, password, phone, public role (`generator`/`receiver`/`helper`), organisation name/type when applicable, address, location/area, state/postal code, profile notes, terms acceptance. `admin` is not an allowed public role.
- Two independent database-backed rate limits: per network address and per email.
- Direct duplicate-email lookup against `public."user"` before calling Better Auth.
- Real account creation through `auth.api.signUpEmail()`; Better Auth performs password hashing and email uniqueness.
- Fail-closed duplicate/race handling: the returned user ID must be a committed row and no session token may have been issued.
- Response returns only status, normalised email, `requiresEmailVerification`, next page, and **setting names** for email delivery status — never SMTP credentials.
- `src/lib/auth.ts` database hooks validate intake again inside Better Auth, insert the RLS-protected `registration_profiles` row, create `user_profiles` with `account_status='pending'`, audit account creation, clear transient intake columns, activate the account after verification, audit session creation/revocation, and block sessions for suspended/unverified/unprovisioned accounts.

### Sessions, login, logout, recovery, resend

- Better Auth `emailAndPassword` with `requireEmailVerification: true`, minimum 12-character password, `autoSignIn: false`, and `revokeSessionsOnPasswordReset: true`.
- Seven-day sessions, 12-hour refresh/update age, `cookieCache.enabled = false` so logout and revocation are checked against PostgreSQL immediately.
- Cookies: `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production, `useSecureCookies` in production. `AUTH_SECRET` is required in production; development uses an ephemeral in-process fallback only.
- Login sends the browser to `/auth/continue`, which resolves the destination from trusted backend data.
- Password reset uses Better Auth's one-time token flow, emailed through the encrypted outbox/worker. Invalid or expired links show a clear error on `/reset-password`.
- Verification links succeed to `/verify-email?result=verified`; failures show an error and `/verify-email` can request a fresh link.
- `/send-verification-email`, `/request-password-reset`, sign-in, sign-up, verify and reset endpoints have tighter database-backed Better Auth rate-limit rules.
- `src/email/config.ts` reports only whether email is configured and which setting names are missing. `src/app/api/health` exposes `email.status` and missing setting names only.
- `src/worker/index.ts` validates every action-link URL against `APP_URL`, defers (does not fake) delivery when SMTP is unconfigured, and uses `SMTP_URL` or explicit `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE`.

### Trusted authorization

- `src/lib/identity.ts`: `getAccountState()` distinguishes anonymous / suspended / unverified / active from the real session and `user_profiles`.
- `src/lib/authorization.ts`: `resolvePrimaryRole()` derives Admin from `platform_roles`; Generator/Receiver from active memberships on verified organisations; Helper from an active Helper profile; otherwise pending. `hasDashboardRole()` allows every approved dashboard for a multi-role user and denies unapproved ones. Fixed destinations are `/admin`, `/generator`, `/receiver`, `/helper`, `/account/pending`.
- `/app/layout.tsx` gates the whole workspace; `/auth/continue`, `/account/pending`, `/account/suspended` and the four dashboard pages are server components.
- Admin remains available only through the restricted `scripts/bootstrap-admin.ts`, which requires `ALLOW_ADMIN_BOOTSTRAP=true`, a verified active user email, a 20–500 character reason, and the privileged migration DB URL. No public Admin signup exists.

---

## 5. Frontend / UX

Rebuilt or added:

- `/signup`: full name, email, password, confirm password, phone, requested role, organisation name/type when applicable, address, location/area, state, postal code, profile information, terms acceptance. Password visibility toggle, strength indicator, client-side validation mirrored by server validation, loading state, repeated-submission protection, clear errors and success confirmation. It explains that role selection is a request, not approval.
- `/login`: email/password, show/hide, friendly invalid-credential, unverified, suspended and expired-session messages; after success it goes to `/auth/continue`, not a browser-chosen dashboard.
- `/forgot-password`, `/reset-password`: real provider-backed recovery, new-password strength/confirmation, invalid/expired link state, confirmation and redirect to login.
- `/verify-email`: verified, error and resend states; resend is rate limited.
- `/account/pending`, `/account/suspended`: honest account-state pages with sign-out.
- `/generator`, `/helper`, `/receiver`, `/admin`: trusted role dashboards with backend-derived metrics and quick links.
- Workspace navigation links approved role dashboards; `src/app/globals.css` adds responsive form-grid, password-strength and account-state styles.
- If SMTP is not configured, success messages explicitly say **no email was actually sent** and list only the missing setting names. No decorative/fake buttons were added.

---

## 6. Security controls

| Control | Implementation |
|---|---|
| Password storage | Better Auth provider hash in `account.password`; plaintext scan executed. |
| Email uniqueness | DB unique constraint + direct duplicate check + fail-closed signup result check. |
| Password strength | 12+ chars, mixed character types, confirmation, server-side Zod validation. |
| Email verification | Required before login; one-time link, resend with rate limit, verification activates account. |
| Account states | Anonymous, unverified, pending, active, suspended/locked/deactivated handled server-side. |
| Sessions | DB-backed, HttpOnly/SameSite cookies, secure in production, 7-day expiry, sliding refresh, immediate revocation. |
| CSRF/origin | `sec-fetch-site`, Origin/Referer and exact forwarded-host origin comparison on custom APIs; Better Auth trusted origins; production `APP_URL`. |
| Rate limits | DB-backed limits on registration, sign-in, reset, resend, verification and reset endpoints. |
| RBAC | Server-derived identity, explicit API/domain checks, fixed dashboard gates, no browser role trust. |
| Admin | No public signup; restricted one-time bootstrap; platform-role self-insert denied by RLS. |
| Direct DB protection | App role cannot read Better Auth user rows, change its own status, insert platform roles, or read another user's registration/user profile. |
| Secrets | Server-only email config; health returns setting names only; `.env*`/keys ignored; production example contains placeholders only. |
| Audit | Account creation, session creation/revocation and Admin bootstrap recorded in `audit_events`. |
| Link safety | Worker validates action URL origin against `APP_URL`; no credentials in links. |

---

## 7. Tests actually executed

All commands below were run in this sandbox on the final working tree. The integration environment was a disposable embedded **PostgreSQL 17** instance, the real Next.js app, the Graphile Worker, and a loopback SMTP sink writing one-time links to an ignored private file. Fictional `example.test` accounts only were used. `OPERATIONS_ENABLED=false` remained set.

| Check | Command / method | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** |
| Lint | `npm run lint` | **PASS** |
| Unit + PGlite migration/security tests | `npm test -- --reporter=dot` | **PASS — 94/94 tests, 13 files** |
| Dependency audit | `npm audit --audit-level=moderate` | **PASS — 0 vulnerabilities** |
| Production build | `npm run build` | **PASS** |
| Whitespace/patch check | `git diff --check` | **PASS** |
| Real DB configuration | `node --env-file=.env --import tsx scripts/check-db.ts` | **PASS — 11 migrations, 23 RLS tables, 10 functions, no problems** |
| App health | `GET /api/health` | **PASS — database ok, email configured, operations disabled** |
| Core auth lifecycle | `RUN_LOCAL_AUTH_TEST=true npm run test:local-auth` | **PASS** — registration, duplicate/Admin denial, invalid phone, unverified denial, verification email, verified login, trusted destination, Admin denial, logout/replay denial, reset email, reset replay denial, old password denial, new password login |
| 23-point security suite | `RUN_AUTH_SECURITY_TEST=true LOCAL_SMTP_INBOX_PATH=.local-data/inbox.eml npm run test:auth-security` | **PASS — 23/23** |
| Trusted role routing | `RUN_AUTH_ROLE_TEST=true npm run test:auth-roles` | **PASS — 7/7** |
| Server-rendered auth pages | HTTP checks of `/signup`, `/login`, `/verify-email`, `/reset-password`, `/account/pending` | **PASS** — all required fields and verified/invalid-link/expired-session/role-caveat states present |
| GitHub Actions on the implementation and final code-equivalent commits | [run 43502286365](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43502286365) at `7408cbe` and [run 43559912589](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43559912589) at `58767b0` | **PASS — all six jobs in both runs**: Verify application, Native PostgreSQL/auth smoke, disposable PostgreSQL browser workflow, Compose smoke, Windows native auth, Windows one-click start. Verify job's browser suite: 11 passed, 3 opt-in skips; only Node.js 20 action-runtime deprecation warnings. |
| CI stability observation | [docs-only run 43559536225](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43559536225) | **ONE TRANSIENT FAILURE, RESOLVED ON RERUN**: a Windows managed-launcher job reported `A local service exited (1)` and ports did not close; no code changed between the passing run before it and the passing fresh rerun after it. Its log/artifact hosts were unreachable from this sandbox, so the transient cause was not fully diagnosed. No authentication/security test failed. |

### 23-point security suite detail

1. Real backend user + hashed password + pending profile + private intake row — PASS
2. Duplicate email rejected, one DB row — PASS
3. Correct login, HttpOnly/SameSite cookie — PASS
4. Incorrect password rejected, no hash leaked — PASS
5. Unverified login rejected with `EMAIL_NOT_VERIFIED` — PASS
6. Password recovery, one-time token, old password denied, new password accepted — PASS
7. Expired recovery token rejected — PASS
8. Logout revokes session; replay denied — PASS
9. Session persists; `/auth/continue` resolves destination from backend data — PASS
10. Expired session rejected; protected page redirects to login — PASS
11. Six protected routes redirect without a session — PASS
12. Public Admin signup, direct privileged signup and self-grant denied — PASS
13. Admin API returns 403 and `/admin` redirects for a non-admin — PASS
14. App DB role cannot read auth tables, change its status or insert platform roles — PASS
15. Cross-user registration/profile rows invisible through RLS — PASS
16. Repeated login and registration attempts rate limited — PASS
17. Cross-origin and `Sec-Fetch-Site: cross-site` mutations return 403 — PASS
18. Verification resend rate limited — PASS
19. Suspended account cannot sign in or obtain a session — PASS
20. Forged session cookie rejected; health endpoint leaks no secret values — PASS
21. Valid session refresh extends expiry and persists it in PostgreSQL — PASS
22. Admin bootstrap refuses to run without explicit owner authorisation — PASS
23. No plaintext credential in any credential account row — PASS

### Trusted role-routing suite detail

1. Restricted bootstrap grants Admin only to a verified active user and refuses an unverified user — PASS
2. Generator → `/generator`; `/receiver` redirects away — PASS
3. Receiver → `/receiver`; `/generator` redirects away — PASS
4. Helper → `/helper`; `/admin` redirects away — PASS
5. Admin → `/admin`; `/generator` redirects away — PASS
6. `/api/admin/overview`: Admin 200, Generator 403 — PASS
7. Verified account with no approved role → `/account/pending`; `/generator` redirects — PASS

### Issues found and fixed during verification

- Nullable intake fields caused TypeScript overload errors; fixed with conditional spreads and `as const` Better Auth field configuration.
- ESLint unescaped apostrophe in the dashboard copy; fixed.
- PGlite registration fixture initially violated the organisation-field check; fixed with realistic organisation values.
- A strict primary-role equality check would have denied valid secondary dashboards for multi-role users; replaced with `hasDashboardRole()` and unit-tested.
- Expired-reset test initially reused an older link from the append-only local inbox; fixed with message indexing.
- Admin-bootstrap guard test initially failed earlier on missing email/reason; fixed with a complete guard fixture.
- One unit launcher test temporarily failed because the integration PostgreSQL/SMTP ports were occupied; local services were stopped, the suite was rerun, and the final result is 94/94.
- No critical or high-severity issue remains in the **tested scope**. This is not a full independent security audit.

---

## 8. PASS / FAIL / NOT TESTED summary

| Requirement | Status | Evidence / note |
|---|---|---|
| Real registration creates a backend account | **PASS** | Security checks 1–2, local auth smoke |
| Email uniqueness and duplicate handling | **PASS** | Security check 2, `user_email_unique` |
| Provider password hashing, no plaintext | **PASS** | Security checks 1 and 23 |
| Password strength, visibility, confirmation | **PASS** | Server-rendered form + validation tests |
| Email verification / resend / rate limit | **PASS** | Local auth smoke, security checks 5 and 18 |
| No public Admin signup | **PASS** | Security check 12 |
| New Generator/Receiver stays pending | **PASS** | Role suite check 7, `/account/pending` |
| Correct/incorrect login and unverified/suspended handling | **PASS** | Security checks 3–5 and 19 |
| Password recovery, expired/invalid link | **PASS** | Security checks 6–7, reset page HTTP check |
| Real email delivery | **PASS (local sink)** | Verification/reset links genuinely delivered through SMTP sink + worker |
| Production email delivery | **NOT TESTED** | Requires owner SMTP provider/domain; see §9 |
| Session persistence, refresh, expiration, logout | **PASS** | Security checks 8–10 and 21 |
| Secure cookies / CSRF / session fixation | **PASS** | Security checks 3, 17 and 20; production `secure` flag not exercised locally |
| Protected route access | **PASS** | Security check 11 |
| Trusted role dashboards and backend RBAC | **PASS** | Role suite 2–7, Admin API 403/200 |
| Role manipulation / self-admin impossible | **PASS** | Security checks 12 and 14, role suite 1 |
| Direct DB restrictions / cross-user isolation | **PASS** | Security checks 14–15 |
| No secret exposure / no plaintext credentials | **PASS** | Security checks 20 and 23; `.gitignore` verified |
| App builds | **PASS** | `npm run build` |
| Auth tests actually executed | **PASS** | 94 unit/migration + 23 security + 7 role + local auth smoke |
| Browser-driven Playwright/axe/responsive interaction tests | **PASS in CI; NOT TESTED in local sandbox** | GitHub Actions run 43502286365 installed Chromium and passed the public browser suite (11 passed, 3 opt-in skips) plus the disposable PostgreSQL browser workflow. Local Chromium download was blocked by sandbox network; server-rendered HTML states were checked over HTTP. |
| Production HTTPS cookies / production `APP_URL` callbacks | **NOT TESTED** | Config verified in source; requires owner domain/host |
| Production SMTP provider, sender-domain verification, deliverability, worker retries | **NOT TESTED** | Requires owner account and provider |
| Compose, Windows launcher, managed PostgreSQL, backup/restore on this commit | **PASS in CI; NOT TESTED in local sandbox** | All corresponding jobs passed in run 43502286365 |
| GitHub Actions checks on the implementation/code-equivalent commits | **PASS** | Runs 43502286365 and 43559912589, all six jobs successful. One docs-only intermediate run had a transient Windows launcher failure resolved by a fresh rerun. |
| Full cross-tenant operational data, load/race testing, independent security review, food-safety/legal/privacy approval, live operations | **NOT TESTED / not authorised** | Keep `OPERATIONS_ENABLED=false` |

**FAIL in the final executed authentication suites: none.** One intermediate CI run had a transient Windows managed-launcher failure on a docs-only commit; the fresh rerun on identical code passed all six jobs. Items marked NOT TESTED are honest gaps, not implied passes.

---

## 8.1 Hosted preview update (2026-11-13)

The authorized Supabase/Vercel preview resources are documented in
[`HOSTED_DEPLOYMENT.md`](HOSTED_DEPLOYMENT.md). Supabase remains PostgreSQL-only;
Better Auth is still the sole auth system. Web-only Vercel hosting is separate
from the persistent Graphile Worker. Repository blockers addressed in this
update: optional `SMTP_URL` or explicit SMTP fields, a managed-DB Compose
overlay, exact `VERCEL_URL` trusted origin, guarded shared worker pool/shutdown,
Vercel build-command configuration with Node `22.x` via `engines.node`,
fail-closed placeholder checks, and a Windows CI port-ownership cleanup.

Latest local evidence: typecheck PASS; lint PASS; **105 unit tests PASS**;
production build PASS; `git diff --check` PASS; positive synthetic `SMTP_URL`,
discrete SMTP, and Vercel-shape preflights PASS; negative missing/placeholder
preflights correctly refused. CI at `2d270da` passed five of six jobs; the
Windows launcher job failed on a port-cleanup race and has a targeted workflow
patch pending fresh CI. Hosted database migrations, real SMTP delivery, private
uploads, backups, custom-domain cookies, independent security review and human
launch approval remain **NOT TESTED**. `OPERATIONS_ENABLED=false`. No production
readiness is claimed.

## 9. Owner-only external configuration — exact simple instructions

These are the only steps that genuinely require an account owner or hosting administrator. **Do not paste any real value into chat, GitHub, an issue, a committed file, or `.env.example`.** Use your host's **Environment variables / Secrets** page.

### 9.1 Create a persistent PostgreSQL database

GitHub does not host the running database. In a managed PostgreSQL provider, create one database and four restricted connection URLs. Put each URL into the secret with the same name:

- `DATABASE_URL` — web application role
- `AUTH_DATABASE_URL` — Better Auth role
- `WORKER_DATABASE_URL` — mail worker role
- `MIGRATION_DATABASE_URL` — one-time migration/Admin-bootstrap role
- `DATABASE_SSL=true`
- Optional: `DB_POOL_MAX`, `AUTH_DB_POOL_MAX`

If the provider only supplies one administrator URL, ask a trusted administrator to run the repository's one-time DB role setup (`npm run local:db:setup` equivalent) on the intended host, then create the four restricted URLs. Do not use one administrator URL for the whole running app. Apply migrations once with `npm run db:migrate` and verify with `npm run db:check` / `scripts/check-db.ts`.

### 9.2 Set the public HTTPS address

- `APP_URL=https://your-owned-domain`

This exact HTTPS origin is used for Better Auth `baseURL`, trusted origins, and verification/reset action-link validation. There is no separate hard-coded callback URL to edit. Point DNS to your host and ensure the host forwards the original HTTPS host/proto to the app.

### 9.3 Generate four authentication secrets

In the host's secret generator, create four independent random values and assign:

- `AUTH_SECRET` — required in production; the app refuses to start without it.
- `OTP_HASH_KEY`
- `OTP_ENCRYPTION_KEY`
- `EMAIL_ENCRYPTION_KEY`

The repository's `.env.production.example` lists these names with placeholders only. Never commit a filled production env file.

### 9.4 Configure a real transactional email provider

Create an account with a transactional SMTP provider, verify your sender domain, and enter **one** of these two forms:

**Option A — one URL (recommended):**

- `SMTP_FROM` = `Annapurna Link <no-reply@your-owned-domain>`
- `SMTP_URL` = the provider's SMTP URL, including its username/password. **This is the exact secret to enter through secure deployment settings.** Treat it as a password.

**Option B — explicit fields:**

- `SMTP_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE` (`true` for implicit TLS / port 465)
- `SMTP_USER`
- `SMTP_PASS` — **this is the exact email password/API secret to enter through secure deployment settings.**

Use the same values for the **web app** and the **Graphile Worker** process. Run both processes in production; the worker is what actually delivers queued verification/reset email. If these values are missing, the UI says plainly that no email was sent and the worker defers rather than pretending delivery. Verification and password recovery will not work until this is configured.

### 9.5 Keep real operations off

- `OPERATIONS_ENABLED=false`
- `FILE_SCAN_MODE=disabled` until private storage and malware scanning are approved.

### 9.6 Create the first Administrator (only after your own account is verified)

There is no public Admin signup. Register normally, verify your email, log in once, then on the trusted host run the one-time command with the privileged DB URL available:

```sh
ALLOW_ADMIN_BOOTSTRAP=true \
BOOTSTRAP_ADMIN_EMAIL='your-verified-address@your-owned-domain' \
BOOTSTRAP_ADMIN_REASON='Owner-authorised first administrator for controlled deployment' \
npm run bootstrap:admin
```

Use a reason of 20–500 characters. Remove `ALLOW_ADMIN_BOOTSTRAP` from the environment immediately afterward. Never share the resulting account or credentials.

### 9.7 Run CI and deployment checks

The workflow was run twice on code-identical commits: [run 43502286365](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43502286365) at `7408cbe` and [run 43559912589](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43559912589) at `58767b0` both passed all six synthetic jobs. A docs-only intermediate [run 43559536225](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43559536225) had one transient Windows managed-launcher failure; the fresh rerun passed. It includes typecheck, lint, unit/migration tests, browser tests, dependency audit, production build, real-PostgreSQL auth smoke, `test:auth-security`, and `test:auth-roles`. Re-run CI after any further code or configuration change, and investigate every failure before exposing the app publicly. The final documentation-only commit that adds this note was deliberately pushed with `[skip ci]` because it changes no code, configuration, workflow, or test.

---

## 10. Post-deployment test steps (use a fictional account first)

1. Open `https://your-owned-domain/api/health`: expect database `ok`, email `configured`, `realOperationsEnabled: false`.
2. Open `/signup`, choose a public role, fill all required fields, submit: expect an account-created confirmation that does **not** claim role approval.
3. Check the real inbox for a verification email. If none arrives, inspect worker/outbox logs and SMTP provider settings; do not assume delivery.
4. Open the verification link: expect `/verify-email?result=verified`.
5. Try logging in before any human approval: expect `/account/pending` for a normal account.
6. Try a wrong password: expect a generic rejection.
7. After trusted approval, log in: expect `/generator`, `/helper`, `/receiver` or `/admin` according to backend records — not according to the signup dropdown.
8. Refresh the browser several times: expect the session to remain valid. Leave it for the configured expiry or revoke it to confirm expiration.
9. Try opening another role's dashboard and `/api/admin/overview`: expect redirect/403.
10. Use `/forgot-password`, open the reset email, set a new password, confirm the old password fails and the new one works. Reuse the old link: expect invalid/expired.
11. Sign out, then replay the old session cookie or refresh: expect login redirect.
12. Confirm no real donation operations are enabled until every human, legal, food-safety, privacy and security gate in `LAUNCH_CHECKLIST.md` is closed.

---

## 11. Deployment / secret safety

- `.gitignore` ignores `.env*` but explicitly permits `.env.example` and `.env.production.example`; both contain placeholders only.
- `.env.production.example` is a new placeholder-only template for owner configuration.
- No DB password, API key, service-role key, SMTP password, `AUTH_SECRET`, private key or production env value was committed or printed here.
- `src/email/config.ts` and `/api/health` expose only setting **names** and configured/not-configured status.
- CI needs no repository secrets for synthetic local tests; production secrets belong only in the host's secure settings.
- Browser-facing code never calls `localhost`/`127.0.0.1` to reach backend services; it uses relative same-origin URLs. The local preview proxy forwards the configured host/origin.

---

## 12. Final statement

A real user can now register through the app, a real PostgreSQL-backed Better Auth account is created, a verification email is genuinely delivered when the mail service is configured, the verified user can log in, sessions persist and refresh, logout revokes them, password recovery works, and the server sends each approved role to its correct dashboard while denying unauthorised roles. This was exercised locally with real PostgreSQL and SMTP delivery to a test sink; 94 unit/migration tests, 23 security checks, 7 role-routing checks and the core auth smoke all passed, and the app builds.

**Production readiness is not claimed.** CI passing is evidence for the synthetic test suites, not a production certification; the transient Windows CI flake also remains a launcher-stability caveat. The owner must still provide the persistent database, real SMTP credentials, HTTPS domain, secure secrets, a running worker, independent security review, and the human launch approvals. Do not enable real food operations until those are complete.
