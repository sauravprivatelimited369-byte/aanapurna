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
PUBLIC`, `USAGE` grants, a `graphile_worker` schema, the `drizzle` migrations
table and eleven migration rows were applied through the connector. The Vercel
build command `npm run db:migrate && npm run db:check && npm run build` applies
the repository's real Drizzle/Graphile Worker migrations and verifies them.

## Environment variables

Twenty-five Vercel project variables were set for `production`, `preview` and
`development`: the four database role URLs, `DATABASE_SSL=true`, `AUTH_SECRET`,
three base64 32-byte keys, `APP_URL`, `APP_DOMAIN`, `NODE_ENV`,
`OPERATIONS_ENABLED=false`, `FILE_SCAN_MODE=disabled`,
`ALLOW_TEST_DOMAINS=false`, `PRIVATE_STORAGE_DIR`, pool limits, telemetry, and
the Gmail SMTP fields. Connection URLs and generated secrets are `encrypted`
Vercel env vars; non-secret settings are `plain`. The Vercel Hobby plan marks
encrypted values as `readable-secret`, so a real production launch should use
Sensitive Environment Variables / a higher plan or an external secret store.

`package.json` `engines.node` is `22.x`, which overrides the Vercel project's
default Node `26.x` selection for new deployments; `.nvmrc` remains `22`. Vercel
documents this override in [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
The Vercel connector does not expose the project `nodeVersion` property, so the
repository-level override is used instead.

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
  race; the other five jobs passed. The workflow now kills surviving loopback
  port owners explicitly. A fresh CI run after this push is required; record its
  result in `BUILD_STATUS.md` before launch.
- GitHub Actions repository secrets could **not** be set by the integration
  (`403 Resource not accessible by integration`). Migrations are therefore run
  by the Vercel build command instead of a GitHub Actions secret-based job.
- Synthetic CI, a preview deployment, and a fail-closed preflight are **not**
  production validation. No custom domain, real SMTP delivery, independent
  security review, backup/restore exercise, real-operations readiness, or human
  launch approval is claimed.
