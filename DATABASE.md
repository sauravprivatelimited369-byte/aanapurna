# Database implementation and limits

PostgreSQL is the source of truth. The repository contains the Drizzle schema in `src/db/schema.ts` and twenty-one ordered SQL migrations in `drizzle/`; migration metadata is in `drizzle/meta/`. GitHub stores these definitions, **not** the running database or its private records. The database needs a persistent PostgreSQL server and an independently protected backup. Migration 11, `20261113190000_auth_registration_and_guards.sql`, adds transient Better Auth intake columns, the RLS-protected `registration_profiles` table, an `account_status`/`demo_account` guard trigger, and a session-expiry index. It is additive: no existing row is rewritten. Migration 12,
`20261114120000_revoke_public_api_privileges.sql`, removes every table, sequence
and function privilege held by Supabase's `anon` and `authenticated` PostgREST
roles and resets the matching default privileges, so a future object cannot
inherit them. It is guarded so it is a no-op on plain PostgreSQL, where those
roles do not exist. Migration 14, `20261115090000_helper_dispatch_and_escalation.sql`, adds the
Helper dispatch fan-out (`app_notify_area_helpers`), the idempotent backlog and evidence-expiry
sweep (`app_escalate_delivery_backlog`), the two bookkeeping columns those functions own
(`delivery_jobs.escalated_at`, `private_documents.expiry_notified_at`), and one narrow additional
state transition: operations may release an uncollected assignment (`assigned -> open`). The columns
are deliberately not granted to the application role; only the `SECURITY DEFINER` functions write
them. `npm run db:check` now requires both functions and at least fourteen migrations. Migration 17,
`20261115180000_owner_attestations_and_launch_gate.sql`, adds the two tables that hold owner
declarations no query can verify — `platform_attestations` (legal entity, insurance, data-protection
contact, penetration test, each with an evidence reference, the administrator who recorded it and an
expiry) and `on_call_shifts` (the rota) — with `FORCE ROW LEVEL SECURITY` on both and write policies
restricted to `operations_admin`/`security_admin` inside a domain transition. Four `SECURITY DEFINER`
readers expose only what each caller is entitled to: `app_launch_readiness()` returns five booleans,
`app_on_call_coverage()` returns coverage without identities, `app_public_data_protection_contact()`
and `app_legal_entity()` return the published contact and entity, and each returns nothing until a
declaration exists. `app_on_call_person(email)` resolves a rota entry to an account id without
granting the application role sight of `public."user"`. Migration 18,
`20261115193000_readiness_escalation.sql`, adds `platform_attestations.renewal_reminded_at` and
`app_escalate_platform_readiness(horizon_days)`, which notifies the administrators a declaration is
lapsing and announces a rota with nobody on it for the next twelve hours — once per lapse window,
and only when somebody actually received the notice, so an unstaffed deployment is reported rather
than quietly marked as warned.

Migration 20, `20261115230000_food_safety_attestation_and_recovery.sql`, adds the record behind four
of the questions a Receiver asks. The arrival inspection becomes structure rather than prose: five
columns on `delivery_jobs` (seal, packaging, label, window, temperature, plus a photo fingerprint),
all nullable together or present together, guarded by the existing inspection trigger now extended to
watch them and by three CHECK constraints. `food_safety_incidents` gains `harm_reported`,
`harm_details`, `corrective_action` and its owner, with a CHECK that harm cannot be recorded without a
description and a closure cannot exist without a correction. `organizations` gains an insurance
declaration and an agreement pointer, both paired and non-backdatable. Two new tables follow the
established pattern — `FORCE ROW LEVEL SECURITY`, no DELETE grant, no policy for the anonymous party —
`partner_agreement_acceptances` (immutable evidence, unique per organisation and version) and
`account_recovery_requests` (an unauthenticated intake readable only by platform roles).
`app_notify_platform_roles` fans a harm notification out to named role holders without letting the
caller address a person, `app_current_agreement_version` publishes the agreement version, and
`app_launch_readiness()` grows from five booleans to seven so partner cover and acceptance are part of
the gate rather than a paragraph.

## Existing model

- Better Auth users, accounts, sessions, verifications and rate limits; user profiles and platform roles.
- Organisations, memberships, service areas, helper profiles and policy versions.
- Donations, private donation details, offers, delivery jobs, private destination snapshots, encrypted delivery codes, custody events and receipts.
- Audit events, notifications, encrypted email outbox, support cases, safety incidents, private-document metadata and data requests.
- Owner declarations and the on-call rota (migration 17), plus the seeded `geo_places` gazetteer (migration 16).

Consult the schema and migrations for fields, foreign keys, unique constraints and indexes; this is a summary, not a claim that every requested product entity or policy workflow is implemented. Private file contents are stored separately from the database. Do not commit real data, exports, document files, keys or `.env` to GitHub.

## Roles and access

The local setup and Compose create separate `annapurna_app`, `annapurna_auth`, and `annapurna_worker` logins without superuser or BYPASSRLS privileges. The migration role is privileged and must not be used by the web app. Because every policy-bearing table is now `FORCE ROW LEVEL SECURITY` (migration 16), the migration role - which owns the tables in the native topology - is created with `BYPASSRLS`, matching the hosted project where the owner `postgres` has it. An existing native database created before migration 16 must be recreated from a fresh instance, because a role cannot grant itself `BYPASSRLS`. RLS and grants are defined in the SQL migrations; `withUserContext` sets `app.user_id` transaction-locally to avoid pooled-connection identity leakage. Explicit domain authorization remains necessary alongside RLS. `npm run db:check` with database variables exported (or `node --env-file=.env --import tsx scripts/check-db.ts`, or the native start check) validates selected role properties, migration count and RLS presence; it is not a complete authorization audit. Some PGlite role/policy tests exist. Actual cross-tenant, OTP, privileged access and concurrent state-transition tests still require comprehensive real-PostgreSQL coverage.

## Migrations and retention

Run `npm run local:migrate` on a native development instance, or `docker compose run --rm migrate` with Compose. Migrations must be reviewed before use in any shared or production environment. Do not use schema push as a production deployment method. Neither the repository nor a GitHub workflow replaces encrypted, access-controlled database and upload-volume backups and a tested restoration. Retention, legal holds, erasure, review of all records and operational policies remain owner/legal decisions. What migration 21 adds is the mechanism, not the policy: the windows are a single row that a human sets, and the process that obeys it is enforced.

### What is enforced (migration 21)

| Object | What it does |
|---|---|
| `data_retention_settings` | One row (`id = 1`, enforced by CHECK) holding the six windows. The defaults are 90 days for read notifications, 1 day for spent one-time codes, 30 days for expired delivery codes, 730 days for closed incident free text, 30 days for failed email dead letters, and 6 years for audit free text. `audit_years` cannot be set below 1 or above 25. |
| `retention_holds` | A legal hold scoped to a user, organisation, delivery job or donation. An active hold outranks every window. The scope and the populated column must agree (CHECK). A release is all-or-nothing and needs a reason (CHECK). The table has no DELETE grant and a `USING (false)` DELETE policy, so a hold is history once placed. |
| `data_scrub_log` | One row per action, including dry runs and hold-skips. The application role has `SELECT` only; the sweep writes through a `SECURITY DEFINER` function. |
| `app_apply_retention(boolean)` | The whole sweep in one transaction. `true` previews and writes only the log rows. A hold is filtered before the delete, so preview counts equal applied counts. |
| `app_redact_user(text, text)` | Fulfils an erasure request by overwriting identifying columns and deleting credentials, while keeping receipts, custody events and the audit trail. Records an `identity.redacted` audit row. |

`npm run retention -- --dry-run` previews and `npm run retention` applies; the worker runs the same function nightly at 03:15 IST on the `apply-retention` task.

### Two deliberate limits

**Audit rows are never deleted.** `audit_events` has been append-only since migration 3. Migration 21 does not weaken that: it replaces the blanket guard with one that permits exactly one shape of change, and only when the transaction sets `app.retention_scrub` locally — `details` may only become `{}`, `reason` may only become `'[scrubbed]'`, and every identity and timestamp column must be unchanged. Past the audit window the trail keeps who did what, when and to which record, and loses the prose. `tests/database-migrations.test.ts` proves a content rewrite, an actor change and a delete are all still refused.

**The windows are maximums, not targets.** Nothing is deleted early, and a row on hold is never deleted at all. Whether 90 days for a notification is the right number is an owner and legal decision; the repository only guarantees that whatever number is set is the number enforced.


## Disposable backup/restore drill

For an isolated local `annapurna_link_test` database containing **only fictional fixtures**, first run the guarded domain integration test described in the README. Install PostgreSQL client tools (`pg_dump` and `pg_restore`) at least as new as the source server, make them available on PATH, and run `RUN_LOCAL_BACKUP_TEST=true npm run test:local-backup` (PowerShell: `$env:RUN_LOCAL_BACKUP_TEST='true'; npm run test:local-backup; Remove-Item Env:RUN_LOCAL_BACKUP_TEST`). This opt-in test uses a private temporary custom-format dump and creates `annapurna_link_restore_test` on the same loopback PostgreSQL instance. It refuses an existing restore target, verifies selected record counts, RLS/grants and worker schema ownership, then drops only the database it created and deletes the temporary dump. If interrupted, inspect the isolated server and temporary directory manually. Never use it with real data or a shared server. Optional `PG_DUMP_BIN` and `PG_RESTORE_BIN` select client executables.

A successful synthetic drill is **not** a production recovery plan: a real operator must separately arrange encrypted off-host database and private-upload backups, protected keys, roles/secrets, retention and legal holds, point-in-time recovery where needed, and regular restoration on an isolated host. Custom-format dumps contain sensitive data, and roles/passwords, upload contents and external configuration are not included. Define recovery objectives, verify access and permissions, and document full restore steps before launch. Never run `pg_restore` against a production database without a reviewed recovery procedure and explicit authorization.
