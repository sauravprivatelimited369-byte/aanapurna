// Asserts the launcher's consent gate on a machine with no keyboard.
//
// Automated hosts (CI, a scheduler, a service) must never install, create
// settings or start servers without explicit approval. This script proves that
// behaviour on the host it runs on, so the check is not buried in shell syntax:
//
//   node scripts/assert-consent-gate.mjs
//
// It requires a checkout where nothing has been created yet (no .env and no
// .local-data), which is the case for a fresh CI checkout. It never changes
// the working tree; if the launcher does create something, it reports it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

if (existsSync(resolve(root, '.env'))) fail('This check must run before .env exists (found .env).');
if (existsSync(resolve(root, '.local-data'))) fail('This check must run before .local-data exists (found .local-data).');

const { stdout, stderr, status, timedOut } = await new Promise((resolvePromise) => {
  const child = spawn(process.execPath, ['scripts/launch-setup.mjs'], {
    cwd: root,
    // A runner has no interactive console. Closing stdin makes the launcher see
    // a non-interactive run instead of waiting forever for an answer.
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ANNAPURNA_LAUNCH_APPROVED: '0',
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
  });
  let out = '';
  let err = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 120_000);
  child.stdout.on('data', (chunk) => {
    out += chunk;
  });
  child.stderr.on('data', (chunk) => {
    err += chunk;
  });
  child.stdin.end();
  child.once('error', (error) => {
    clearTimeout(timer);
    resolvePromise({ stdout: out, stderr: `${err}${error.message}`, status: -1, timedOut });
  });
  child.once('close', (code) => {
    clearTimeout(timer);
    resolvePromise({ stdout: out, stderr: err, status: code ?? -1, timedOut });
  });
});

const output = `${stdout}${stderr}`;
const report = (line) => console.log(`  ${line}`);

if (timedOut) fail('The launcher did not exit within 120 seconds (it may be waiting for a prompt).');
if (status !== 1) fail(`Expected exit code 1 without approval, got ${status}.`);
if (!output.includes('not attached to a keyboard')) fail('The refusal message was not printed.');
if (!output.includes('ANNAPURNA_LAUNCH_APPROVED=1')) fail('The refusal message did not name the automation approval.');
if (existsSync(resolve(root, '.env'))) fail('An unapproved run created .env.');
if (existsSync(resolve(root, '.local-data'))) fail('An unapproved run created .local-data.');

report(`launcher exit code: ${status}`);
report(`refusal message printed: ${output.includes('not attached to a keyboard')}`);
report(`.env created: ${existsSync(resolve(root, '.env'))}`);
report(`.local-data created: ${existsSync(resolve(root, '.local-data'))}`);

if (failures.length > 0) {
  // Print a bounded tail so the cause is visible without dumping secrets.
  const tail = output.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').split(/\r?\n/).slice(-25).join('\n');
  console.error('--- launcher output (tail) ---');
  console.error(tail);
  console.error(`CONSENT GATE FAILED (${failures.length} problem(s)).`);
  process.exit(1);
}
console.log('PASS: an unapproved automated start refused and changed nothing.');
