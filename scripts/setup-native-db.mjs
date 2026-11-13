// One-time bootstrap for a fresh, isolated local PostgreSQL server. Never use on shared/production databases.
import pg from "pg";

const { Client, escapeIdentifier, escapeLiteral } = pg;
const fail = (message) => { throw new Error(message); };

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.OPERATIONS_ENABLED === "true") fail("Native bootstrap is for isolated development only.");
  const adminUrl = process.env.PG_ADMIN_URL;
  if (!adminUrl) fail("Set PG_ADMIN_URL to a local PostgreSQL superuser connection URL (see README). Do not commit it.");
  const url = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) fail("PG_ADMIN_URL must point to a local PostgreSQL server.");
  const dbName = process.env.POSTGRES_DB;
  const migrator = process.env.POSTGRES_USER;
  if (!['annapurna_link', 'annapurna_link_test'].includes(dbName) || migrator !== 'annapurna_migrator') fail("Native bootstrap expects an isolated annapurna_link or annapurna_link_test database and the default migrator in .env.");
  const roles = [
    [migrator, process.env.POSTGRES_PASSWORD, true],
    ['annapurna_app', process.env.APP_DB_PASSWORD, false],
    ['annapurna_auth', process.env.AUTH_DB_PASSWORD, false],
    ['annapurna_worker', process.env.WORKER_DB_PASSWORD, false],
  ];
  for (const [, password] of roles) {
    if (!password || password === 'GENERATED_BY_SCRIPT') fail("Generate .env with npm run setup:env before bootstrapping.");
  }
  // Validate all destinations before creating any roles or databases.
  const host = (value) => value === 'localhost' || value === '[::1]' ? '127.0.0.1' : value;
  for (const [key, role, password] of [
    ['MIGRATION_DATABASE_URL', migrator, process.env.POSTGRES_PASSWORD],
    ['DATABASE_URL', 'annapurna_app', process.env.APP_DB_PASSWORD],
    ['AUTH_DATABASE_URL', 'annapurna_auth', process.env.AUTH_DB_PASSWORD],
    ['WORKER_DATABASE_URL', 'annapurna_worker', process.env.WORKER_DB_PASSWORD],
  ]) {
    const target = new URL(process.env[key]);
    if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.search || target.hash || host(target.hostname) !== host(url.hostname) || (target.port || '5432') !== (url.port || '5432') || decodeURIComponent(target.username) !== role || decodeURIComponent(target.password) !== password || decodeURIComponent(target.pathname.slice(1)) !== dbName) {
      fail(`${key} must match the local PostgreSQL server, role, password and database in .env.`);
    }
  }
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const admin = await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    if (!admin.rows[0]?.rolsuper) fail("PG_ADMIN_URL must use a local PostgreSQL superuser for initial setup.");
    const existing = await client.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [roles.map(([name]) => name)]);
    const database = await client.query("SELECT datname FROM pg_database WHERE datname = $1", [dbName]);
    if (existing.rowCount || database.rowCount) fail("An Annapurna database or role already exists. No changes were made; use an isolated PostgreSQL instance or inspect it manually. Never delete an existing database to retry without a backup.");
    await client.query('BEGIN');
    try {
      for (const [name, password, superuser] of roles) {
        await client.query(`CREATE ROLE ${escapeIdentifier(name)} LOGIN ${superuser ? 'SUPERUSER' : 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS'} PASSWORD ${escapeLiteral(password)}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    // CREATE DATABASE cannot run inside a transaction. If it fails, leave roles for manual inspection.
    await client.query(`CREATE DATABASE ${escapeIdentifier(dbName)} OWNER ${escapeIdentifier(migrator)}`);
  } finally {
    await client.end();
  }
  const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  const owner = new Client({ connectionString: ownerUrl.toString(), connectionTimeoutMillis: 5000 });
  await owner.connect();
  try {
    await owner.query(`GRANT CONNECT ON DATABASE ${escapeIdentifier(dbName)} TO annapurna_app, annapurna_auth, annapurna_worker`);
    await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await owner.query('GRANT USAGE ON SCHEMA public TO annapurna_app, annapurna_auth, annapurna_worker');
    await owner.query('CREATE SCHEMA IF NOT EXISTS graphile_worker AUTHORIZATION annapurna_worker');
    await owner.query('ALTER SCHEMA graphile_worker OWNER TO annapurna_worker');
    await owner.query('GRANT USAGE, CREATE ON SCHEMA graphile_worker TO annapurna_worker');
  } finally {
    await owner.end();
  }
  console.log('Local database and roles created. Next run npm run local:migrate, then npm run local:start.');
}

main().catch((error) => {
  console.error(`Native database setup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
