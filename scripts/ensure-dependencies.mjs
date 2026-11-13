// A lockfile fingerprint avoids repeated npm downloads while keeping updates in sync.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const hash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
const stamp = '.local-data/dependencies.sha256';
const installed = existsSync('node_modules/next/package.json') && existsSync('node_modules/embedded-postgres/package.json') && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash;
if (!installed) {
  console.log('Installing the locked application and local PostgreSQL dependencies; internet access may be required.');
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci'], { stdio: 'inherit' })
    : spawnSync('npm', ['ci'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('Dependency installation failed. Check Node.js 22 and your network, then retry.');
    process.exit(result.status || 1);
  }
  mkdirSync('.local-data', { recursive: true, mode: 0o700 });
  writeFileSync(stamp, hash, { mode: 0o600 });
}
