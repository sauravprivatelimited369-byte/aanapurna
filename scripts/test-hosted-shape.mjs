// The hosted deployment's shape, end to end, on this machine: a web process and NO long-lived worker.
//
// Every other local check starts the worker beside the web process (`local:start`). The hosted site
// cannot run one, and three defects lived in exactly that difference without any check noticing:
//
//   * "Turn on for this device" failed for everybody: the route queried a row-level-secured table
//     without saying who was asking, and the database refused every registration.
//   * Nothing sent a push, and verification email left hours late: both waited for a worker that does
//     not exist there, or for a scheduled call that fires hours apart.
//   * No operator could act: enrolling a second factor - required before a platform account is served
//     at all - failed on every statement, because the sign-in role was never admitted to its own table.
//
// A fourth was found by this check itself, on the day it first ran against a database that already
// held mail: a request sent only the six oldest queued messages, so a person who signed up behind six
// older ones got nothing, and nothing else was coming to send it.
//
// So this starts only what the hosted site has, and then does what real people do, over HTTP: signs
// up, reads the verification email, turns notifications on, and has an operator - enrolled with a real
// authenticator code - make a decision about somebody else's account. Nobody calls the scheduled
// drain until the step that is about the drain.
//
// The push service on the other end is `scripts/test-push-stand-in.mjs`, which checks the VAPID
// signature and decrypts the payload the way a real one does. What is asserted about a notification
// is the plaintext that would be handed to the service worker on the phone.
//
// Run ONLY against an isolated local development database. It creates fictional example.test accounts.
import { execFile, spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { generateVAPIDKeys } from 'web-push';

if (process.env.RUN_HOSTED_SHAPE_TEST !== 'true' || process.env.NODE_ENV === 'production') {
  console.error('Set RUN_HOSTED_SHAPE_TEST=true only for an isolated development database.');
  process.exit(1);
}
for (const key of ['DATABASE_URL', 'AUTH_DATABASE_URL', 'WORKER_DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
  try {
    const url = new URL(process.env[key]);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
  } catch {
    console.error(`${key} must point to local PostgreSQL. Generate and configure .env first.`);
    process.exit(1);
  }
}

const run = promisify(execFile);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const appPort = Number(process.env.HOSTED_SHAPE_APP_PORT ?? 3100);
const sinkPort = Number(process.env.HOSTED_SHAPE_SMTP_PORT ?? 2536);
const standInPort = Number(process.env.HOSTED_SHAPE_PUSH_PORT ?? 2538);
const base = `http://localhost:${appPort}`;
const standIn = `http://127.0.0.1:${standInPort}`;
const pushOrigin = 'https://push.stand-in.test';
const inboxPath = resolve('.local-data/hosted-shape-inbox.eml');
const triggerToken = randomBytes(32).toString('hex');
const vapid = generateVAPIDKeys();

mkdirSync(resolve('.local-data'), { recursive: true });
rmSync(inboxPath, { force: true });

const owner = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 2 });
const rows = async (text, params = []) => (await owner.query(text, params)).rows;

// The premise, checked rather than assumed. A worker left running against this database would send
// every push and every email by itself, and this would then pass without proving anything about a
// deployment that has none. A long-lived worker holds a connection open as its own role; before the
// first request, nothing else does.
{
  const workerRole = decodeURIComponent(new URL(process.env.WORKER_DATABASE_URL).username);
  const connections = () => rows('select count(*)::int as count from pg_stat_activity where usename = $1', [workerRole])
    .then((result) => result[0].count, (error) => {
      console.error(`Could not reach the local database: ${error.message}`);
      process.exit(1);
    });
  // A few seconds of grace for a process that was stopped a moment ago and is still letting go.
  let connected = await connections();
  for (let waited = 0; connected > 0 && waited < 10; waited += 1) {
    await sleep(1_000);
    connected = await connections();
  }
  if (connected > 0) {
    console.error(`A process is connected to this database as ${workerRole}: a worker is running.`);
    console.error('This check is about the deployment that has none. Stop it (for example `npm run local:start`) and run again.');
    await owner.end();
    process.exit(1);
  }
}

// ---- the deployment under test: mail sink, push stand-in, web process. No worker. -------------------
const sharedEnv = {
  ...process.env,
  NODE_ENV: 'development',
  NEXT_TELEMETRY_DISABLED: '1',
  OPERATIONS_ENABLED: 'false',
  PUSH_STAND_IN_PORT: String(standInPort),
  PUSH_STAND_IN_ORIGIN: pushOrigin,
};
const services = [
  ['mail sink', ['scripts/test-smtp-sink.mjs'], { LOCAL_SMTP_SINK_PORT: String(sinkPort), LOCAL_SMTP_INBOX_PATH: inboxPath }],
  ['push stand-in', ['scripts/test-push-stand-in.mjs'], {}],
  ['web process', ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(appPort)], {
    APP_URL: base,
    SMTP_URL: `smtp://127.0.0.1:${sinkPort}`,
    WEB_PUSH_PUBLIC_KEY: vapid.publicKey,
    WEB_PUSH_PRIVATE_KEY: vapid.privateKey,
    WEB_PUSH_SUBJECT: 'https://annapurna-link.example',
    WORKER_TRIGGER_TOKEN: triggerToken,
    // Carries requests for the one reserved push hostname to the stand-in. Nothing else is touched.
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${pathToFileURL(resolve('scripts/support/push-stand-in-redirect.mjs')).href}`].filter(Boolean).join(' '),
  }],
];
const children = [];
const serverLog = [];
let finished = false;
function stopAll() {
  finished = true;
  for (const child of children) child.kill();
}
for (const [name, args, env] of services) {
  const child = spawn(process.execPath, args, { env: { ...sharedEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      serverLog.push(...String(chunk).split('\n').filter(Boolean).map((text) => `[${name}] ${text}`));
      if (serverLog.length > 400) serverLog.splice(0, serverLog.length - 400);
    });
  }
  child.on('exit', (code, signal) => {
    if (!finished) {
      console.error(`The ${name} exited early (${signal ?? code}).`);
      console.error(serverLog.slice(-25).join('\n'));
      stopAll();
      process.exit(1);
    }
  });
}
process.on('SIGINT', () => { stopAll(); process.exit(130); });
process.on('SIGTERM', () => { stopAll(); process.exit(143); });

// ---- one person's browser ----------------------------------------------------------------------------
let addresses = 10;
function person(label) {
  addresses += 1;
  return {
    label,
    email: `hosted-shape-${label}-${randomBytes(5).toString('hex')}@example.test`,
    // Always three character classes; the registration rules refuse less.
    password: `Aa1!${randomBytes(24).toString('base64url')}`,
    ip: `203.0.113.${addresses}`,
    cookies: new Map(),
  };
}

async function send(who, method, path, body, timeoutMs = 120_000) {
  const response = await fetch(base + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Origin: base,
      'X-Forwarded-For': who?.ip ?? '203.0.113.9',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      ...(who?.cookies.size ? { Cookie: [...who.cookies.values()].join('; ') } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (who) {
    for (const item of response.headers.getSetCookie()) {
      const pair = item.split(';')[0];
      const name = pair.slice(0, pair.indexOf('='));
      if (/max-age=0/i.test(item) || pair.endsWith('=')) who.cookies.delete(name); else who.cookies.set(name, pair);
    }
  }
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text };
}

async function emailLink(who, pathFragment, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const inbox = await readFile(inboxPath, 'utf8').catch(() => '');
    for (const raw of inbox.split(/--- MESSAGE ---/).filter((message) => message.includes(who.email)).reverse()) {
      const message = raw.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&amp;/g, '&');
      for (const candidate of message.match(/https?:\/\/localhost:\d+\/[^\s<>"']+/g) ?? []) {
        const url = new URL(candidate);
        if (url.origin === base && url.pathname.includes(pathFragment)) return { url: url.toString(), waitedMs: Date.now() - started };
      }
    }
    await sleep(200);
  }
  return null;
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// ---- reporting ---------------------------------------------------------------------------------------
let passed = 0;
function expect(condition, description, detail = '') {
  if (!condition) throw new Error(`${description}${detail ? `\n      ${detail}` : ''}`);
  passed += 1;
  console.log(`  ok   ${description}${detail ? `  (${detail})` : ''}`);
}

const notificationsOf = (who) => rows(
  `select title, push_outcome as outcome, push_attempts as attempts, push_delivered_at is not null as finished
   from public.notifications where user_id = $1 order by created_at`, [who.id]);
const devicesOf = (who) => rows(
  `select revoked_at is not null as revoked, last_error from public.push_subscriptions where user_id = $1 order by created_at`, [who.id]);
const received = async (subscription) => {
  const token = subscription.endpoint.split('/').pop();
  return (await (await fetch(`${standIn}/control/received`)).json()).filter((entry) => entry.token === token);
};
async function until(read, done, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return { value, waitedMs: Date.now() - started };
    await sleep(150);
  }
}

// ---- what people do ------------------------------------------------------------------------------------
async function join(who) {
  const signup = await send(who, 'POST', '/api/register', {
    name: `Hosted shape ${who.label}`,
    email: who.email,
    password: who.password,
    role: 'helper',
    phone: '+91 90000 00001',
    organizationName: null,
    organizationType: null,
    addressLine: '12 Local Test Street',
    cityOrDistrict: 'Sambalpur',
    stateOrRegion: 'Odisha',
    postalCode: '768001',
    profileNotes: 'Fictional local account used only to verify notification delivery end to end.',
    acceptedTerms: true,
  });
  if (signup.status !== 201) throw new Error(`sign-up for ${who.label} returned HTTP ${signup.status}: ${signup.text.slice(0, 200)}`);
  // Nobody calls the scheduled drain here. On the hosted site nobody does, for hours.
  const mail = await emailLink(who, '/api/auth/verify-email', 60_000);
  if (!mail) throw new Error(`the verification email for ${who.label} never arrived, with no worker and nobody calling the drain`);
  who.mailWaitedMs = mail.waitedMs;
  const opened = await fetch(mail.url, { redirect: 'manual', headers: { 'X-Forwarded-For': who.ip } });
  if (opened.status >= 400) throw new Error(`the verification link for ${who.label} returned HTTP ${opened.status}`);
  const login = await send(who, 'POST', '/api/auth/sign-in/email', { email: who.email, password: who.password });
  if (login.status !== 200) throw new Error(`sign-in for ${who.label} returned HTTP ${login.status}: ${login.text.slice(0, 200)}`);
  who.id = (await rows('select id from public."user" where email = $1', [who.email]))[0].id;
  return who;
}

async function askToHelp(who) {
  const response = await send(who, 'POST', '/api/onboarding', { role: 'helper', trainingAcknowledged: true, availabilityNotes: 'Evenings.' });
  if (response.status !== 201) throw new Error(`the Helper request for ${who.label} returned HTTP ${response.status}: ${response.text.slice(0, 200)}`);
}

/** What `pushManager.subscribe({ applicationServerKey })` hands the page. */
async function browserSubscribes(who, mode = 'ok') {
  const settings = await send(who, 'GET', '/api/account/push');
  return (await fetch(`${standIn}/control/subscribe?mode=${mode}&vapid=${encodeURIComponent(settings.json.publicKey)}`)).json();
}

async function turnOn(who, mode = 'ok') {
  const subscription = await browserSubscribes(who, mode);
  const response = await send(who, 'POST', '/api/account/push', subscription);
  if (response.status !== 201) throw new Error(`"Turn on for this device" for ${who.label} returned HTTP ${response.status}: ${response.text.slice(0, 200)}`);
  return subscription;
}

const decide = (operator, helper, reason) => send(operator, 'POST', `/api/admin/helpers/${helper.id}/decision`, { decision: 'reject', reason });

async function main() {
  // ---- 0. the shape -------------------------------------------------------------------------------
  console.log('\nHosted shape: a web process, a mail server, a push service. No long-lived worker.');
  const ready = await until(
    () => fetch(`${base}/api/health`, { signal: AbortSignal.timeout(20_000) }).then((response) => response.json(), () => null),
    (health) => health !== null,
    180_000,
  );
  if (!ready.value) throw new Error('the web process did not answer /api/health within three minutes');
  await until(() => fetch(`${standIn}/control/ready`).then((r) => r.ok, () => false), Boolean, 20_000);
  expect(ready.value.push?.configured === true, 'health reports that device notifications are configured');
  console.log(`       worker heartbeat, for the record: ${JSON.stringify(ready.value.worker?.status ?? null)} (this run starts none)`);

  // ---- 1. sign up; the verification email has to leave by itself --------------------------------------
  console.log('\nA person signs up');
  const drainBefore = (await rows(`select updated_at from public.service_health where service = 'scheduled-drain'`))[0]?.updated_at ?? null;
  const helper = await join(person('helper'));
  expect(Number.isFinite(helper.mailWaitedMs), 'the verification email arrived with nobody calling the drain', `${helper.mailWaitedMs} ms after sign-up`);
  // The public page says so too. This is the only evidence anybody outside the process can look at
  // that the host ran work after the response, and it is what will be read on the real site.
  const seen = await until(
    () => fetch(`${base}/api/health`).then((response) => response.json()),
    (health) => health.delivery?.afterResponse?.status === 'seen' && health.delivery.afterResponse.ageSeconds <= 30,
    15_000,
  );
  expect(seen.value.delivery?.afterResponse?.status === 'seen' && seen.value.delivery.afterResponse.ageSeconds <= 30,
    'and the health page reports that a request delivered after answering', JSON.stringify(seen.value.delivery?.afterResponse));
  await askToHelp(helper);

  // ---- 2. turn notifications on ---------------------------------------------------------------------
  console.log('\nThey turn notifications on for their phone');
  const settings = await send(helper, 'GET', '/api/account/push');
  expect(settings.status === 200 && settings.json.configured === true && settings.json.publicKey === vapid.publicKey,
    'the page is given the key to subscribe with');
  const phone = await browserSubscribes(helper);
  const registered = await send(helper, 'POST', '/api/account/push', phone);
  expect(registered.status === 201, '"Turn on for this device" is accepted', `HTTP ${registered.status} ${registered.text.slice(0, 120)}`);
  const listed = await send(helper, 'GET', '/api/account/push');
  const fingerprint = createHash('sha256').update(phone.endpoint).digest('base64url');
  expect(listed.json.devices.length === 1 && listed.json.devices[0].fingerprint === fingerprint,
    'the device is listed back, recognisable to the browser that holds it', listed.json.devices[0]?.label);
  expect(!listed.text.includes(phone.endpoint) && !listed.text.includes(phone.keys.auth) && !listed.text.includes(phone.keys.p256dh),
    'and its endpoint and keys are not in that response');

  const test = await send(helper, 'POST', '/api/account/push/test', { endpoint: phone.endpoint });
  const tested = await received(phone);
  expect(test.status === 200 && test.json.status === 'delivered', '"Send a test notification" reports delivered', test.text.slice(0, 80));
  expect(tested.length === 1 && tested[0].status === 201 && tested[0].payload.body.startsWith('Test notification.'),
    'the push service verified the signature and decrypted the test', JSON.stringify(tested[0]?.payload?.title));
  expect(tested[0].vapid.aud === pushOrigin && Number(tested[0].ttl) > 0, 'signed for that push service, with a time to live', `ttl ${tested[0].ttl}`);

  // ---- 3. an operator, with a second factor ---------------------------------------------------------
  console.log('\nAn operator is appointed and enrols an authenticator app');
  const operator = await join(person('operator'));
  await run(process.execPath, ['--import', 'tsx', 'scripts/bootstrap-admin.ts'], {
    env: { ...process.env, ALLOW_ADMIN_BOOTSTRAP: 'true', BOOTSTRAP_ADMIN_EMAIL: operator.email, BOOTSTRAP_ADMIN_REASON: 'Local hosted-shape verification of notification delivery only.' },
  });
  const locked = await send(operator, 'GET', '/api/account/push');
  expect(locked.status === 403 && locked.json?.error?.code === 'TWO_FACTOR_ENROLMENT_REQUIRED',
    'a platform account is refused until it has a second factor');
  const enable = await send(operator, 'POST', '/api/auth/two-factor/enable', { password: operator.password });
  expect(enable.status === 200 && typeof enable.json?.totpURI === 'string', 'enrolment starts', `HTTP ${enable.status} ${enable.status === 200 ? '' : enable.text.slice(0, 120)}`);
  const verify = await send(operator, 'POST', '/api/auth/two-factor/verify-totp', { code: totp(new URL(enable.json.totpURI).searchParams.get('secret')) });
  expect(verify.status === 200, 'the authenticator code is accepted', `HTTP ${verify.status}`);
  expect((await send(operator, 'GET', '/api/account/push')).status === 200, 'and the account is served from then on');

  // ---- 4. the thing this is all for -------------------------------------------------------------------
  console.log('\nThe operator decides the person\'s request; the person is not looking at the site');
  const before = (await received(phone)).length;
  const reason = 'Thank you for applying. We need a service area before we can approve this.';
  const decision = await decide(operator, helper, reason);
  expect(decision.status === 200, 'the decision is recorded', `HTTP ${decision.status} ${decision.status === 200 ? '' : decision.text.slice(0, 160)}`);
  const arrival = await until(() => received(phone), (entries) => entries.length > before, 45_000);
  const push = arrival.value[before];
  expect(Boolean(push) && push.status === 201, 'their phone is told, with no worker and nobody calling the drain', `${arrival.waitedMs} ms after the operator's response`);
  expect(push.payload.title === 'Helper request rejected' && push.payload.body === reason && push.payload.href === '/app/onboarding',
    'with the title, the text and the link the notification has in the app', JSON.stringify(push.payload.title));
  const recorded = await until(() => notificationsOf(helper), (list) => list.at(-1)?.finished === true, 10_000);
  expect(recorded.value.at(-1)?.outcome === 'delivered' && recorded.value.at(-1)?.attempts === 1, 'and it is recorded as delivered, on the first try');

  // ---- 5. a device that is gone -----------------------------------------------------------------------
  console.log('\nThe same, for somebody whose browser has since unsubscribed');
  const moved = await join(person('gone'));
  await askToHelp(moved);
  const oldPhone = await turnOn(moved, 'gone');
  await decide(operator, moved, 'Reason for the second request.');
  const goneState = await until(() => devicesOf(moved), (list) => list[0]?.revoked === true, 30_000);
  expect(goneState.value[0]?.revoked === true && goneState.value[0]?.last_error === 'push_service_410',
    'the device is retired, with the reason, instead of being retried for ever');
  expect((await received(oldPhone)).every((entry) => entry.status === 410), 'after the push service said 410');
  const goneNote = await until(() => notificationsOf(moved), (list) => list.at(-1)?.finished === true, 10_000);
  expect(goneNote.value.at(-1)?.outcome === 'no_device', 'and the notification is finished as having nowhere to go, not as delivered');

  // ---- 6. a push service having a bad minute ------------------------------------------------------------
  console.log('\nThe same, while the push service is failing');
  const unlucky = await join(person('retry'));
  await askToHelp(unlucky);
  const struggling = await turnOn(unlucky, 'twice');
  await decide(operator, unlucky, 'Reason for the third request.');
  const failed = await until(() => received(struggling), (entries) => entries.length >= 2, 30_000);
  expect(failed.value.length === 2 && failed.value.every((entry) => entry.status === 503), 'it is tried, and tried once more straight away');
  const pending = await until(() => notificationsOf(unlucky), (list) => list.at(-1)?.attempts === 1 && list.at(-1)?.finished === false, 10_000);
  await sleep(1_500);
  expect((await notificationsOf(unlucky)).at(-1)?.finished === false && pending.value.at(-1)?.outcome === null,
    'and is NOT written down as delivered: it stays pending');
  expect((await devicesOf(unlucky))[0]?.revoked === false, 'the device is kept: a bad minute is not a dead device');

  // The retry time is thirty seconds away. Rather than wait, the clock is moved for this one row.
  await rows(`update public.notifications set push_next_attempt_at = clock_timestamp() - interval '1 second' where user_id = $1 and push_delivered_at is null`, [unlucky.id]);
  const passBeforeDrain = (await rows(`select updated_at from public.service_health where service = 'after-response-delivery'`))[0]?.updated_at ?? null;
  const drain = await fetch(`${base}/api/worker/drain`, { method: 'POST', headers: { Authorization: `Bearer ${triggerToken}` }, signal: AbortSignal.timeout(120_000) });
  const drained = await drain.json();
  expect(drain.status === 200 && drained.push?.status === 'ok' && drained.push.delivered >= 1,
    'the scheduled drain sends it once the push service has recovered', JSON.stringify(drained.push));
  expect(!/https:\/\/|example\.test|p256dh/.test(JSON.stringify(drained)), 'and reports counts only');
  const afterDrain = await (await fetch(`${base}/api/health`)).json();
  const drainNow = (await rows(`select updated_at from public.service_health where service = 'scheduled-drain'`))[0]?.updated_at ?? null;
  expect(afterDrain.delivery?.scheduledDrain?.status === 'seen' && afterDrain.delivery.scheduledDrain.ageSeconds <= 30
    && drainNow !== null && (drainBefore === null || drainNow > drainBefore),
    'the health page reports that a scheduler reached the drain, which nothing was calling until now', JSON.stringify(afterDrain.delivery?.scheduledDrain));
  // Every drain also asks for one pass after it has answered. That is what keeps checking, on each
  // scheduled call, that the host still runs work after a response.
  const passAfterDrain = await until(
    async () => (await rows(`select updated_at from public.service_health where service = 'after-response-delivery'`))[0]?.updated_at ?? null,
    (value) => value !== null && (passBeforeDrain === null || value > passBeforeDrain),
    15_000,
  );
  expect(passAfterDrain.value !== null && (passBeforeDrain === null || passAfterDrain.value > passBeforeDrain),
    'and the drain was followed by a pass of its own after it answered', `${passAfterDrain.waitedMs} ms later`);
  const retried = await notificationsOf(unlucky);
  expect(retried.at(-1)?.outcome === 'delivered' && retried.at(-1)?.attempts === 2, 'delivered on the second pass, and recorded as such');
  expect((await received(struggling)).at(-1)?.status === 201, 'to the phone it was meant for');

  // ---- 7. whose device is whose -------------------------------------------------------------------------
  console.log('\nA shared phone');
  const second = await join(person('shared'));
  const forged = await browserSubscribes(second);
  const claim = await send(second, 'POST', '/api/account/push', { endpoint: phone.endpoint, keys: forged.keys });
  expect(claim.status === 409, 'knowing where somebody\'s device is does not hand it over', `HTTP ${claim.status}`);
  const takeover = await send(second, 'POST', '/api/account/push', phone);
  expect(takeover.status === 201, 'holding the same browser does', `HTTP ${takeover.status}`);
  expect((await send(helper, 'GET', '/api/account/push')).json.devices.length === 0, 'and the first person is no longer notified on it');

  // ---- 8. older mail in the way ------------------------------------------------------------------------
  // Nine messages whose links can no longer be read - a key that was rotated, an address that moved -
  // which is more than the pass after a request takes at a time. The queue is served oldest first, so
  // a pass that stopped after one batch would spend it on these and never reach the new message; and
  // here, as on the hosted site, nothing else is coming to send it. This is not a guess. The first
  // time this check ran on a database another check had left mail in, that is exactly what happened.
  console.log('\nOlder mail that can never be sent is waiting, and a person signs up');
  const stuck = `hosted-shape-stuck-${randomBytes(5).toString('hex')}`;
  await rows(
    `insert into public.email_outbox (recipient, kind, encrypted_payload, message_id, created_at, available_at)
     select $1 || '-' || n || '@example.test', 'verification', 'v1.not.a.ciphertext', '<' || $1 || '-' || n || '@annapurna-link.local>',
            clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours'
     from generate_series(1, 9) as n`, [stuck]);
  const behind = await join(person('behind'));
  expect(Number.isFinite(behind.mailWaitedMs), 'their verification email still leaves straight away', `${behind.mailWaitedMs} ms after sign-up`);
  const olderMail = await rows(
    `select status::text as status, attempts, available_at <= clock_timestamp() as due, last_error
     from public.email_outbox where recipient like $1`, [`${stuck}-%`]);
  expect(olderMail.length === 9 && olderMail.every((row) => row.status === 'pending' && row.attempts === 1 && !row.due && row.last_error === 'SMTP_OR_PAYLOAD_ERROR'),
    'and the older messages were each tried once and put back to wait, not dropped and not marked sent');

  // ---- 9. what the web role can reach when a request forgets to say who is asking ----------------------
  console.log('\nThe database, asked by the web role with no session');
  const web = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const visible = await web.query('select count(*)::int as count from public.push_subscriptions');
    expect(visible.rows[0].count === 0, 'shows no devices at all');
    const refusal = await web.query(`select * from public.app_push_targets_for(array[$1])`, [helper.id]).then(() => 'allowed', (error) => error.code);
    expect(refusal === '42501', 'and will not hand out the credentials that address one', `SQLSTATE ${refusal}`);
  } finally {
    await web.end();
  }
}

try {
  await main();
  console.log(`\nHosted-shape check passed: ${passed} expectations. Fictional example.test accounts remain in the isolated database.`);
} catch (error) {
  console.error(`\n  FAILED  ${error instanceof Error ? error.message : String(error)}`);
  console.error('\nLast lines from the services under test:');
  console.error(serverLog.slice(-30).join('\n'));
  process.exitCode = 1;
} finally {
  await owner.end().catch(() => undefined);
  stopAll();
}
