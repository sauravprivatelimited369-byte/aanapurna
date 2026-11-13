# Database implementation and limits

PostgreSQL is the source of truth. The repository contains the Drizzle schema in `src/db/schema.ts` and eleven ordered SQL migrations in `drizzle/`; migration metadata is in `drizzle/meta/`. GitHub stores these definitions, **not** the running database or its private records. The database needs a persistent PostgreSQL server and an independently protected backup. Migration 11, `20261113190000_auth_registration_and_guards.sql`, adds transient Better Auth intake columns, the RLS-protected `registration_profiles` table, an `account_status`/`demo_account` guard trigger, and a session-expiry index. It is additive: no existing row is rewritten.

## Existing model

- Better Auth users, accounts, sessions, verifications and rate limits; user profiles and platform roles.
- Organisations, memberships, service areas, helper profiles and policy versions.
- Donations, private donation details, offers, delivery jobs, private destination snapshots, encrypted delivery codes, custody events and receipts.
- Audit events, notifications, encrypted email outbox, support cases, safety incidents, private-document metadata and data requests.

Consult the schema and migrations for fields, foreign keys, unique constraints and indexes; this is a summary, not a claim that every requested product entity or policy workflow is implemented. Private file contents are stored separately from the database. Do not commit real data, exports, document files, keys or `.env` to GitHub.

## Roles and access

The local setup and Compose create separate `annapurna_app`, `annapurna_auth`, and `annapurna_worker` logins without superuser or BYPASSRLS privileges. The migration role is privileged and must not be used by the web app. RLS and grants are defined in the SQL migrations; `withUserContext` sets `app.user_id` transaction-locally to avoid pooled-connection identity leakage. Explicit domain authorization remains necessary alongside RLS. `npm run db:check` with database variables exported (or `node --env-file=.env --import tsx scripts/check-db.ts`, or the native start check) validates selected role properties, migration count and RLS presence; it is not a complete authorization audit. Some PGlite role/policy tests exist. Actual cross-tenant, OTP, privileged access and concurrent state-transition tests still require comprehensive real-PostgreSQL coverage.

## Migrations and retention

Run `npm run local:migrate` on a native development instance, or `docker compose run --rm migrate` with Compose. Migrations must be reviewed before use in any shared or production environment. Do not use schema push as a production deployment method. Neither the repository nor a GitHub workflow replaces encrypted, access-controlled database and upload-volume backups and a tested restoration. Retention, legal holds, erasure, review of all records and operational policies remain owner/legal decisions; no production retention schedule is implied.


## Disposable backup/restore drill

For an isolated local `annapurna_link_test` database containing **only fictional fixtures**, first run the guarded domain integration test described in the README. Install PostgreSQL client tools (`pg_dump` and `pg_restore`) at least as new as the source server, make them available on PATH, and run `RUN_LOCAL_BACKUP_TEST=true npm run test:local-backup` (PowerShell: `$env:RUN_LOCAL_BACKUP_TEST='true'; npm run test:local-backup; Remove-Item Env:RUN_LOCAL_BACKUP_TEST`). This opt-in test uses a private temporary custom-format dump and creates `annapurna_link_restore_test` on the same loopback PostgreSQL instance. It refuses an existing restore target, verifies selected record counts, RLS/grants and worker schema ownership, then drops only the database it created and deletes the temporary dump. If interrupted, inspect the isolated server and temporary directory manually. Never use it with real data or a shared server. Optional `PG_DUMP_BIN` and `PG_RESTORE_BIN` select client executables.

A successful synthetic drill is **not** a production recovery plan: a real operator must separately arrange encrypted off-host database and private-upload backups, protected keys, roles/secrets, retention and legal holds, point-in-time recovery where needed, and regular restoration on an isolated host. Custom-format dumps contain sensitive data, and roles/passwords, upload contents and external configuration are not included. Define recovery objectives, verify access and permissions, and document full restore steps before launch. Never run `pg_restore` against a production database without a reviewed recovery procedure and explicit authorization.
