# Annapurna Link

[![CI](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/workflows/ci.yml/badge.svg)](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/workflows/ci.yml)

Annapurna Link is a controlled-launch food redistribution platform. It records partner requests, food offers, deliveries and operational reviews. It does not inspect or certify food as safe. Real donation operations stay disabled until the owner approves an operating area and policy.

**Project status:** pre-pilot; this repository is not a live food service. `OPERATIONS_ENABLED=false` by default, and the public impact endpoint shows only backend-derived verified records.

If this careful, auditable approach is useful, **[star the repository](https://github.com/sauravprivatelimited369-byte/aanapurna)** to help people discover it. Stars are not proof of safety, production readiness or verified impact. No paid offering or revenue model is currently approved; any sustainable funding or hosted-service plan needs stakeholder validation before implementation.

## Product experience

- Public overview: `/` (purpose, process, verified impact when recorded, and role-specific entry points).
- How it works: `/how-it-works`.
- Food-safety scope: `/food-safety` (draft; requires qualified review).
- About, contact and accessibility: `/about`, `/contact`, `/accessibility` (no official email/phone is invented).
- Account flows: `/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`.
- Role workspace: `/app` (role-scoped overview, listings/offers/deliveries, onboarding, notifications and support).
- Restricted operations: `/app/operations` (available only to authorized platform roles; controls remain behind backend authorization).
- Local public directory example: `/near-iim-calcutta` (attributed public record, not an Annapurna Link partner or offer).

The audit and implementation tracker in [`UI_UX_AUDIT.md`](UI_UX_AUDIT.md) and [`UI_UX_IMPLEMENTATION_PLAN.md`](UI_UX_IMPLEMENTATION_PLAN.md), shared interface guidance in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md), and the latest evidence and blockers in [`UI_UX_TEST_REPORT.md`](UI_UX_TEST_REPORT.md) describe what is implemented and what remains unverified. Metrics, when shown, are sourced from the backend; the site must not fabricate meals, impact, partners or approvals.

## Stack

- Next.js App Router, React, TypeScript and Tailwind CSS
- Better Auth with PostgreSQL/Drizzle
- PostgreSQL migrations and row-level security policies
- Graphile Worker and an encrypted transactional email outbox
- Nodemailer-compatible SMTP; Mailpit for local email capture
- Vitest, PGlite migration/security checks, and Playwright browser tests

## Local Compose setup

Prerequisites: Docker Engine with the Compose plugin, Git, and Node.js 22 (Node is needed for the local environment generator and optional host checks).

```sh
npm run setup:env
# Starts PostgreSQL, applies migrations, starts the web app and worker, and starts Mailpit.
docker compose up --build
```

`setup:env` generates fresh local-only secrets in `.env` and refuses to overwrite an existing file. Keep `.env` private; it is ignored by Git. The Compose database uses separate app, auth and worker roles. The migration URL uses the local database owner.

Local URLs:

- App: <http://localhost:3000>
- Health: <http://localhost:3000/api/health>
- Mailpit inbox: <http://localhost:8025>
- SMTP from the Compose network: `mailpit:1025`

Useful commands:

```sh
docker compose logs -f web worker db
docker compose run --rm web npm run db:check
# Stop services but keep PostgreSQL/uploads volumes:
docker compose down
# Destructive: removes PostgreSQL and private-upload data:
docker compose down -v
```

The Compose sample intentionally keeps `OPERATIONS_ENABLED=false`. Its default `FILE_SCAN_MODE=disabled` also blocks private uploads in production-mode containers until an antivirus scanner is configured. Do not enable live donations by changing a flag alone.

## Publish on a short custom domain

The same application can run at `localhost` for development or behind a public domain. A short `.io` address is **not** created automatically: you must own/register the domain and point its DNS to a server you control. This repository includes a Docker Compose + Caddy deployment overlay for a single Linux host; Caddy obtains and renews HTTPS certificates automatically once DNS is correct and ports 80/443 reach that host.

1. Provision a supported Linux host with Docker Compose, a persistent disk, and ports 80/443 open. Register the short domain you want (for example, a name you own under `.io`) and set its DNS A/AAAA records to the host. Do not use a domain you do not control.
2. Clone this repository on the host and generate fresh secrets with `npm run setup:env` (Node.js 22 is required). Edit `.env` privately and set:

   ```dotenv
   APP_DOMAIN=your-short-domain.io
   APP_URL=https://your-short-domain.io
   SMTP_URL=smtps://...your-provider-credentials...
   SMTP_FROM="Annapurna Link <verified-sender@your-domain>"
   OPERATIONS_ENABLED=false
   FILE_SCAN_MODE=disabled
   ```

   Use the exact provider URL format documented by your SMTP service, keep `.env` private, and never commit it. Use a real transactional mail provider; the local Mailpit default is for development only.
3. Start the complete stack (web, PostgreSQL, migrations, mail worker, and HTTPS proxy):

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
   docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f web caddy worker
   ```

4. Visit `https://your-short-domain.io`. The local workflow remains unchanged at `http://localhost:3000`; choose either local run or hosted run against the same codebase. Use `docker compose down` to stop services without removing data. Back up PostgreSQL and private-upload volumes using an off-host, tested restore procedure.

This is a deployment scaffold, **not a launch approval**. The public site and account pages can be hosted, but production auth/email, database recovery, host hardening, upload scanning, monitoring, privacy/legal review, and role-specific workflows still need validation. Keep live operations disabled until all launch gates are explicitly approved; do not publish real personal information or enable donations just to make the site appear complete. A custom domain must be purchased/configured by its owner—this code cannot register a short `.io` domain or create an external server for you.

## First operations administrator

1. Create an account at <http://localhost:3000/signup> and select a public role request only if applicable.
2. Open the verification message in Mailpit at <http://localhost:8025> and complete email verification.
3. After the account is verified and active, grant the platform role through the explicit, one-time bootstrap command. Use a reason of at least 20 characters:

```sh
docker compose run --rm \
  -e ALLOW_ADMIN_BOOTSTRAP=true \
  -e BOOTSTRAP_ADMIN_EMAIL='your-verified-address@example.test' \
  -e BOOTSTRAP_ADMIN_REASON='Owner-authorised local bootstrap for controlled testing' \
  web npm run bootstrap:admin
```

Never put real passwords or tokens in source, issues, logs, or chat. No demo account or public admin signup is created by default.

## Development and checks

```sh
npm ci
npm run setup:env            # local config/secrets only; does not start PostgreSQL
npm run typecheck
npm run lint
npm test -- --reporter=dot
npm run build
npx playwright install chromium
```

The GitHub Actions workflow in `.github/workflows/ci.yml` runs typecheck, lint, unit/migration tests, the public browser suite, dependency audits and a production build using generated ephemeral local-only configuration; it needs no repository secrets. The opt-in real-PostgreSQL/auth workflows are not run in CI. `npm run test:e2e` starts the Next.js dev server automatically (and reuses a running local server outside CI). `setup:env` creates local config/secrets only; it does not start PostgreSQL or provide real records. The migration/security suite uses PGlite, a PostgreSQL-compatible embedded test engine. It does **not** replace integration tests against a real PostgreSQL server. The UI verification also used an isolated, disposable local PostgreSQL database; this does not validate Docker Compose or production services. Docker Compose has been authored but could not be run in this environment because Docker Engine/Compose is unavailable; validate Compose on a Docker-capable machine before relying on it.

### Optional isolated PostgreSQL and authenticated browser checks

The opt-in integration tests use a throwaway, migrated local database with `OPERATIONS_ENABLED=false`. Never point them at a production or shared database. The authenticated test creates a random `example.test` account and a **pending** Helper request, verifies the email through a local-only SMTP sink, signs in, and checks that admin access remains denied. It does not approve anyone or create operational records.

1. Configure the four local database URLs and apply/check migrations:

   ```sh
   npm run db:migrate
   npm run db:check
   ```

2. Start the test-only SMTP sink; it binds to `127.0.0.1` and writes captured mail to a mode-0600 local file. Playwright starts the app automatically (or reuses a local dev server):

   ```sh
   export LOCAL_SMTP_INBOX_PATH=/tmp/annapurna-test-inbox.eml
   npm run test:smtp-sink
   ```

3. In another terminal, load the local database/key settings, direct only the worker to that sink, and start the worker:

   ```sh
   set -a; . ./.env; set +a
   export SMTP_FROM='Annapurna Link <noreply@example.test>'
   export SMTP_URL='smtp://127.0.0.1:2526'
   npm run worker
   ```

4. Run the database-backed empty-impact check and the authenticated flow (with a local Playwright Chromium installation):

   ```sh
   RUN_DATABASE_IMPACT_E2E=true \\
   RUN_LOCAL_AUTH_E2E=true \\
   LOCAL_SMTP_INBOX_PATH=/tmp/annapurna-test-inbox.eml \\
   PLAYWRIGHT_BASE_URL=http://localhost:3000 \\
   npm run test:e2e -- --workers=1
   ```

The SMTP file contains one-time verification links. Keep it private and remove it after testing. Reset or drop the throwaway database after the auth run; no real users should be added. The impact test checks the actual database-backed **empty** response only, not nonzero operational aggregates.

To run the web server directly on the host, provide local PostgreSQL URLs for `DATABASE_URL`, `AUTH_DATABASE_URL`, `MIGRATION_DATABASE_URL` and `WORKER_DATABASE_URL` (the generated `.env` contains host-side connection strings), then run `npm run dev`. For host-run SMTP, set `SMTP_URL=smtp://127.0.0.1:1025`; `mailpit` is a Compose-only hostname.

## Restaurant discovery near IIM Calcutta

`/near-iim-calcutta` displays Halla Bowl's current public restaurant-directory record for Joka, Kolkata. It reads one record from IndiaRestros, the keyless restaurant API listed in [`public-apis/public-apis`](https://github.com/public-apis/public-apis). That repository catalogs APIs; it does not provide API keys. The page links to the provider record and OpenStreetMap search and labels the restaurant as **not an Annapurna Link partner**. It does not create an organisation, claim consent, show an offer, or send outreach. The provider's data-use terms should be confirmed before this is expanded beyond the single attributed listing.

## Safety and production status

This repository is not approved for a real-world pilot or production use. Real food operations require a human-approved policy, partner verification and local legal/privacy/security review. Email credentials, domain/TLS, private-storage scanner, backup/restore and real PostgreSQL integration are additional deployment gates. See [`BUILD_STATUS.md`](BUILD_STATUS.md), [`BASELINE_AUDIT.md`](BASELINE_AUDIT.md) and [`DECISIONS/ADR-0001-public-restaurant-discovery.md`](DECISIONS/ADR-0001-public-restaurant-discovery.md).
