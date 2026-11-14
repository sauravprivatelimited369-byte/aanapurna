# Hosted preview: Supabase PostgreSQL + Vercel

**Status: provisioned preview, not production-ready.** This document records what
the authorized Supabase and Vercel connectors actually created, what remains
owner-only, and the evidence gathered. No secret value is printed here or
committed to Git.

## Architecture decision

Supabase is used **only as a managed PostgreSQL host**. Supabase Auth is not
used; Better Auth remains the application's only authentication system, with its
own `user`, `session`, `account`, `verification` and rate-limit tables. Vercel
hosts the Next.js **web** application only. The Graphile Worker that drains the
encrypted `email_outbox` is a long-running process and is **not** deployed as a
Vercel serverless function; it still needs a separate long-running host before
verification/reset email can actually be delivered.

## Provisioned resources (identifiers only)

| Resource | Identifier | Notes |
| --- | --- | --- |
| Supabase organization | `cqqcyisituovlwepjvzs` | existing org |
| Supabase project | `wlpibnftabirwtziwubv` | new `annapurna-link-hosted`, `ap-south-1`, PostgreSQL 17, `ACTIVE_HEALTHY` |
| Supabase DB host | `db.wlpibnftabirwtziwubv.supabase.co` | direct connection, SSL required |
| Existing paused Supabase project | `xbwbejejjswbveaueqya` | left untouched |
| Vercel team | `team_mAUU3kiruUaeDwNSjViG0cQK` | `writer-nation`, Hobby plan |
| Vercel project | `prj_ioMsFVvCdLPvelL6gURUChyoiboJ` | `aanapurna-link-preview`, linked to `sauravprivatelimited369-byte/aanapurna` |
| Vercel alias | `aanapurna-link-preview.vercel.app` | HTTPS, no custom domain |
| GitHub repository ID | `1454978516` | used for the Vercel Git source |

The Supabase project's `postgres` role was used as the migrator role; three
additional `NOBYPASSRLS` login roles were created (`annapurna_app`,
`annapurna_auth`, `annapurna_worker`). `REVOKE CREATE ON SCHEMA public FROM
PUBLIC`, `USAGE` grants, a `graphile_worker` schema and the `drizzle`
migrations table were applied through the connector. Eleven placeholder hash
rows were initially inserted without DDL; they were later **removed** so the
Vercel build command `npm run db:migrate && npm run db:check && npm run build`
can apply the repository's real Drizzle/Graphile Worker migrations and verify
them. The hosted database currently has **zero** app tables and zero migration
rows until that build succeeds.

## Environment variables

Thirty Vercel project variables were set for `production`, `preview` and
`development`: the four database role URLs, `DATABASE_SSL=true`, `AUTH_SECRET`,
three base64 32-byte keys, `APP_URL`, `APP_DOMAIN`, `NODE_ENV`,
`OPERATIONS_ENABLED=false`, `FILE_SCAN_MODE=disabled`,
`ALLOW_TEST_DOMAINS=false`, `PRIVATE_STORAGE_DIR`, pool limits, telemetry, and
the Gmail SMTP fields. Connection URLs and generated secrets are `encrypted`
Vercel env vars; non-secret settings are `plain`. The Vercel Hobby plan marks
encrypted values as `readable-secret`, so a real production launch should use
Sensitive Environment Variables / a higher plan or an external secret store.
All 25 create calls succeeded, but the connector's list/get responses are
truncated; a complete name-only verification of the full set is **unavailable**
through this connector. The visible start/end portions confirm the new SMTP,
pool, storage and flag variables plus several encrypted secrets.

`package.json` `engines.node` is `22.x`, which overrides the Vercel project's
default Node `26.x` selection for new deployments; `.nvmrc` remains `22`. Vercel
documents this override in [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
The Vercel connector does not expose the project `nodeVersion` property, so the
repository-level override is used instead.

Supabase's direct `db.<ref>.supabase.co` endpoint is IPv6-only, while Vercel's
build network has no IPv6 route; the third deployment's improved diagnostics
showed `connect ENETUNREACH` to an IPv6 address. The repository keeps the four
encrypted direct role URLs and rewrites them at runtime to Supabase's shared
**session pooler** (`<role>.<ref>@<pooler-host>:5432`), which is IPv4 and
supports migrations/prepared statements. Supabase documents the session pooler
format in [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres).
Five additional plain, non-secret Vercel variables enable this:
`DATABASE_URL_REWRITE_TO_POOLER=true`, `SUPABASE_POOLER_HOST`,
`SUPABASE_PROJECT_REF`, `DATABASE_POOLER_PORT=5432`, and
`DATABASE_CONNECT_TIMEOUT_MS=30000`. No password is rewritten, logged or
committed; `src/lib/database-config.ts` performs the URL transform.

The fourth deployment then reached the pooler but failed with
`SELF_SIGNED_CERT_IN_CHAIN`: Supabase's pooler chain is rooted in its private
`Supabase Root 2021 CA`, which is not in Node's default trust store. The public
root certificate is reviewed at `certs/supabase-prod-ca-2021.crt`, embedded as
a TypeScript constant in `src/lib/supabase-ca.ts`, and pinned with
`rejectUnauthorized: true` for Supabase hosts only. Its SHA-256 fingerprint is
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
URL SSL query parameters are stripped so `pg` cannot override that explicit,
verifying TLS configuration. No certificate verification is disabled.

The fifth deployment cleared the certificate error and failed one step later with
`(ENOTFOUND) tenant/user postgres.wlpibnftabirwtziwubv not found | code: XX000`.
Supabase's [troubleshooting note](https://supabase.com/docs/guides/troubleshooting/tenant-or-user-not-found)
explains that this is the shared pooler failing to match the host and username to
a project, so the previously guessed `aws-0` cluster index was the problem, not
the password. The `[INDEX]` in `aws-[INDEX]-[REGION].pooler.supabase.com` is a
cluster index that cannot be derived from the region, and the Dashboard Connect
dialog is the authoritative source. For this project the region advertises two
cluster hosts; the non-secret `SUPABASE_POOLER_HOST` value was corrected to the
second one (`aws-1-ap-south-1.pooler.supabase.com`) and the sixth deployment
connected successfully, so no password reset was needed. Copy the Session
pooler host from the dashboard if the project is ever recreated.

The sixth deployment `dpl_8hb33FC4GP2eLbqn8fPSNgawPWZK` confirmed the database
path end to end: `database.migration_identity` reported `databaseRole: "postgres"`
with `canCreateSchema: true`, the eleven Drizzle migrations applied, Graphile
Worker's schema migrated, and `npm run db:check` returned
`rowLevelSecurityTables: 23`, `requiredFunctions: 10`, `appliedMigrations: 11`,
`problems: []`. The hosted database is migrated and app-ready.

That same build then failed at `next build`'s TypeScript check: `npm ci` ran with
`NODE_ENV=production`, so npm omitted dev-only packages (184 installed instead of
480) and `tests/e2e/*.spec.ts` could not resolve `@axe-core/playwright`, which
cascaded into implicit-`any` errors. `vercel.json` now pins
`"installCommand": "npm ci --include=dev"`, which Vercel documents as overriding
the project's install command. Reproduced in a clean copy of the repository:
production-mode `npm ci` plus `npm run typecheck` fails with the same 18 errors,
and production-mode `npm ci --include=dev` plus typecheck passes.

`SMTP_PASS` currently contains the deliberate placeholder name
`REPLACE_WITH_GMAIL_APP_PASSWORD`, not a credential. The fail-closed preflight
and `/api/health` therefore report email `not_configured` until the owner
replaces it. Vercel injects `VERCEL_URL` automatically; `src/lib/auth.ts` trusts
that exact preview origin in addition to `APP_URL`.

## Owner-only remaining steps

1. In **Vercel → project → Settings → Environment Variables**, replace
   `SMTP_PASS` with a Gmail/Workspace 16-character App Password for
   `sauravprivatelimited369@gmail.com`. Do not paste it in chat, commit it, or
   put it in a public variable. Keep `SMTP_HOST=smtp.gmail.com`,
   `SMTP_PORT=465`, `SMTP_SECURE=true`.
2. Provision a long-running worker host with the same encrypted environment and
   run `npm run worker`. The Vercel web preview does not drain the outbox.
3. Add a custom domain in Vercel, configure DNS, and update `APP_URL` and
   `APP_DOMAIN` to that domain. The current `.vercel.app` alias is a preview
   hostname, not an owner-controlled production domain.
4. Run `npm run check:production-config`, then opt-in
   `RUN_SMTP_VERIFY=true npm run smtp:verify` on the intended host. Verify a
   real signup, email verification, password reset, session revocation and
   worker retry/recovery before any pilot.
5. Complete backup/restore, monitoring, independent security review, and the
   human food-safety, legal, privacy and launch approvals in
   `LAUNCH_CHECKLIST.md`. Keep `OPERATIONS_ENABLED=false` until then.

## Evidence and limits

- Supabase `get_project`: `ACTIVE_HEALTHY`; `get_project_health` for `db`:
  healthy. `execute_query` confirmed `current_user=postgres`,
  `can_create_db=true`, `can_create_role=true`, `public_create=true`.
- Supabase `execute_query` bootstrap: three least-privilege roles, schema
  grants, `drizzle.__drizzle_migrations` and eleven rows. The full migration SQL
  is applied by the Vercel build, not by a committed secret.
- Vercel `create_project`, `list_project_domains`, `list_env_vars`: project,
  alias and variables confirmed. `SMTP_PASS` placeholder is intentionally
  rejected by the preflight until replaced.
- Local checks: `npm run typecheck`, `npm run lint`, `npm test` (105 tests),
  `npm run build`, `git diff --check`, positive `SMTP_URL` preflight, positive
  discrete-SMTP preflight, Vercel-shape preflight with a synthetic app password,
  and negative missing/placeholder preflights — **PASS**.
- CI history: [run 43502286365](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43502286365)
  and [run 43559912589](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43559912589)
  passed all six synthetic jobs. [Run 43561700577](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43561700577)
  failed only the Windows one-click job with the known managed-launcher port
  race; the other five jobs passed. [Run 43565517517](https://github.com/sauravprivatelimited369-byte/aanapurna/actions/runs/43565517517)
  passed all six jobs after the workflow began killing surviving loopback port
  owners explicitly.
- Vercel deployment `dpl_Cmy8iuLunrJBTQjMyLu5PC9AhkAy` was created from the
  active branch with `nodeVersion: 22.x` and the configured build command, but
  **FAILED** at `npm ci` because a deprecated nested esbuild install script
  found the wrong hoisted binary version. Deployment
  `dpl_DnnnypMoh4bQoxHXxSDPsuPENuVt` **PASSed `npm ci`** with the global
  `esbuild@0.28.2` override, then **FAILED** in `db:migrate` at Drizzle's
  `CREATE SCHEMA IF NOT EXISTS "drizzle"` wrapper. Deployment
  `dpl_61rMtBmsNA3otoQkZRkd9fxesYwX` exposed the real cause with the improved
  diagnostics: `connect ENETUNREACH` to the IPv6-only Supabase direct DB host.
  Deployment `dpl_Dj5yktvKxvTnxfnABuHMe7Z8ky7Q` reached the IPv4 session
  pooler but failed with `SELF_SIGNED_CERT_IN_CHAIN`; the reviewed public
  Supabase root CA and strict TLS verification removed that error. Deployment
  `dpl_5UZBV3KPPAaLXvSCEEjHHEPy1mRk` then failed with
  `tenant/user postgres.wlpibnftabirwtziwubv not found`, which exposed the
  guessed pooler cluster index; after correcting the host, deployment
  `dpl_8hb33FC4GP2eLbqn8fPSNgawPWZK` applied all eleven migrations and passed
  `db:check` (`23` RLS tables, `10` functions, `11` migrations, no problems)
  before failing its TypeScript step because production-mode `npm ci` omitted
  dev-only test dependencies. The install command is now `npm ci --include=dev`;
  no deployment has reached `READY` yet.
- GitHub Actions repository secrets could **not** be set by the integration
  (`403 Resource not accessible by integration`). Migrations are therefore run
  by the Vercel build command instead of a GitHub Actions secret-based job.
- Synthetic CI, a preview deployment, and a fail-closed preflight are **not**
  production validation. No custom domain, real SMTP delivery, independent
  security review, backup/restore exercise, real-operations readiness, or human
  launch approval is claimed.
