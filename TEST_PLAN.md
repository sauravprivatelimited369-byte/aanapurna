# Test plan and evidence

What is tested, how, and what the result was on the most recent run. A blank result means it was not
run; nothing in this file is marked PASS without an executed command.

Last full local run: commit `52e71ec`, **168 tests across 21 files**, typecheck and lint clean,
production build succeeds.

## Layers

| Layer | Tool | What it proves |
|---|---|---|
| Unit and contract | Vitest | Validation schemas, security headers, rate-limit logic, notification and navigation rules, public impact contract, launcher safety |
| Database and migration | Vitest + PGlite | All 16 migrations apply from empty; 26 tables have forced RLS; 12 required functions exist; role-level authorisation; append-only guards; new recall table constraints |
| Real PostgreSQL domain | `tests/integration/local-domain.ts` (`npm run test:local-domain`) | Concurrent claim, expiry, code consumption, receipts against a real server |
| Authentication | `scripts/test-local-auth.mjs`, `test-auth-security.mjs`, `test-auth-roles.mjs` | Signup, verify, login, reset, replay, forged cookies, CSRF, role routing |
| Hosted shape (no worker) | `scripts/test-hosted-shape.mjs` (`npm run test:hosted-shape`) | What the live site is: a web process with no worker beside it. Sign-up email, device notifications and operator second-factor enrolment, end to end over HTTP, against a push service that verifies the signature and decrypts the payload |
| Browser | Playwright (`tests/e2e`) | Public pages, accessibility snapshot, and the full local workflow |
| Hosted smoke | `scripts/hosted-smoke.mjs` | A deployed origin: health, registration, protection, drain authorization |
| Build and supply chain | `npm run build`, `npm audit` | The app compiles; no moderate+ advisory in the lockfile |

## Required cases and where they live

**Authentication** — registration validation and refusal of privileged fields
(`tests/validation-and-crypto.test.ts`); verification, reset and replay (`scripts/test-local-auth.mjs`);
suspended and forged-session handling (`scripts/test-auth-security.mjs`); rate limits
(`src/security/rate-limit.ts` covered by `tests/authorization.test.ts`).

**Tenant isolation** — RLS behaviour under the runtime role, including the denial of a status
change, in `tests/database-migrations.test.ts`; organisation access rules in
`tests/authorization.test.ts`.

**Dispatch concurrency** — two Helpers claiming one job: exactly one wins. Exercised in
`tests/integration/local-domain.ts` against a real PostgreSQL.

**Delivery code** — Receiver-only retrieval, Helper-cannot-fetch, wrong-code increment, attempt lock,
expiry, replay, single receipt: `tests/integration/local-domain.ts` plus the crypto suite.

**Recall (new)** — table catalogue assertions (RLS enabled, three policies, no delete policy or
grant, partial unique open-recall index, worker can insert its heartbeat while the app role can only
read it) in `tests/database-migrations.test.ts`; input rules in
`tests/recall-and-account-security.test.ts`. The end-to-end service path is covered by the same
transaction patterns as incidents and has not been exercised against a live database in this
sandbox — treat it as **UNVERIFIED** until `npm run test:local-domain` runs it.

**Account security (new)** — password-change and session-revocation schemas are unit-tested; the
routes call Better Auth directly and have **not** been exercised in a browser here.

**Worker heartbeat (new)** — pure evaluation logic and the upsert statement are unit-tested
(`tests/worker-heartbeat.test.ts`); the `service_health` privilege split is asserted in the migration
suite.

**Delivery without a worker (new, 2026-11-15)** — every other check that starts the application
starts the worker too, and the hosted site has none. `npm run test:hosted-shape` starts only a web
process, a mail server and a push service, refuses to run if a worker is connected, and nobody
calls the drain: a verification email and a push must arrive because the request that caused them
delivered them. It also covers a device whose browser has unsubscribed, a push service that is
failing, a shared phone, older undeliverable mail in the way, and what the web role can reach with
no session. Underneath it, `tests/push-pipeline.test.ts` and `tests/outbox-backlog.test.ts` run the
claim, lease, retry and backlog rules against the real migrations, and `tests/inline-delivery.test.ts`
and `tests/worker-drain-route.test.ts` pin the pass itself and the drain route. **Not covered
anywhere:** a real push service, a real permission prompt, and whether the host keeps a function
alive after its response — the last is reported by `/api/health` under `delivery` once deployed.

## Status board

| Suite | Local result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | clean |
| `npm run lint` | PASS | clean |
| `npm test` | PASS | 168 / 168 |
| `npm run build` | PASS | 44 routes, `/preview` static |
| Playwright | NOT RUN here | Browser download blocked in this sandbox; the same suite ran green in CI |
| `npm run test:local-domain` | NOT RUN here | Needs a real PostgreSQL; available in CI |
| `npm run test:hosted-shape` | PASS (2026-11-15) | 37 expectations, on PostgreSQL 16.15 and 17.11; also CI job `hosted-shape` |
| `scripts/hosted-smoke.mjs` | NOT RUN after the latest deploy | Last recorded run: 9/9 |
| Restore drill | NOT RUN | Script exists, no successful restore observed |

## What this plan cannot prove

- That a real organisation can be verified correctly — that is a human process.
- That mail is delivered — the current transport is a capture inbox.
- That the deployment survives a worker outage for days — only the heartbeat makes it visible.
- Accessibility beyond automated checks — keyboard and screen-reader passes by a person are still
  required.

## Adding a case

Any new state transition needs: an authorisation test (a caller without the role is refused), a
validation test (a malformed request is refused), a database test (the constraint exists), and one
happy path. A test that only exercises the happy path is treated as incomplete.
