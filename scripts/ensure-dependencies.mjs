// A lockfile fingerprint avoids repeated npm downloads while keeping updates in sync.
// Kept for any existing documentation or scripts; start.bat now delegates to
// scripts/launch-setup.mjs, which asks for y/n permission before downloading.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const hash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
const stamp = '.local-data/dependencies.sha256';
const installed = existsSync('node_modules/next/package.json') && existsSync('node_modules/embedded-postgres/package.json') && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash;
if (!installed) {
  console.log('Installing the locked application and local PostgreSQL dependencies; internet access may be required.');
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error('Dependency installation failed. Check Node.js 22 and your network, then retry.');
    process.exit(result.status || 1);
  }
  mkdirSync('.local-data', { recursive: true, mode: 0o700 });
  writeFileSync(stamp, hash, { mode: 0o600 });
}
