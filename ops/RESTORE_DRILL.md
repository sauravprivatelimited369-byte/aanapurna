# Restore drill

The gap register said "backups are scripted but the hosted restore is unproven". This is what
happened when it was actually attempted, and what now exists because of it.

## What was attempted

| Attempt | Result |
|---|---|
| Supabase database branch of the hosted project (`create_branch`, `restore-drill-2026-11-15`) | **Refused by the provider**: `Branching is supported only on the Pro plan or above` (`entitlement_required`, `branching_limit`). Nothing was created and nothing was changed. |
| `pg_dump` from this environment to the hosted database | **Not possible here**: this sandbox can only reach `github.com`, `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`. The project database is reachable only through the Supabase API, which speaks SQL, not dump/restore. |
| Applying every checked-in migration to an empty database | **Works**: `tests/database-migrations.test.ts` rebuilds the whole schema from zero in PGlite on every run. That proves the schema half of a restore and nothing about the data half. |

So the restore itself still needs one action from the project owner. What no longer needs an
owner is the ability to tell whether a restore was faithful.

## What now exists

1. **A recorded baseline** — `ops/backups/hosted-manifest-2026-11-15.json`, captured from the live
   database on 2026-11-15: 32 tables, 28 rows, schema fingerprint `5cfbf43a…`, 15 migrations,
   66 row-level-security policies.
2. **A manifest query** — `node scripts/verify-restore.mjs --sql`. It counts every table, fingerprints
   every column definition and counts the policies. It runs against any PostgreSQL database holding
   this schema.
3. **A comparator** — `node scripts/verify-restore.mjs --expected <baseline.json> --actual <restored.json>`.
   Exit code `1` means the restore is not faithful. Session, rate-limit and outbox counts are reported
   as notes, because they legitimately move between a backup and a check.
4. **Unit tests** — `tests/backup-manifest.test.ts` proves a faithful restore passes, and that a dropped
   row, a dropped table, a schema drift and a lost migration each fail.

## What the owner has to do (pick one)

**A. Pro plan branch.** Supabase dashboard → the project → *Branches* → create a branch from the
current data. Run `node scripts/verify-restore.mjs --sql` on the branch (SQL editor, or
`execute_query`), save the JSON, then run the comparator.

**B. Owner-run dump and restore.** From a machine that can reach the database:

```
pg_dump "$MIGRATION_DATABASE_URL" --format=custom --file=annapurna-$(date +%F).dump
createdb annapurna_restore
pg_restore --dbname=annapurna_restore annapurna-$(date +%F).dump
psql "$RESTORE_DATABASE_URL" -f <(node scripts/verify-restore.mjs --sql)
```

Then compare the two manifests as above.

**C. Restore into a throwaway free project.** Create a project, run `npm run db:migrate` against it,
restore the dump, then run the manifest query and compare.

## Until one of those is done

The honest statement is unchanged in one respect and improved in another: a restore has still not
been performed, so nobody can promise a recovery time. But a restore can now be *checked* in minutes
instead of being argued about, the baseline is recorded before there is real data to lose, and the
schema rebuild is proven on every test run.
