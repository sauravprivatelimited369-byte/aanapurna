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

## Windows: start everything with `start.bat`

On a fresh Windows x64 checkout, install **Node.js 22 with npm**, then double-click `start.bat` normally (**do not** use “Run as administrator”; PostgreSQL refuses elevated Windows accounts). `start.sh` is the equivalent entry point on macOS and Linux.

The launcher is inspection-first and asks before it changes anything:

1. **Preflight (read-only).** It reports Node.js and npm versions, whether the locked packages are already installed, which local database mode applies, free disk space, whether ports **3000, 2526, 2527 and 55432** are free, and — only when a download is needed — whether the npm registry is reachable. `node scripts/launch-setup.mjs --check` runs just this step.
2. **Plan.** It lists every action it would take (download the locked npm packages, create private local settings and a PostgreSQL 17 cluster, apply migrations, start services, open the app) with rough timings.
3. **Explicit permission.** It asks `Continue with these actions? [Y/n]` and proceeds only on an unambiguous yes. Answering `n` exits with nothing downloaded and nothing created. A run without a keyboard (CI, redirected input) never installs silently: it explains the actions and exits unless you pass `--yes` or set `ANNAPURNA_LAUNCH_APPROVED=1` in that environment (the launcher prints which approval it used; any other value, including `0` or `true`, is not approval). Approval is only skippable for a **pure restart** of an already-configured install; creating settings, a database or starting servers always needs consent. `node scripts/launch-setup.mjs --check` inspects without changing anything, and `node scripts/assert-consent-gate.mjs` verifies on a fresh checkout that an unapproved run refuses and leaves the folder untouched.
4. **Download.** `npm ci` installs exactly the versions in `package-lock.json` (several hundred MB the first time). Only the npm registry is contacted.
5. **Prepare.** It generates private local secrets, provisions its own loopback PostgreSQL 17 database, creates restricted roles and applies migrations. No system-wide install and no administrator rights.
6. **Start and open.** The web app, worker and a private loopback **test inbox page** (<http://127.0.0.1:2527/>) start, and the launcher opens the app in your browser once `/api/health` reports `ok` with real operations disabled. Ctrl+C stops every process and PostgreSQL cleanly.

If Node.js is missing, `start.bat` offers (`[y/N]`) to open the official <https://nodejs.org/en/download> page in your browser; it never installs anything by itself. If npm, disk space, a port or the network is missing, the launcher names the exact problem and stops before changing anything. Docker and a separately installed PostgreSQL server are not required for this managed setup. The managed PostgreSQL dependency is a pinned beta package for local development, not production infrastructure.

Your local database and private test inbox are stored under `.local-data/`; `.env` and `.local-data/managed-postgres.json` contain local secrets and must remain private. The inbox page at <http://127.0.0.1:2527/> renders the same raw file, is loopback-only and read-only, and shows one-time sign-in links; the raw `.eml` remains the source of truth and should be deleted when no longer needed. Keep all three together: deleting/regenerating `.env` or the managed settings can make the existing database inaccessible. Back up needed local data before changing either; do not commit or share the files. Windows file permissions depend on your account and directory ACLs. There is no automatic backup or production recovery guarantee.

If `.env` already exists without managed settings, the launcher preserves it and uses the **existing** native configuration instead: preflight confirms your PostgreSQL answers on the host and port in `.env` and stops with a clear message if it does not, and the launcher never creates, replaces or stops that server. It must already be running and migrated as described below. If the managed port is occupied, settings are missing, or setup is incomplete, the launcher stops rather than overwrite data. Useful launcher options: `--check` (inspect only), `--yes` (skip the prompt in automation), `--no-open` (never open a browser), `--open` (open the app and test inbox when ready) and `--help`. Do not delete any database to make it start. The first run may take several minutes; if npm installation fails, check Node/npm and network access and retry.

**Safety:** `start.bat` is local development only, leaves real operations disabled, and sends no real email. The sink writes one-time links to `.local-data/inbox.eml`; keep that file private. Gmail/provider settings require the separate operator steps below and are not used by this local launcher.

## Local setup without Docker

Docker is **optional** for local development. The Windows launcher above provides a managed local PostgreSQL server; the manual path below uses a separately installed one: the app cannot safely replace its database with GitHub, browser storage, or static files. These steps are for a **fresh, isolated development PostgreSQL instance**, not a shared or production server.

1. Install Node.js 22 and PostgreSQL (17 recommended, running on `127.0.0.1:5432`). During PostgreSQL installation, set a password for the local `postgres` administrator; do not reuse a production database. Make sure ports 3000, 5432 and 2526 are free. PostgreSQL must remain running while using the application.
2. From the repository directory, install dependencies and generate the ignored local settings file:

   ```sh
   npm ci
   npm run setup:env
   ```

   The generator will not overwrite an existing `.env`. Its generated local passwords must match the database; do not delete or regenerate this file while keeping the same database.
3. Set `PG_ADMIN_URL` **temporarily** to your own local PostgreSQL superuser connection URL, e.g. `postgres://postgres:<URL-encoded-password>@127.0.0.1:5432/postgres`. Do not literally type angle brackets; URL-encode special characters in the password. Do not commit the URL or paste it in chat. To avoid storing it in shell history, on macOS/Linux enter it using `read -rs PG_ADMIN_URL; export PG_ADMIN_URL` (input is hidden). On PowerShell use `$env:PG_ADMIN_URL = [System.Net.NetworkCredential]::new('', (Read-Host 'Local PostgreSQL admin URL' -AsSecureString)).Password`. The URL is held only in the current shell.
4. Create the isolated database and roles **once**, then run the checked-in migrations:

   ```sh
   npm run local:db:setup
   npm run local:migrate
   ```

   Remove the administrator URL from your shell afterward (`unset PG_ADMIN_URL` on macOS/Linux, `Remove-Item Env:PG_ADMIN_URL` on PowerShell). Bootstrap refuses existing Annapurna databases or roles rather than overwrite them. It creates a local superuser migrator, as the Compose PostgreSQL image does; the app, authentication and worker use separate restricted roles. If setup partially fails, inspect the server and resolve the error deliberately; never drop databases or roles without a backup. Do not use this bootstrap on shared infrastructure.
5. Start the local app, worker and a **test-only** loopback email sink together:

   ```sh
   npm run local:start
   ```

   Open <http://localhost:3000>. On Windows, an existing manual setup can instead use `start.bat`; it will not replace or automatically start your separately managed PostgreSQL instance. Stop with Ctrl+C. This command checks the restricted database role and migrations before starting; it refuses enabled real operations and nonlocal database URLs. If startup fails, read the diagnostic: check PostgreSQL, `.env`, migrations and port conflicts.

The development mail sink writes verification and password-reset messages to `.local-data/inbox.eml` rather than Mailpit. Open it in a text editor to find the latest one-time link. This is a deliberately limited test adapter, not real email: it is bound to loopback, appends messages, has no web inbox and should contain only fictional test data. The file contains sensitive links, is ignored by Git and must be kept private and deleted when no longer needed. To exercise the real local signup/login/reset and revocation paths with a synthetic `example.test` account, leave `local:start` running and execute `RUN_LOCAL_AUTH_TEST=true npm run test:local-auth` (PowerShell: `$env:RUN_LOCAL_AUTH_TEST='true'; npm run test:local-auth; Remove-Item Env:RUN_LOCAL_AUTH_TEST`). Run only against a throwaway database; the test leaves its fictional account in that database. Rate limits apply; wait a minute if repeated runs hit them.

For a first local operations administrator, create and verify a fictional test account, then run the documented bootstrap command below via the host with `node --env-file=.env --import tsx scripts/bootstrap-admin.ts` and the three bootstrap environment variables set privately. This does not approve food operations. Docker Compose/Mailpit remains the alternative below and is required for the supplied container deployment scaffold, not for opening the native development app.

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

## GitHub Pages frontend with a separately hosted app

A static public frontend is configured for publication at **<https://sauravprivatelimited369-byte.github.io/aanapurna/>**. The repository's GitHub Pages environment currently allows deployment from `main` only, so this version will appear at that URL after the pull request is merged and the Pages deployment succeeds. GitHub Pages serves the informational site only. It cannot run this repository's PostgreSQL-backed APIs, account flows, or worker, so those require a separately hosted instance of the full Next.js application.

The Pages workflow deploys the content in `github-pages/` on pushes to `main` or the active deployment branch. Until an application server is configured, account links stay disabled and the page explains why. To connect one, add the Actions repository variable `ANNAPURNA_BACKEND_URL` with the public HTTPS origin of the full app (for example, `https://app.your-domain.io`) in **Settings → Secrets and variables → Actions → Variables**. The workflow injects that URL when it publishes; the account links then open the hosted app. Do not put secrets in this public variable. Follow the deployment steps below to host the backend and database; DNS and a domain you control are still required.

## Publish the full app on a short custom domain

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

   Use the exact provider URL format documented by your SMTP service, keep `.env` private, and never commit it. Use a real transactional mail provider; the local Mailpit default is for development only. For an authenticated external `smtp://` (STARTTLS required) or `smtps://` provider URL, run `RUN_SMTP_VERIFY=true npm run smtp:verify` on the intended host (PowerShell: `$env:RUN_SMTP_VERIFY='true'; npm run smtp:verify; Remove-Item Env:RUN_SMTP_VERIFY`). The explicit probe checks TLS and authentication without sending mail by default or logging credentials; it does not establish sender-domain verification, inbox delivery, retries or provider compliance. To request exactly one test message to your own inbox, set `RUN_SMTP_SEND_TEST=true` and `SMTP_TEST_TO` to that single operator-controlled address in addition to `RUN_SMTP_VERIFY=true`. Provider acceptance is not proof of inbox delivery; check the inbox and spam folder separately. Verify worker/outbox delivery and retries separately before launch. The probe requires hostname, credentials and no URL query options; it does not support every provider configuration.
3. Start the complete stack (web, PostgreSQL, migrations, mail worker, and HTTPS proxy):

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
   docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f web caddy worker
   ```

4. Visit `https://your-short-domain.io`. The local workflow remains unchanged at `http://localhost:3000`; choose either local run or hosted run against the same codebase. Use `docker compose down` to stop services without removing data. Back up PostgreSQL and private-upload volumes using an off-host, tested restore procedure.

This is a deployment scaffold, **not a launch approval**. The public site and account pages can be hosted, but production auth/email, database recovery, host hardening, upload scanning, monitoring, privacy/legal review, and role-specific workflows still need validation. Keep live operations disabled until all launch gates are explicitly approved; do not publish real personal information or enable donations just to make the site appear complete. A custom domain must be purchased/configured by its owner—this code cannot register a short `.io` domain or create an external server for you.

## Optional Gmail SMTP for an operator-controlled test

Gmail is not a substitute for an approved transactional-mail service, and account ownership or an SMTP acceptance does not authorize food operations. To try Gmail on a machine that can reach Google's SMTP servers:

1. Secure your Google account with 2-Step Verification. Google says [app passwords](https://support.google.com/mail/answer/185833) may be available for apps that do not support Google sign-in, but are not recommended in most cases; availability depends on account restrictions. This application currently supports authenticated SMTP, not Google OAuth. Never paste an app password, Google password, OAuth token or verification code into chat, GitHub, or an issue.
2. Generate local `.env` with `npm run setup:env` only if you do not already have one. Edit the ignored `.env` **privately** on the intended host. Set `SMTP_FROM` to your Gmail address and `SMTP_URL` using `smtps://` with your full Gmail address as the username, the app password as the password, `smtp.gmail.com` as the host, and port `465`. URL-encode special characters in the username and password (for example, encode `@` as `%40`); use the app password without display spaces. Do not commit `.env` or send it to anyone. Google's SMTP host and ports are documented [here](https://support.google.com/a/answer/176600). The local `npm run local:start` deliberately overrides SMTP to its test-only sink; it does **not** send Gmail.
3. First check connectivity without sending: `RUN_SMTP_VERIFY=true npm run smtp:verify`. To send a single opt-in diagnostic message to your own address, run `RUN_SMTP_VERIFY=true RUN_SMTP_SEND_TEST=true SMTP_TEST_TO=your-address@example.test npm run smtp:verify`, replacing the example with your controlled Gmail address. PowerShell: `$env:RUN_SMTP_VERIFY='true'; $env:RUN_SMTP_SEND_TEST='true'; $env:SMTP_TEST_TO='your-address@example.test'; npm run smtp:verify; Remove-Item Env:RUN_SMTP_VERIFY,Env:RUN_SMTP_SEND_TEST,Env:SMTP_TEST_TO`. The test contains no user records or login links. Inspect your inbox and spam; the SMTP server accepting the message does not guarantee delivery. Connection tests do not validate worker retries, provider limits, policy, or production deliverability.
4. For a deployed service, privately configure the worker and web environment with the same provider settings, require TLS, and test account verification/reset emails and failure/retry behavior with an authorized test user. Review provider quotas, terms, sender identity and monitoring. Prefer a dedicated transactional provider and organization-controlled sender for real deployments. Revoke test app passwords when no longer needed.

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

The GitHub Actions workflow in `.github/workflows/ci.yml` runs typecheck, lint, unit/migration tests, the public browser suite, dependency audits and a production build using generated ephemeral local-only configuration; it needs no repository secrets. Separate CI jobs are defined for disposable real-PostgreSQL/domain/auth checks, the authenticated browser handover, a Compose build/health smoke, and a Windows native launcher/authentication check. All five jobs passed on GitHub-hosted runners in [run 43392655106](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43392655106) at commit `584b48a`; results are limited to the synthetic smoke tests described below. `npm run test:e2e` starts the Next.js dev server automatically (and reuses a running local server outside CI). `setup:env` creates local config/secrets only; it does not start PostgreSQL or provide real records. The migration/security suite uses PGlite, a PostgreSQL-compatible embedded test engine. It does **not** replace integration tests against a real PostgreSQL server. The UI verification also used an isolated, disposable local PostgreSQL database; this does not validate Docker Compose or production services. Docker is unavailable in this sandbox, but the disposable Compose image/build/startup/health smoke passed on a GitHub-hosted Linux runner; validate your own host and deployment before relying on it.

### Real PostgreSQL domain integration test

This test creates fictional verified partners, Helpers and a fictitious approved food policy. It briefly enables operations **only in its own test process**. Never run it against a normal development, staging, pilot or production database; the database must be empty, local, disposable and named `annapurna_link_test`. Do not reuse it for real operations. The script checks these conditions and refuses to overwrite populated tables. It leaves its test data in place, so a second run requires a new empty isolated database. It does not test browser authentication or HTTP routes.

On a **separate disposable local PostgreSQL instance** and a fresh repository working directory, run `npm ci` and `npm run setup:env`. Before database setup, replace `annapurna_link` with `annapurna_link_test` in the generated `.env` (`POSTGRES_DB` and all four database URLs). Configure the temporary local `PG_ADMIN_URL` as described above, then:

```sh
npm run local:db:setup
npm run local:migrate
RUN_LOCAL_DOMAIN_TEST=true npm run test:local-domain
```

PowerShell: `$env:RUN_LOCAL_DOMAIN_TEST='true'; npm run test:local-domain; Remove-Item Env:RUN_LOCAL_DOMAIN_TEST`. The local setup refuses to overwrite existing roles; use a separate disposable PostgreSQL instance if the default Annapurna roles already exist. Drop that isolated test instance only after verifying it has no data you need. CI runs this test, the backup drill and the auth smoke test on a disposable PostgreSQL 16 service; these passed in the hosted run linked above.

The test exercises domain services using synthetic identities and the restricted application database role: onboarding/review, matching, competing Receiver reservations and Helper claims, pickup-window enforcement, assigned-Helper arrival, Receiver acceptance/inspection, OTP visibility/lock/replay, receipt and impact uniqueness, and a safety hold. It is **not** a substitute for browser end-to-end, complete RLS/security testing, human safety review, or production approval. `OPERATIONS_ENABLED=false` remains the default.

### Disposable PostgreSQL backup/restore drill

After running the domain integration test on a dedicated test instance, use matching-version `pg_dump` and `pg_restore` binaries on PATH and run `RUN_LOCAL_BACKUP_TEST=true npm run test:local-backup`. This creates and cleans up a separate throwaway restore database, refuses an existing target, and checks fictional records and selected permissions. See [`DATABASE.md`](DATABASE.md) for safety requirements and limitations; this is not a production backup or a private-upload recovery test.

### Disposable multi-role browser workflow

The separate `test:local-workflow` fixture runner tests real sign-ins and a synthetic Generator → Receiver → Helper handover in Chromium, including arrival, Receiver inspection, wrong-code handling, verification and receipt/impact. It seeds fictional verified organisations, Helpers, and an approved *test* policy directly in a fresh database. It does not demonstrate real approval, food safety, delivery, email or production readiness. **Use only a disposable, empty, local `annapurna_link_test` database** prepared and migrated as in the preceding section, with `OPERATIONS_ENABLED=false`, `APP_URL=http://localhost:3000` and port 3000 unused. The runner starts its own server bound to loopback and enables operations only for that subprocess. Do not expose it or use real accounts/data. A populated test database is refused; use a fresh disposable instance for every run and never drop a database without confirming it contains nothing needed.

```sh
npx playwright install chromium
RUN_LOCAL_WORKFLOW_TEST=true npm run test:local-workflow
```

PowerShell: `$env:RUN_LOCAL_WORKFLOW_TEST='true'; npm run test:local-workflow; Remove-Item Env:RUN_LOCAL_WORKFLOW_TEST`. Traces, screenshots and video are disabled for this test, but Playwright failure diagnostics may still contain page content or fictional one-time codes. Keep `test-results/` private, delete it after testing, and never upload it as an artifact. The browser uses a random fixture password provided only to the test subprocess. An optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and JSON array `PLAYWRIGHT_CHROMIUM_ARGS` can select a compatible locally installed browser; custom binaries/sandbox settings have their own security and compatibility risks. The standard Playwright install is preferred.

### Optional isolated PostgreSQL and authenticated browser checks

The opt-in integration tests use a throwaway, migrated local database with `OPERATIONS_ENABLED=false`. Never point them at a production or shared database. The authenticated test creates a random `example.test` account and a **pending** Helper request, verifies the email through a local-only SMTP sink, signs in, and checks that admin access remains denied. It does not approve anyone or create operational records.

1. Configure the four local database URLs and apply/check migrations:

   ```sh
   npm run local:migrate
   node --env-file=.env --import tsx scripts/check-db.ts
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

This repository is not approved for a real-world pilot or production use. Real food operations require a human-approved policy, partner verification and local legal/privacy/security review. Email credentials, domain/TLS, private-storage scanner, backup/restore and real PostgreSQL integration are additional deployment gates. See [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md), [`BUILD_STATUS.md`](BUILD_STATUS.md), [`BASELINE_AUDIT.md`](BASELINE_AUDIT.md) and [`DECISIONS/ADR-0001-public-restaurant-discovery.md`](DECISIONS/ADR-0001-public-restaurant-discovery.md).
