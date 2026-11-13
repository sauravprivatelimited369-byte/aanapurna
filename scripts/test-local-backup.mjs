// TEST ONLY: backup fictional fixtures on a dedicated loopback database and restore to a new throwaway database.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

if (process.env.RUN_LOCAL_BACKUP_TEST !== 'true' || process.env.NODE_ENV === 'production' || process.env.OPERATIONS_ENABLED !== 'false') {
  throw new Error('This test requires explicit opt-in, disabled operations and a disposable development PostgreSQL instance.');
}
const source = new URL(process.env.MIGRATION_DATABASE_URL ?? 'invalid:');
if (!['postgres:', 'postgresql:'].includes(source.protocol) || !['localhost', '127.0.0.1'].includes(source.hostname) || source.pathname !== '/annapurna_link_test' || source.search || source.hash || decodeURIComponent(source.username) !== 'annapurna_migrator') {
  throw new Error('MIGRATION_DATABASE_URL must point to the disposable local annapurna_link_test database with its migrator role.');
}
const restoredName = 'annapurna_link_restore_test';
const restoredUrl = new URL(source);
restoredUrl.pathname = `/${restoredName}`;
const sourceDb = new pg.Client({ connectionString: source.toString(), connectionTimeoutMillis: 5000 });
let created = false;
let dir;
try {
  await sourceDb.connect();
  const superuser = await sourceDb.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user');
  assert.equal(superuser.rows[0]?.rolsuper, true, 'A disposable test instance with the local migrator is required.');
  const fixture = await sourceDb.query(`SELECT
    (SELECT count(*)::int FROM public.donations) AS donations,
    (SELECT count(*)::int FROM public.delivery_receipts) AS receipts,
    (SELECT count(*)::int FROM public.delivery_jobs WHERE inspection_confirmed_at IS NOT NULL) AS inspections,
    (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations`);
  assert(fixture.rows[0].donations > 0 && fixture.rows[0].receipts > 0 && fixture.rows[0].inspections > 0, 'Run the fictional local domain integration test first.');
  assert.equal(Number((await sourceDb.query("SELECT count(*) FROM public.\"user\" WHERE email NOT LIKE '%@example.test'")).rows[0].count), 0, 'Only fictional example.test users are allowed.');
  assert.equal((await sourceDb.query('SELECT 1 FROM pg_database WHERE datname=$1', [restoredName])).rowCount, 0, 'Restore target already exists; nothing will be overwritten.');
  dir = await mkdtemp(join(tmpdir(), 'annapurna-backup-test-'));
  const file = join(dir, 'fictional-test.dump');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
  Object.assign(env, { PGHOST: source.hostname, PGPORT: source.port || '5432', PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password), PGSSLMODE: 'disable' });
  function run(binary, args) {
    const result = spawnSync(binary, args, { env, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`${binary} failed; check the installed PostgreSQL client version and server logs.`);
  }
  run(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--file', file, '--dbname', 'annapurna_link_test']);
  await sourceDb.query(`CREATE DATABASE ${pg.escapeIdentifier(restoredName)} TEMPLATE template0`);
  created = true;
  run(process.env.PG_RESTORE_BIN || 'pg_restore', ['--exit-on-error', '--dbname', restoredName, file]);
  const restored = new pg.Client({ connectionString: restoredUrl.toString(), connectionTimeoutMillis: 5000 });
  await restored.connect();
  try {
    const values = await restored.query(`SELECT
      (SELECT count(*)::int FROM public.donations) AS donations,
      (SELECT count(*)::int FROM public.delivery_receipts) AS receipts,
      (SELECT count(*)::int FROM public.delivery_jobs WHERE inspection_confirmed_at IS NOT NULL) AS inspections,
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations`);
    assert.deepEqual(values.rows[0], fixture.rows[0], 'Restored records and migrations must match.');
    const security = await restored.query(`SELECT
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.donations'::regclass) AS donations_rls,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.delivery_codes'::regclass) AS codes_rls,
      has_table_privilege('annapurna_app','public.donations','SELECT') AS app_select,
      (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='graphile_worker') AS worker_owner`);
    assert.deepEqual(security.rows[0], { donations_rls: true, codes_rls: true, app_select: true, worker_owner: 'annapurna_worker' });
  } finally { await restored.end(); }
  console.log('PASS: fictional PostgreSQL dump and clean restore; receipt, inspection, migration counts, selected RLS/grants and worker schema ownership match.');
} finally {
  try {
    if (created) await sourceDb.query(`DROP DATABASE ${pg.escapeIdentifier(restoredName)} WITH (FORCE)`);
  } finally {
    await sourceDb.end().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
