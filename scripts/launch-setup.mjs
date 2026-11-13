// Annapurna Link one-click local launcher (preflight + consent + downloads).
//
// Local development only. Nothing in this file enables real operations, sends
// email, installs anything system-wide or touches a non-loopback service.
//
// What it does, in order:
//   1. Read-only inspection: Node.js/npm, dependency fingerprint, local database
//      state, free disk space, required ports and (only if needed) the npm registry.
//   2. A plain-English plan of every action that would change this folder.
//   3. An explicit y/n confirmation before downloading or creating anything.
//   4. The locked npm install, then the existing managed-database supervisor
//      (scripts/windows-start.mjs) which creates the private local PostgreSQL
//      cluster, migrates it and starts the app, worker and test inbox.
//
// Usage: node scripts/launch-setup.mjs [--yes] [--check] [--open|--no-open] [--help]
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import {
  INBOX_VIEWER_PORT,
  MANAGED_POSTGRES_PORT,
  REQUIRED_NODE_MAJOR,
  SMTP_SINK_PORT,
  buildPlan,
  formatBytes,
  freeDiskBytes,
  isPortFree,
  localState,
  npmRegistryReachable,
  parseConsent,
  resolveApproval,
  resolveNpmInvocation,
  writeDependencyStamp,
} from './launch-support.mjs';
import { dependencyState } from './launch-support.mjs';

const args = new Set(process.argv.slice(2));
const has = (...names) => names.some((name) => args.has(name));
const wantsHelp = has('--help', '-h', '/?', 'help');
// Approval can also come from an automated host (CI, an OS scheduler). It is
// opt-in, must say exactly "1", and is reported in the printed plan so it is
// never a silent bypass.
const approval = resolveApproval(process.argv.slice(2));
const assumeYes = approval.approved;
const checkOnly = has('--check');
const forceOpen = has('--open');
const forceNoOpen = has('--no-open');
const interactive = Boolean(process.stdin.isTTY);
const root = resolve(process.cwd());
const MIN_FREE_FOR_INSTALL = 2_500_000_000; // npm packages + PostgreSQL binaries, with headroom
const MIN_FREE_FOR_DATABASE = 500_000_000;

function banner() {
  console.log('');
  console.log('  ==================================================================');
  console.log('   Annapurna Link - local development launcher');
  console.log('   Real food operations and real email stay DISABLED.');
  console.log('   Everything runs on this computer only (loopback).');
  console.log('  ==================================================================');
  console.log('');
}

function usage() {
  banner();
  console.log('  Usage: start.bat                (Windows, double-click or run it)');
  console.log('         ./start.sh               (macOS / Linux)');
  console.log('         node scripts/launch-setup.mjs [options]');
  console.log('');
  console.log('  Options:');
  console.log('    --yes, -y     Skip the confirmation prompt (non-interactive runs).');
  console.log('    --check       Only inspect this computer; install and start nothing.');
  console.log('    --open        Open the app and test inbox when they are ready.');
  console.log('    --no-open     Never open a browser.');
  console.log('    --help, -h    Show this message.');
  console.log('');
  console.log('  Before anything is downloaded or created, the launcher explains each');
  console.log('  action and asks y/n. Answering n changes nothing on this computer.');
  console.log('');
  console.log('  Automated hosts with no keyboard (CI, a scheduler) must approve explicitly:');
  console.log('  pass --yes, or set ANNAPURNA_LAUNCH_APPROVED=1 in that environment.');
  console.log('');
  console.log('  Windows users: double-click start.bat. It checks Node.js/npm first and,');
  console.log('  with your permission, opens the official Node.js download page if needed.');
  console.log('');
}

function item(status, title, detail) {
  const tag = { ok: 'OK  ', missing: 'MISS', warn: 'WARN', info: 'INFO', fail: 'FAIL' }[status] ?? 'INFO';
  console.log(`  [${tag}] ${title}`);
  if (detail) console.log(`         ${detail}`);
}

function probeNpm() {
  const { command, args: npmArgs } = resolveNpmInvocation(process.execPath, process.platform, ['--version']);
  const result = spawnSync(command, npmArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const version = result.status === 0 ? String(result.stdout).trim() : '';
  return { available: Boolean(version), version };
}

function databaseTarget(rootDir) {
  let raw = null;
  try {
    const lines = readFileSync(resolve(rootDir, '.env'), 'utf8').split(/\r?\n/);
    const line = lines.find((entry) => /^DATABASE_URL\s*=/.test(entry));
    raw = line ? line.slice(line.indexOf('=') + 1).trim() : null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return { protocol: url.protocol, host: url.hostname, port: url.port || '5432', database: url.pathname.replace(/^\//, '') };
  } catch {
    return null;
  }
}

function tcpReachable(host, port, timeoutMs = 1500) {
  const script = `const net=require("node:net");const s=net.createConnection({host:${JSON.stringify(host)},port:${Number(port)}});const done=(c)=>{s.destroy();process.exit(c)};s.setTimeout(${timeoutMs});s.once("connect",()=>done(0));s.once("timeout",()=>done(1));s.once("error",()=>done(1));`;
  const result = spawnSync(process.execPath, ['-e', script], { stdio: 'ignore', timeout: timeoutMs + 2000 });
  return result.status === 0;
}

async function preflight() {
  const dependency = dependencyState(root);
  const local = localState(root);
  const results = { dependency, local, problems: [], networkNeeded: false };
  const nodeMajor = Number(process.versions.node.split('.')[0]);

  console.log('  Checking this computer...');
  console.log('');

  if (nodeMajor >= REQUIRED_NODE_MAJOR) {
    item('ok', `Node.js ${process.versions.node}`, process.execPath);
    if (nodeMajor !== REQUIRED_NODE_MAJOR) {
      item('warn', `Node.js ${REQUIRED_NODE_MAJOR} LTS is the tested version`, 'Newer releases usually work, but Node.js 22 is what this project tests against.');
    }
  } else {
    item('fail', `Node.js ${process.versions.node} is too old`, `Annapurna Link needs Node.js ${REQUIRED_NODE_MAJOR} or newer.`);
    results.problems.push(
      `Node.js ${REQUIRED_NODE_MAJOR}+ is required. Install it from https://nodejs.org/en/download (choose the LTS installer), then run start again.`,
    );
  }

  const npm = probeNpm();
  if (npm.available) item('ok', `npm ${npm.version}`, 'Ships with Node.js; used for the locked package install.');
  else {
    item('fail', 'npm was not found', 'Reinstall Node.js with npm included (the default LTS installer).');
    results.problems.push('npm is required. Reinstall Node.js from https://nodejs.org/en/download with the default options.');
  }

  if (dependency.state === 'current') {
    item('ok', 'Application packages are already installed', 'node_modules matches package-lock.json.');
  }
  else if (dependency.state === 'missing') {
    item('missing', 'Application packages need to be downloaded once', 'node_modules is missing (npm ci, exact locked versions).');
    results.networkNeeded = true;
  } else if (dependency.state === 'stale') {
    item('warn', 'Application packages are out of date', 'package-lock.json changed since the last install (npm ci).');
    results.networkNeeded = true;
  } else {
    item('fail', 'package-lock.json could not be read', 'Run start from the repository folder you cloned.');
    results.problems.push('package-lock.json is missing. Clone the repository fully and run start again.');
  }

  if (local.mode === 'needs-attention') {
    item('fail', 'Local database data exists but .env is missing', 'Restore the original private .env; nothing will be overwritten.');
    results.problems.push(
      'A local PostgreSQL data folder exists in .local-data/postgres but the private .env is gone. Restore that .env file (a backup or another copy) and run start again. Do not delete the database to force a start.',
    );
  } else if (local.mode === 'managed-fresh') {
    item('info', 'First start: a private local database will be created', 'Managed PostgreSQL 17 under .local-data (no system-wide install).');
  } else if (local.mode === 'managed-existing') {
    item('ok', 'Private local database configuration found', 'The launcher will reuse it and apply any new migrations.');
  } else {
    item('info', 'Using your existing .env and PostgreSQL server', 'The launcher will not create, replace or stop that server.');
    const target = databaseTarget(root);
    if (!target) {
      item('warn', 'DATABASE_URL could not be read from .env', 'Follow the README "Local setup without Docker" steps before starting.');
    } else if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
      item('fail', 'DATABASE_URL is not a PostgreSQL URL', 'Annapurna Link needs PostgreSQL.');
      results.problems.push('DATABASE_URL in .env must be a postgres:// URL on this computer.');
    } else if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.host)) {
      if (tcpReachable(target.host, target.port)) item('ok', `Your PostgreSQL is reachable on ${target.host}:${target.port}`, `Database: ${target.database}`);
      else {
        item('warn', `Your PostgreSQL is not answering on ${target.host}:${target.port}`, 'Start your own PostgreSQL service, then run start again.');
        results.problems.push(`No PostgreSQL server answered on ${target.host}:${target.port}. Start the PostgreSQL service configured in .env, then run start again.`);
      }
    } else {
      item('warn', 'DATABASE_URL points outside this computer', 'The launcher will not connect to a remote database; keep local development local.');
      results.problems.push('DATABASE_URL must point to a loopback PostgreSQL server for local development.');
    }
  }

  const needsDatabase = local.mode === 'managed-fresh';
  const free = freeDiskBytes(root);
  const required = dependency.state !== 'current' ? MIN_FREE_FOR_INSTALL : needsDatabase ? MIN_FREE_FOR_DATABASE : 0;
  if (free === null) item('info', 'Free disk space could not be measured', 'Continuing; the install itself will report any space error.');
  else if (required > 0 && free < required) {
    item('fail', `Only ${formatBytes(free)} free; about ${formatBytes(required)} is needed`, 'Free some disk space, then run start again.');
    results.problems.push(`Free up disk space: this start needs roughly ${formatBytes(required)} and ${formatBytes(free)} is available.`);
  } else {
    item('ok', `Free disk space: ${formatBytes(free)}`, required > 0 ? `About ${formatBytes(required)} is needed for this start.` : 'No download is required.');
  }

  const ports = [];
  if (local.mode !== 'native-existing') ports.push([MANAGED_POSTGRES_PORT, 'managed PostgreSQL']);
  ports.push([3000, 'web app'], [SMTP_SINK_PORT, 'test inbox sink'], [INBOX_VIEWER_PORT, 'test inbox page']);
  for (const [port, label] of ports) {
    const free = await isPortFree(port);
    if (free) item('ok', `Port ${port} is available (${label})`, undefined);
    else {
      item('fail', `Port ${port} is already in use (${label})`, 'Stop the other program using it, then run start again.');
      results.problems.push(
        `Port ${port} (${label}) is already in use. Close the program using it (on Windows: "netstat -ano | findstr :${port}" shows the process id) and run start again.`,
      );
    }
  }

  if (results.networkNeeded && !results.problems.length) {
    const reachable = await npmRegistryReachable();
    if (reachable) item('ok', 'npm registry is reachable', 'The locked download can proceed.');
    else {
      item('fail', 'The npm registry could not be reached', 'Check your internet connection, proxy or firewall.');
      results.problems.push('No internet connection to registry.npmjs.org. Connect to the internet (or allow npm through your firewall/proxy), then run start again.');
    }
  }

  console.log('');
  results.plan = buildPlan({ dependency, local });
  results.local = local;
  results.dependency = dependency;
  return results;
}

function printPlan(plan, preApproved = false) {
  const changing = plan.filter((step) => !step.informational && !step.blocking);
  if (changing.length === 0) {
    console.log('  Everything needed is already on this computer. Starting now.');
    console.log('');
    return { changing, requiresDownload: false };
  }
  const requiresDownload = plan.some((step) => step.id === 'dependencies');
  if (!requiresDownload) {
    console.log('  Nothing needs to be downloaded; the app will start and reuse your local data.');
    console.log(`  What happens next: ${changing.map((step) => step.title.toLowerCase()).join(', ')}.`);
    console.log('');
    return { changing, requiresDownload };
  }
  console.log('  To start Annapurna Link, the launcher will:');
  console.log('');
  changing.forEach((step, index) => {
    console.log(`    ${index + 1}. ${step.title}`);
    if (step.detail) console.log(`       ${step.detail}`);
    if (step.estimate) console.log(`       Approximate time: ${step.estimate}`);
  });
  console.log('');
  if (preApproved) {
    console.log('  Permission: pre-approved for this automated run (no keyboard prompt).');
    console.log('');
  }
  return { changing, requiresDownload };
}

async function askConsent(question, defaultYes) {
  if (!interactive) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const onSigint = () => {
    rl.close();
    console.log('\n  Cancelled. Nothing was changed.');
    process.exit(130);
  };
  rl.on('SIGINT', onSigint);
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await rl.question(`  ${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `);
      const parsed = parseConsent(answer, { defaultYes });
      if (parsed !== null) return parsed;
      console.log('  Please answer y (yes) or n (no).');
    }
    return false;
  } catch {
    return null;
  } finally {
    rl.off('SIGINT', onSigint);
    rl.close();
  }
}

function stepNumber(value, title) {
  console.log('');
  console.log(`  --- ${value} ${title} ${'-'.repeat(Math.max(0, 56 - title.length))}`);
}

async function installDependencies() {
  console.log('  Downloading the exact locked packages (this can take a few minutes)...');
  const npm = resolveNpmInvocation(process.execPath, process.platform, ['ci', '--no-audit', '--no-fund']);
  const code = await new Promise((resolvePromise) => {
    const child = spawn(npm.command, npm.args, { stdio: 'inherit', cwd: root, shell: false, windowsHide: false });
    child.on('error', (error) => {
      console.error(`  Could not start npm: ${error.message}`);
      resolvePromise(1);
    });
    child.on('exit', (childCode, signal) => resolvePromise(signal ? 1 : (childCode ?? 1)));
  });
  if (code !== 0) return false;
  writeDependencyStamp(root);
  return true;
}

async function runSupervisor({ open }) {
  const env = {
    ...process.env,
    ANNAPURNA_LAUNCH_OPEN: open ? '1' : '0',
    ANNAPURNA_LAUNCHED: '1',
  };
  return await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['scripts/windows-start.mjs'], { stdio: 'inherit', cwd: root, env });
    let stopping = false;
    const forward = (signal) => {
      if (stopping) return;
      stopping = true;
      child.kill(signal);
    };
    process.on('SIGINT', () => forward('SIGTERM'));
    process.on('SIGTERM', () => forward('SIGTERM'));
    child.on('error', (error) => {
      console.error(`  Local startup failed: ${error.message}`);
      resolvePromise(1);
    });
    child.on('exit', (code, signal) => resolvePromise(signal ? 1 : (code ?? 0)));
  });
}

async function main() {
  if (wantsHelp) {
    usage();
    return 0;
  }
  if (assumeYes && !interactive) {
    console.log(
      approval.source === 'environment'
        ? '  Automated run: ANNAPURNA_LAUNCH_APPROVED=1 pre-approved the actions below without a keyboard.'
        : '  Non-interactive run with --yes: actions below were pre-approved on the command line.',
    );
  }
  banner();

  const { plan, problems, local, dependency } = await preflight();

  if (checkOnly) {
    if (problems.length === 0) console.log('  RESULT: this computer is ready. Run start.bat (or ./start.sh) to launch.\n');
    else {
      console.log('  RESULT: this computer is not ready yet:\n');
      problems.forEach((problem) => console.log(`    - ${problem}`));
      console.log('');
    }
    return problems.length === 0 ? 0 : 1;
  }

  if (problems.length > 0) {
    console.log('  Fix the item(s) above, then run start again. Nothing was downloaded or changed.');
    console.log('');
    return 1;
  }

  const { changing, requiresDownload } = printPlan(plan, assumeYes);
  const open = forceOpen || (!forceNoOpen && Boolean(interactive));

  if (changing.length === 0) {
    stepNumber('1/1', 'Starting');
    return await runSupervisor({ open });
  }

  // A "pure restart" is the only case that may proceed without approval: an
  // existing, launcher-configured install where nothing will be created,
  // downloaded or installed. Creating .env or a database, or starting servers
  // for the first time, always requires consent -- even when no download is
  // needed -- so an unapproved automated run can never change the machine.
  const pureRestart = !requiresDownload && local.mode === 'managed-existing' && changing.every((step) => step.id === 'migrate' || step.id === 'start' || step.id === 'open');
  if (pureRestart) {
    // Nothing to create or download, so record the verified install fingerprint
    // now that a start has been authorized.
    if (dependency.adopted) writeDependencyStamp(root);
    if (interactive && !assumeYes) {
      const approved = await askConsent('Start Annapurna Link now?', true);
      if (approved === false) {
        console.log('');
        console.log('  Cancelled. Nothing was changed.');
        return 0;
      }
    }
    console.log('');
    stepNumber(`1/${changing.length}`, changing[0].title.replace(/^Apply /, 'Applying ').replace(/^Start /, 'Starting '));
    if (changing[0].id !== 'start') {
      console.log('  Your web app and private test inbox start next; press Ctrl+C anytime to stop.');
    }
    return await runSupervisor({ open });
  }

  const approved = assumeYes ? true : await askConsent('Continue with these actions?', true);
  if (approved === null) {
    console.log('  This run is not attached to a keyboard, so it cannot ask for permission.');
    console.log('  To approve the actions listed above explicitly, either:');
    console.log('    - re-run with --yes, or');
    console.log('    - set ANNAPURNA_LAUNCH_APPROVED=1 for an automated host such as CI.');
    console.log('  Nothing was downloaded or changed.');
    return 1;
  }
  if (!approved) {
    console.log('');
    console.log('  Cancelled. Nothing was downloaded or changed.');
    console.log('  You can close this window, or run start again later.');
    return 0;
  }
  console.log('');
  console.log('  Thank you. Starting now.');
  if (!changing.some((step) => step.id === 'dependencies') && dependency.adopted) writeDependencyStamp(root);

  const needsInstall = changing.some((step) => step.id === 'dependencies');
  let current = 0;
  if (needsInstall) {
    current += 1;
    stepNumber(`${current}/${changing.length}`, 'Downloading application packages');
    if (!(await installDependencies())) {
      console.error('');
      console.error('  Dependency download failed. Your data was not changed.');
      console.error('  Check your internet connection, firewall/proxy and free disk space, then run start again.');
      return 1;
    }
    console.log('  Packages installed.');
  }

  current += 1;
  const remaining = changing.slice(current);
  // The supervisor performs the "start" step (and opens the browser as part of
  // it), so label this stage by that step rather than by the trailing "open".
  const nextStep = remaining.find((step) => step.id === 'start') ?? remaining[0];
  const nextTitle = nextStep?.title.replace(/^Apply /, 'Applying ').replace(/^Start /, 'Starting ') ?? 'Starting';
  stepNumber(`${current}/${changing.length}`, nextTitle);
  const planIds = new Set(changing.map((step) => step.id));
  if (!planIds.has('start')) {
    console.log('  Your web app and private test inbox start next; press Ctrl+C anytime to stop.');
  }
  const code = await runSupervisor({ open });
  if (code !== 0) {
    console.error('');
    console.error('  Startup did not complete. The message above explains why.');
    console.error('  Your local database and .env were not deleted. Fix the issue and run start again.');
    console.error('  Help: README.md, section "Windows: start everything with start.bat".');
  } else {
    console.log('');
    console.log('  ------------------------------------------------------------------');
    console.log('   Annapurna Link stopped. Your local data is kept in .local-data/ and .env.');
    console.log('   Database shutdown lines from the worker ("terminating connection")');
    console.log('   during a stop are expected, not data loss.');
    console.log('  ------------------------------------------------------------------');
  }
  return code;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('');
    console.error(`  Launcher error: ${error instanceof Error ? error.message : 'unknown error'}`);
    console.error('  Nothing was deleted. If the app was running, stop it and try again.');
    process.exitCode = 1;
  });
