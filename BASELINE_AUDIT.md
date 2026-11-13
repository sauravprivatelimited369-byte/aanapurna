# Baseline audit

- **Reviewed:** 2026-11-12
- **Branch:** `arena/d3d3055c-aanapurna`
- **Base commit:** `86253da520a8177a058a237fc1331c09bccecf31`

## Repository and stack

The base commit contains only a minimal README. The current working tree adds a Next.js App Router application using React/TypeScript, Better Auth, PostgreSQL, Drizzle ORM/migrations, Graphile Worker, Nodemailer/SMTP, Zod, private local file storage, Vitest, and PGlite tests. Runtime operations are intentionally gated by `OPERATIONS_ENABLED` and require a human-approved active policy.

## Existing functionality

- Public landing, about, safety, terms/privacy drafts and account pages.
- Email/password Better Auth configuration, verification/reset email outbox, scoped identities and onboarding requests.
- Generator/Receiver/Helper data workflows, offers/deliveries, delivery verification, receipts, notifications, operations review, support and data requests.
- PostgreSQL migrations, runtime-role grants/RLS policies, private document storage checks, and a PostgreSQL-backed email worker.
- Six SQL migrations; PGlite migration and permission tests.
- A new public-discovery page for one Halla Bowl record near IIM Calcutta, sourced live from the keyless IndiaRestros API and explicitly not represented as a partner.

## Verification observed in this environment

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --reporter=dot`: 16 tests passed across three files, including PGlite migration/role checks and isolated validation/adapter tests.
- `npm run build`: passed; the new local-discovery page is statically rendered with the actual external lookup deferred to the browser.
- Six migrations have been applied to disposable PGlite in tests. **No real PostgreSQL instance was available for this audit.**

## Gaps and risks

- Docker/Compose, PostgreSQL server tools and a real disposable PostgreSQL test database are not installed in the coding environment. The new Compose path is therefore not runtime-verified here.
- No Playwright end-to-end tests have been implemented or executed. The UI's browser-to-IndiaRestros request is not yet browser-tested; adapter tests use controlled fixtures. The real API docs and Halla Bowl record were inspected separately.
- SMTP delivery through Mailpit, user signup/verification/reset, worker retries, admin bootstrap, and real document scanning have not been exercised end-to-end.
- Private document upload is fail-closed in production unless a scanner is configured. The sample local Compose setup leaves food operations off and file scanning disabled.
- `npm audit --omit=dev --audit-level=moderate` reports four moderate esbuild advisories through Drizzle Kit's deprecated `@esbuild-kit` loader. `npm audit fix --force` proposes an incompatible Drizzle Kit downgrade; no risky override was applied.
- No external partner consent, operating-area decision, food-safety policy approval, legal review, or production secret/domain/SMTP configuration has been supplied.
- The restaurant API's broad data-use licence was not confirmed; this implementation displays one attributed entry only and does not import contact/menu/photo/ratings data.

## Retain and protect

- Keep live donation operations gated until the project owner records legal, food-safety, partner, privacy and security approvals.
- Do not convert the public Halla Bowl listing into an organisation record, claim affiliation, or send unsolicited outreach.
- Keep credentials only in ignored `.env`/runtime secrets; never commit the generated local `.env`.
- Keep database migrations reviewed and version-controlled; do not replace them with production schema push.

## Recommended next work

1. Run Compose on a host with Docker, verify migrations and role grants against PostgreSQL, and exercise Mailpit signup/reset flows.
2. Add real-PostgreSQL integration and Playwright end-to-end tests for account lifecycle, tenant isolation, matching/assignment, OTP and receipts.
3. Verify the browser CORS/API request and provider data-use terms; keep the discovery entry isolated from partner workflows.
4. Complete operator/food-safety/legal/privacy review and configure a scanner before enabling any real operations or production document uploads.
5. Review dependency advisories and update the deprecated loader safely when an upstream-compatible release is available.
