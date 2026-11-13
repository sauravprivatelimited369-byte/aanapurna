// Dependency-free helpers for the one-click local launcher and its tests.
// Local development only: nothing here enables real operations, sends email or
// touches a non-loopback service.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

export const REQUIRED_NODE_MAJOR = 22;
export const APP_URL = 'http://localhost:3000';
export const APP_HEALTH_URL = 'http://127.0.0.1:3000/api/health';
export const SMTP_SINK_PORT = 2526;
export const MANAGED_POSTGRES_PORT = 55432;
export const INBOX_VIEWER_PORT = 2527;
export const INBOX_PATH = '.local-data/inbox.eml';
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const AFFIRMATIVE = new Set(['y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'continue', '1', 'true']);
const NEGATIVE = new Set(['n', 'no', 'nope', 'stop', 'cancel', '0', 'false']);

/**
 * Reads an answer to a yes/no question. Returns true, false, or null when the
 * text is ambiguous (the caller should ask again). An empty answer uses the
 * supplied default, matching the "[Y/n]" / "[y/N]" hint style.
 */
export function parseConsent(input, { defaultYes = false } = {}) {
  const answer = String(input ?? '').trim().toLowerCase();
  if (!answer) return defaultYes;
  if (AFFIRMATIVE.has(answer)) return true;
  if (NEGATIVE.has(answer)) return false;
  return null;
}

/**
 * Resolves whether this run was pre-approved without a keyboard.
 * Approval must be explicit: the `--yes`/`-y` flag, or the environment
 * variable ANNAPURNA_LAUNCH_APPROVED set to exactly "1" by an automated host.
 * Anything else (unset, "0", "true", "YES") is not approval, so an
 * interactive-less run must refuse rather than install silently.
 */
export function resolveApproval(argv, env = process.env) {
  const flags = new Set(argv ?? []);
  if (flags.has('--yes') || flags.has('-y')) return { approved: true, source: 'flag' };
  if (env.ANNAPURNA_LAUNCH_APPROVED === '1') return { approved: true, source: 'environment' };
  return { approved: false, source: null };
}

/** Human-readable byte size used in the launcher plan and reports. */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** True only for http URLs that stay on this computer. */
export function isLocalHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
}

/** Free space on the volume holding `path`, or null when unavailable. */
export function freeDiskBytes(path) {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/**
 * Which local installation state is present?
 *  - managed-fresh: no .env yet, so the launcher may generate one and build its
 *    own private PostgreSQL cluster.
 *  - managed-existing: launcher-owned .env plus managed PostgreSQL settings.
 *  - native-existing: a user-managed .env that already points at a PostgreSQL
 *    server the launcher must not create, replace or start.
 *  - needs-attention: database data exists but .env is gone. Never overwrite.
 */
export function localState(root) {
  const envExists = existsSync(join(root, '.env'));
  const markerExists = existsSync(join(root, '.local-data', 'managed-postgres.json'));
  const postgresDataExists = existsSync(join(root, '.local-data', 'postgres'));
  let mode = 'managed-fresh';
  if (!envExists && (markerExists || postgresDataExists)) mode = 'needs-attention';
  else if (envExists && markerExists) mode = 'managed-existing';
  else if (envExists) mode = 'native-existing';
  return { envExists, markerExists, postgresDataExists, mode };
}

/** Lock-file fingerprint state for node_modules, mirroring ensure-dependencies. */
export function dependencyState(root) {
  const lockPath = join(root, 'package-lock.json');
  const stampPath = join(root, '.local-data', 'dependencies.sha256');
  let lockHash;
  try {
    lockHash = createHash('sha256').update(readFileSync(lockPath)).digest('hex');
  } catch {
    return { state: 'unknown', lockHash: null, modulesPresent: false };
  }
  const modulesPresent = ['next', 'embedded-postgres', 'pg'].every((name) => existsSync(join(root, 'node_modules', name, 'package.json')));
  let stamp = null;
  try {
    stamp = readFileSync(stampPath, 'utf8').trim();
  } catch {
    stamp = null;
  }
  if (!modulesPresent) return { state: 'missing', lockHash, modulesPresent };
  if (stamp === lockHash) return { state: 'current', lockHash, modulesPresent };
  // Packages are installed but this launcher never recorded a fingerprint
  // (e.g. plain `npm ci` in CI, or a checkout someone prepared by hand).
  // Compare the installed lockfile metadata instead of forcing a large
  // re-download on every start.
  if (installedMatchesLock(root)) return { state: 'current', lockHash, modulesPresent, adopted: true };
  return { state: 'stale', lockHash, modulesPresent };
}

/**
 * True when every package recorded as installed in node_modules/.package-lock.json
 * has exactly the version package-lock.json asks for. npm writes that hidden
 * lockfile on every install, so it is a cheap, reliable staleness signal: if a
 * dependency was added, removed or bumped, at least one entry differs and the
 * launcher correctly falls back to running npm ci.
 */
function installedMatchesLock(root) {
  try {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const installed = JSON.parse(readFileSync(join(root, 'node_modules', '.package-lock.json'), 'utf8'));
    const expected = lock?.packages ?? {};
    const actual = installed?.packages ?? {};
    const names = Object.keys(actual);
    if (names.length === 0) return false;
    for (const name of names) {
      if (!expected[name] || expected[name].version !== actual[name].version) return false;
    }
    // Every dependency the project declares at the top level must be present,
    // otherwise the install is incomplete even if nothing looks out of date.
    const declared = {
      ...(expected['']?.dependencies ?? {}),
      ...(expected['']?.devDependencies ?? {}),
      ...(expected['']?.optionalDependencies ?? {}),
    };
    for (const name of Object.keys(declared)) {
      if (!actual[`node_modules/${name}`]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Records the lock hash after a successful install so repeat starts are fast. */
export function writeDependencyStamp(root) {
  const state = dependencyState(root);
  if (!state.lockHash) return false;
  mkdirSync(join(root, '.local-data'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, '.local-data', 'dependencies.sha256'), state.lockHash, { mode: 0o600 });
  return true;
}

/** Ordered list of actions the launcher would perform, shown before consent. */
export function buildPlan({ dependency, local }) {
  const actions = [];
  if (local.mode === 'needs-attention') {
    actions.push({
      id: 'blocked',
      blocking: true,
      title: '.env is missing but local database data exists',
      detail: 'Restore the original private .env instead. Nothing will be overwritten or deleted.',
    });
  }
  if (dependency.state !== 'current' && dependency.state !== 'unknown') {
    actions.push({
      id: 'dependencies',
      needsInternet: true,
      title: 'Download the locked npm packages',
      detail:
        dependency.state === 'missing'
          ? 'npm ci installs exactly the versions in package-lock.json; several hundred MB on the first run.'
          : 'package-lock.json changed, so npm ci refreshes node_modules to match it.',
      estimate: '2-6 minutes',
    });
  }
  if (local.mode === 'managed-fresh') {
    actions.push({
      id: 'database',
      title: 'Create private local settings and a PostgreSQL 17 cluster',
      detail: 'Fresh .env secrets plus a launcher-owned database under .local-data. Nothing is installed system-wide.',
      estimate: '1-2 minutes',
    });
  }
  if (local.mode === 'managed-fresh' || local.mode === 'managed-existing') {
    actions.push({
      id: 'migrate',
      title: 'Apply local database migrations',
      detail: 'Creates the application tables, roles and row-level security policies.',
      estimate: 'under a minute',
    });
  }
  if (local.mode === 'native-existing') {
    actions.push({
      id: 'native',
      informational: true,
      title: 'Use your existing .env and PostgreSQL server',
      detail: 'Your own PostgreSQL must already be running on this computer and migrated. The launcher will not replace it.',
    });
  }
  actions.push({
    id: 'start',
    title: 'Start the web app, background worker and private test inbox',
    detail: 'Loopback processes only. Real food operations and real email stay disabled.',
    estimate: '10-60 seconds',
  });
  actions.push({
    id: 'open',
    title: 'Open the app and the private test inbox',
    detail: 'Also prints the health-check URL. One-time sign-in links never leave this computer.',
  });
  return actions;
}

/** Reads a KEY=value flag from .env without echoing any other value. */
export function envFlag(root, key) {
  try {
    const lines = readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && match[1] === key) return match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    return null;
  }
  return null;
}

/** Resolves how to run npm without relying on a shell-quoted npm.cmd on Windows. */
export function resolveNpmInvocation(execPath, platform, args) {
  const directory = dirname(execPath);
  const cli = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(cli)) return { command: execPath, args: [cli, ...args], verbatim: false };
  if (platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `npm ${args.join(' ')}`],
      verbatim: false,
    };
  }
  return { command: 'npm', args, verbatim: false };
}

/** Runs a child process and resolves with its exit code (never rejects on exit). */
export function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', (error) => {
      console.error(`Could not run ${command}: ${error.message}`);
      resolvePromise(1);
    });
    child.on('exit', (code, signal) => resolvePromise(signal ? 1 : (code ?? 0)));
  });
}

/** TCP port availability on loopback only. */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolvePromise) => {
    const server = createNetServer();
    server.unref();
    server.once('error', () => resolvePromise(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolvePromise(true)));
  });
}

/** Whether the public npm registry answers within the timeout. */
export async function npmRegistryReachable(timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://registry.npmjs.org/-/ping', {
      signal: controller.signal,
      headers: { 'user-agent': 'annapurna-local-launcher' },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the local health endpoint; returns the JSON body or null. */
export async function probeHealth({ url = APP_HEALTH_URL, timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const body = await response.json().catch(() => null);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Escapes untrusted text (email bodies, subjects) for the private inbox page. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Splits .local-data/inbox.eml into individual raw messages. */
export function parseInbox(raw) {
  if (!raw) return [];
  return raw
    .split(/^--- MESSAGE ---\r?$/m)
    .map((chunk) => chunk.replace(/^\r?\n/, '').trimEnd())
    .filter((chunk) => chunk.trim().length > 0);
}

function describeMessage(message, index) {
  const subject = /^subject:\s*(.+)$/im.exec(message);
  if (subject) return `#${index + 1} - ${subject[1].trim().slice(0, 120)}`;
  const line = message.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? 'message';
  return `#${index + 1} - ${line.trim().slice(0, 120)}`;
}

/** Static, script-free HTML for the loopback-only private test inbox. */
export function renderInboxHtml({ messages, inboxPath = INBOX_PATH }) {
  const newestFirst = messages.slice().reverse();
  const items =
    newestFirst.length === 0
      ? '<p class="empty">No messages yet. Sign up or request a password reset in the app; the one-time link appears here within a few seconds.</p>'
      : newestFirst
          .map(
            (message, index) =>
              `<details${index === 0 ? ' open' : ''}><summary>${escapeHtml(describeMessage(message, newestFirst.length - index - 1))}</summary><pre>${escapeHtml(message)}</pre></details>`,
          )
          .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Annapurna Link - private local test inbox</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 2rem 1.25rem 4rem; font-family: system-ui, sans-serif; line-height: 1.5; }
main { max-width: 56rem; margin: 0 auto; }
h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
.warning { margin: 1rem 0 1.5rem; padding: .75rem 1rem; border-left: 4px solid #c2410c; background: rgba(194, 65, 12, .08); }
.meta { opacity: .75; font-size: .85rem; }
p.empty { opacity: .8; }
details { margin: 0 0 .75rem; border: 1px solid rgba(127,127,127,.35); border-radius: .5rem; }
summary { cursor: pointer; padding: .6rem .8rem; font-weight: 600; }
pre { margin: 0; padding: 0 .8rem .8rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-size: .82rem; }
</style>
</head>
<body>
<main>
<h1>Private local test inbox</h1>
<p class="meta">${messages.length} message${messages.length === 1 ? '' : 's'} - raw file: ${escapeHtml(inboxPath)} - this page refreshes every few seconds.</p>
<p class="warning"><strong>Private.</strong> These are real one-time sign-in and reset links for fictional local accounts. Do not share this page, screenshots or the raw .eml file. Real email is never sent from this launcher.</p>
${items}
</main>
</body>
</html>
`;
}

/**
 * Starts the loopback-only inbox viewer. It only reads the private .eml file,
 * exposes no write operations, and refuses any non-loopback bind address.
 */
export async function startInboxViewer({ inboxPath, port = INBOX_VIEWER_PORT, host = '127.0.0.1', refreshSeconds = 3 } = {}) {
  if (host !== '127.0.0.1') throw new Error('The private inbox viewer must bind to loopback only.');
  const server = createHttpServer((request, response) => {
    const allowed = request.method === 'GET' || request.method === 'HEAD';
    if (!allowed) {
      response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed.');
      return;
    }
    if (request.url !== '/' && !request.url?.startsWith('/?')) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found.');
      return;
    }
    let messages = [];
    try {
      messages = parseInbox(readFileSync(inboxPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') messages = [];
    }
    const body = renderInboxHtml({ messages, inboxPath });
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      refresh: String(refreshSeconds),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolvePromise);
  });
  return {
    url: `http://${host}:${port}/`,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  };
}

/**
 * Opens a loopback URL in the default browser. Refuses anything else so a
 * misconfigured value cannot send a one-time link to a remote page. Resolves
 * only after the opener process has actually finished, so callers report
 * "could not open a browser" truthfully on headless machines. On Windows the
 * `start` shim is detached from the browser and exits immediately; elsewhere
 * the opener must exit 0 within the grace period (a browser that stays in the
 * foreground is detached and still opens the tab).
 */
export async function openUrl(url, platform = process.platform, graceMs = 1500) {
  if (!isLocalHttpUrl(url)) throw new Error('Refusing to open a non-local URL.');
  const candidates =
    platform === 'win32'
      ? [[process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { windowsVerbatimArguments: true, windowsHide: false }]]
      : platform === 'darwin'
        ? [['open', [url]]]
        : [
            ['xdg-open', [url]],
            ['gio', ['open', url]],
            ['sensible-browser', [url]],
          ];
  for (const [command, args, extra] of candidates) {
    const started = await new Promise((resolvePromise) => {
      let child;
      try {
        // Windows needs windowsVerbatimArguments so cmd.exe receives
        // `start "" "url"` unchanged; otherwise Node re-quotes the whole
        // command string and `start` treats it as a window title.
        child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, ...extra });
      } catch {
        resolvePromise(false);
        return;
      }
      let finished = false;
      const settle = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolvePromise(value);
      };
      const timer = setTimeout(() => {
        // Still running after the grace period: likely a foreground browser
        // that has taken over. Detach it rather than killing it.
        child.unref();
        settle(true);
      }, graceMs);
      child.once('error', () => settle(false));
      child.once('exit', (code) => settle((code ?? 1) === 0));
      child.unref();
    });
    if (started) return true;
  }
  return false;
}
