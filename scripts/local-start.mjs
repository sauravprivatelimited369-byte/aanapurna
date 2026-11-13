// Explicit local-only runner. PostgreSQL must already be running and migrated.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.env.NODE_ENV === 'production' || process.env.OPERATIONS_ENABLED === 'true') {
  console.error('local:start is for development only and refuses enabled real operations.');
  process.exit(1);
}
for (const key of ['DATABASE_URL', 'AUTH_DATABASE_URL', 'WORKER_DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
  try {
    const url = new URL(process.env[key]);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) throw new Error();
  } catch {
    console.error(`${key} must point to local PostgreSQL. Generate and configure .env first.`);
    process.exit(1);
  }
}
if (process.env.APP_URL !== 'http://localhost:3000') {
  console.error('local:start expects APP_URL=http://localhost:3000.');
  process.exit(1);
}
const env = {
  ...process.env,
  NODE_ENV: 'development',
  OPERATIONS_ENABLED: 'false',
  SMTP_URL: 'smtp://127.0.0.1:2526',
  LOCAL_SMTP_INBOX_PATH: resolve('.local-data/inbox.eml'),
  LOCAL_SMTP_SINK_PORT: '2526',
};
const check = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-db.ts'], { env, stdio: 'inherit' });
if (check.status !== 0) {
  console.error('Database check failed. Start PostgreSQL and run npm run local:migrate; see README.');
  process.exit(1);
}
console.log('\nStarting local development only. App: http://localhost:3000');
console.log('Email test inbox: .local-data/inbox.eml (private; contains login links). Press Ctrl+C to stop.\n');
const commands = [
  ['scripts/test-smtp-sink.mjs'],
  ['--conditions=react-server', '--import', 'tsx', 'src/worker/index.ts'],
  ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
];
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const args of commands) {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => { console.error(`Local process failed: ${error.message}`); stop(1); });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`A local service exited (${signal || code}); stopping the other services.`);
      stop(1);
    }
  });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
