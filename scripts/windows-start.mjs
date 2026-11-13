// Managed, loopback-only PostgreSQL for local development. Never touches existing DBs.
// This supervisor is started by start.bat / ./start.sh through
// scripts/launch-setup.mjs; it refuses to download packages itself so all
// network work happens behind the launcher's explicit y/n consent.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { APP_URL, INBOX_PATH, openUrl, parseInbox, probeHealth } from './launch-support.mjs';

const port = 55432;
const inboxUrl = 'http://127.0.0.1:2527/';
const healthUrl = 'http://127.0.0.1:3000/api/health';
const marker = resolve('.local-data/managed-postgres.json');
const data = resolve('.local-data/postgres');
const envFile = resolve('.env');
const autoOpen = process.env.ANNAPURNA_LAUNCH_OPEN === '1';
let postgres;
let application;
let stopping = false;
let readinessTimer;
let readyAnnounced = false;
let failedHealthChecks = 0;

function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (result.status !== 0) throw new Error('A local setup step failed. Review the error above; existing data was not deleted.');
}

async function freePort() {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the other service; no data was changed.`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolvePromise));
  });
}

function announceReady() {
  if (readyAnnounced) return;
  readyAnnounced = true;
  console.log('');
  console.log('  ==================================================================');
  console.log('   Annapurna Link is ready - local development only');
  console.log('  ==================================================================');
  console.log(`   App:         ${APP_URL}`);
  console.log(`   Test inbox:  ${inboxUrl}`);
  console.log(`   Health:      ${healthUrl}`);
  console.log('   Real operations: DISABLED     Real email: never sent');
  console.log('');
  const existing = inboxMessageCount();
  console.log(
    existing > 0
      ? `   The test inbox already holds ${existing} message${existing === 1 ? '' : 's'} from earlier runs.`
      : `   Sign-in links are written to ${INBOX_PATH} and shown in the test inbox.`,
  );
  console.log('   Keep that inbox private. Press Ctrl+C here to stop everything.');
  console.log('');
  if (autoOpen) {
    void (async () => {
      const app = await openUrl(APP_URL);
      const inbox = await openUrl(inboxUrl);
      const opened = [app && 'app', inbox && 'private test inbox'].filter(Boolean);
      if (opened.length > 0) console.log(`   Opened the ${opened.join(' and the ')} in your browser.`);
      else console.log('   No browser could be opened automatically. Use the URLs above.');
    })();
  }
  console.log('  ==================================================================');
  console.log('');
}

function inboxMessageCount() {
  try {
    return parseInbox(readFileSync(resolve(INBOX_PATH), 'utf8')).length;
  } catch {
    return 0;
  }
}

function watchReadiness() {
  const deadline = Date.now() + 180_000;
  let checking = false;
  readinessTimer = setInterval(async () => {
    if (checking || stopping) return;
    checking = true;
    try {
      const health = await probeHealth({ timeoutMs: 2500 });
      if (health?.status === 'ok' && health?.realOperationsEnabled === false && !readyAnnounced) {
        announceReady();
        clearInterval(readinessTimer);
        readinessTimer = setInterval(async () => {
          const again = await probeHealth({ timeoutMs: 2500 });
          if (again?.status === 'ok' && again?.realOperationsEnabled === false) failedHealthChecks = 0;
          else if (++failedHealthChecks >= 6) {
            console.error('Local health check is failing; check the app log above. Your data was not changed.');
            failedHealthChecks = 0;
          }
        }, 30_000);
        readinessTimer.unref?.();
      }
    } finally {
      checking = false;
    }
    if (Date.now() > deadline && !readyAnnounced) {
      console.error('The app did not report healthy within 3 minutes. Check the log above; your data was not changed.');
      clearInterval(readinessTimer);
    }
  }, 1500);
  readinessTimer.unref?.();
}

async function launchApp() {
  application = spawn(process.execPath, ['--env-file=.env', 'scripts/local-start.mjs'], { stdio: 'inherit', env: process.env });
  watchReadiness();
  return await new Promise((resolvePromise, reject) => {
    application.once('error', reject);
    application.once('exit', (code, signal) => resolvePromise(stopping ? 0 : (code ?? (signal ? 1 : 0))));
  });
}
async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.OPERATIONS_ENABLED === 'true') throw new Error('This launcher is for local development only and cannot enable real operations.');
  if (process.platform === 'win32' && (!existsSync(envFile) || existsSync(marker))) {
    const elevated = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'if (([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }'], { stdio: 'ignore' });
    if (elevated.status !== 0) throw new Error('Managed PostgreSQL must run as a normal Windows user, not as Administrator. Close this window and double-click start.bat without elevation.');
  }
  if (!existsSync(envFile)) {
    if (existsSync(marker) || existsSync(data)) throw new Error('Local PostgreSQL data already exists but .env is missing. Restore the original .env; do not overwrite your database.');
    run(['scripts/create-local-env.mjs'], { LOCAL_DATABASE_PORT: String(port) });
    mkdirSync(resolve('.local-data'), { recursive: true, mode: 0o700 });
    writeFileSync(marker, JSON.stringify({ version: 1, port, password: randomBytes(32).toString('base64url') }), { flag: 'wx', mode: 0o600 });
  }
  process.loadEnvFile(envFile);
  if (!existsSync(marker)) {
    if (existsSync(data)) throw new Error('Local PostgreSQL data exists without its managed configuration. Inspect it; no files were changed.');
    console.log('Existing .env detected. Using the existing local PostgreSQL setup; it must already be running and migrated.');
    return await launchApp();
  }
  if (process.env.NODE_ENV === 'production' || process.env.OPERATIONS_ENABLED !== 'false' || process.env.APP_URL !== 'http://localhost:3000') throw new Error('Managed startup requires local APP_URL and OPERATIONS_ENABLED=false.');
  let settings;
  try { settings = JSON.parse(readFileSync(marker, 'utf8')); } catch { throw new Error('Managed PostgreSQL settings cannot be read. Restore the original private settings; do not delete data.'); }
  if (settings.version !== 1 || settings.port !== port || !/^[A-Za-z0-9_-]{40,}$/.test(settings.password || '')) throw new Error('Managed PostgreSQL settings are invalid. Restore the original private settings.');
  for (const [key, role, passwordKey] of [
    ['DATABASE_URL', 'annapurna_app', 'APP_DB_PASSWORD'], ['AUTH_DATABASE_URL', 'annapurna_auth', 'AUTH_DB_PASSWORD'],
    ['WORKER_DATABASE_URL', 'annapurna_worker', 'WORKER_DB_PASSWORD'], ['MIGRATION_DATABASE_URL', 'annapurna_migrator', 'POSTGRES_PASSWORD'],
  ]) {
    let url;
    try { url = new URL(process.env[key]); } catch { throw new Error(`${key} is invalid.`); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== String(port) || url.pathname !== '/annapurna_link' || url.search || url.hash || decodeURIComponent(url.username) !== role || decodeURIComponent(url.password) !== process.env[passwordKey]) {
      throw new Error(`${key} must match the managed loopback database and role. Existing data was not changed.`);
    }
  }
  await freePort();
  if (stopping) throw new Error('Startup was interrupted.');
  let startupLog = '';
  let postgresReady = false;
  postgres = new EmbeddedPostgres({
    databaseDir: data, port, user: 'postgres', password: settings.password,
    authMethod: 'scram-sha-256', persistent: true, autoRehydrateSymlinks: true,
    postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--encoding=UTF8'],
    onLog: (message) => { if (!postgresReady) startupLog = (startupLog + String(message)).slice(-6000); },
    onError: (message) => { if (!postgresReady) startupLog = (startupLog + String(message)).slice(-6000); },
  });
  if (!existsSync(data)) {
    console.log('Preparing a private local PostgreSQL database (first launch only)...');
    try {
      await postgres.initialise();
    } catch {
      const diagnostic = startupLog.split(/\r?\n/).filter((line) => /fatal|error|could not|failed|permission denied/i.test(line) && !/password|secret|postgres:\/\//i.test(line)).slice(-4).join(' ').slice(0, 1000);
      throw new Error(`Managed PostgreSQL could not initialize.${diagnostic ? ` ${diagnostic}` : ' Check access to the local folder and temporary directory.'}`);
    }
    if (stopping) throw new Error('Startup was interrupted.');
  } else if (!existsSync(resolve(data, 'PG_VERSION'))) {
    throw new Error('The local PostgreSQL directory is incomplete. Inspect it; no data was removed or overwritten.');
  }
  console.log('Starting managed local PostgreSQL...');
  try {
    await postgres.start();
    postgresReady = true;
  } catch {
    const diagnostic = startupLog.split(/\r?\n/).filter((line) => line && !/password|secret|postgres:\/\//i.test(line))
      .map((line) => line.replaceAll(settings.password, '[redacted]')).slice(-6).join(' ').slice(0, 1000);
    throw new Error(`Managed PostgreSQL could not start (exit ${postgres.process?.exitCode ?? 'unknown'}, signal ${postgres.process?.signalCode ?? 'none'}).${diagnostic ? ` ${diagnostic}` : ''}`);
  }
  if (stopping) throw new Error('Startup was interrupted.');
  const adminUrl = `postgres://postgres:${encodeURIComponent(settings.password)}@127.0.0.1:${port}/postgres`;
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    const roles = await admin.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [['annapurna_migrator', 'annapurna_app', 'annapurna_auth', 'annapurna_worker']]);
    const database = await admin.query("SELECT datname FROM pg_database WHERE datname = 'annapurna_link'");
    if (roles.rowCount === 0 && database.rowCount === 0) {
      console.log('Creating local-only database roles...');
      run(['--env-file=.env', 'scripts/setup-native-db.mjs'], { PG_ADMIN_URL: adminUrl });
    } else if (roles.rowCount !== 4 || database.rowCount !== 1) {
      throw new Error('Managed database setup is incomplete. Inspect it manually; nothing was overwritten or deleted.');
    }
  } finally { await admin.end(); }
  if (stopping) throw new Error('Startup was interrupted.');
  console.log('Applying local database migrations...');
  run(['--env-file=.env', '--import', 'tsx', 'scripts/migrate.ts']);
  if (stopping) throw new Error('Startup was interrupted.');
  console.log('Starting the web app, worker and private test inbox...');
  return await launchApp();
}
function stop() {
  stopping = true;
  if (readinessTimer) clearInterval(readinessTimer);
  if (application) application.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  process.exitCode = await main();
} catch (error) {
  console.error(`Local startup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  console.error('See README.md. Do not delete .env or .local-data/postgres if you need the local data.');
  process.exitCode = 1;
} finally {
  if (readinessTimer) clearInterval(readinessTimer);
  if (postgres) await postgres.stop().catch(() => { console.error('PostgreSQL did not stop cleanly; inspect the local instance.'); process.exitCode = 1; });
}
