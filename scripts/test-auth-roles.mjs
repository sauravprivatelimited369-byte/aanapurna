// Verified role-routing checks on an isolated, disposable local deployment.
// Run ONLY with a disposable database: node --env-file=.env scripts/test-auth-roles.mjs
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { hashPassword } from 'better-auth/crypto';

const { Client } = pg;
const execFileAsync = promisify(execFile);
if (process.env.RUN_AUTH_ROLE_TEST !== 'true' || process.env.NODE_ENV === 'production') {
  console.error('Set RUN_AUTH_ROLE_TEST=true only for an isolated, disposable development database.');
  process.exit(1);
}
if (!process.env.MIGRATION_DATABASE_URL) {
  console.error('Missing MIGRATION_DATABASE_URL; load the local .env file first.');
  process.exit(1);
}

const base = 'http://localhost:3000';
const password = `Aa1!${randomBytes(20).toString('base64url')}`;
const admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL, connectionTimeoutMillis: 5000 });
await admin.connect();
const results = [];
const users = {};
const runThird = 1 + Math.floor(Math.random() * 200);
let ipCounter = 1;
const nextIp = () => `10.77.${runThird}.${ipCounter++ % 250}`;

function assert(condition, message) { if (!condition) throw new Error(message); }
async function http(path, options = {}) {
  const { method = 'GET', body, cookie, ip = nextIp(), origin = base } = options;
  const headers = { Origin: origin, 'X-Forwarded-For': ip };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  return fetch(base + path, {
    method, headers, redirect: 'manual',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const cookieFrom = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
async function login(email) {
  const response = await http('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
  assert(response.ok, `Login failed for ${email} (${response.status}).`);
  return cookieFrom(response);
}
async function check(id, name, fn) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail ?? '' });
  } catch (error) {
    results.push({ id, name, status: 'FAIL', detail: error instanceof Error ? error.message : 'unknown error' });
  }
}

// Trusted fixtures are inserted through the privileged migration role, not by
// the public registration API. They represent separate human-approved records.
async function createUser(label, emailVerified = true, profileStatus = 'active') {
  const id = randomUUID();
  const email = `role-${label}-${randomBytes(6).toString('hex')}@example.test`;
  const hash = await hashPassword(password);
  await admin.query('INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,$2,$3,$4)', [id, `Fictional ${label}`, email, emailVerified]);
  await admin.query("INSERT INTO public.account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, hash]);
  await admin.query('INSERT INTO public.user_profiles (user_id,account_status,display_name) VALUES ($1,$2,$3)', [id, profileStatus, `Fictional ${label}`]);
  users[label] = { id, email };
  return users[label];
}

try {
  await admin.query('BEGIN');
  const adminUser = await createUser('admin');
  const generator = await createUser('generator');
  const receiver = await createUser('receiver');
  const helper = await createUser('helper');
  const pending = await createUser('pending');
  const unverified = await createUser('unverified', false, 'pending');
  const area = randomUUID();
  await admin.query("INSERT INTO public.service_areas (id,label,country_code,timezone,active) VALUES ($1,'Fictional role-test area','IN','Asia/Kolkata',true)", [area]);
  for (const [label, type] of [['generator', 'generator'], ['receiver', 'receiver']]) {
    const org = randomUUID();
    await admin.query(`INSERT INTO public.organizations (id,name,type,status,service_area_id,operating_address,city_or_district,contact_name,contact_email,receiving_capacity,capacity_unit,food_capabilities,created_by,reviewed_by,reviewed_at,review_reason)
      VALUES ($1,$2,$3,'verified',$4,'Fictional address','Test district','Test contact','fixture@example.test',100,'servings',ARRAY['produce'],$5,$6,now(),'Fictional role fixture')`,
      [org, `Fictional ${label} organisation`, type, area, users[label].id, adminUser.id]);
    await admin.query("INSERT INTO public.organization_memberships (organization_id,user_id,role,status) VALUES ($1,$2,'owner','active')", [org, users[label].id]);
  }
  await admin.query("INSERT INTO public.helper_profiles (user_id,status,service_area_id,training_acknowledged_at,approved_by,approved_at,reviewed_by,reviewed_at) VALUES ($1,'active',$2,now(),$3,now(),$3,now())", [helper.id, area, adminUser.id]);
  await admin.query('COMMIT');
  void generator; void receiver; void pending; void unverified;

  await check(1, 'Trusted one-time bootstrap grants the Admin role only to a verified active user', async () => {
    const environment = {
      ...process.env,
      ALLOW_ADMIN_BOOTSTRAP: 'true',
      BOOTSTRAP_ADMIN_EMAIL: adminUser.email,
      BOOTSTRAP_ADMIN_REASON: 'Owner-authorised isolated authentication role-routing verification.',
    };
    const { stdout } = await execFileAsync(process.execPath, ['--env-file=.env', '--import', 'tsx', 'scripts/bootstrap-admin.ts'], {
      cwd: process.cwd(), env: environment, timeout: 15_000,
    });
    assert(stdout.includes('platform_role.bootstrap_granted'), 'Bootstrap did not report a grant.');
    const row = await admin.query("SELECT count(*)::int AS n FROM public.platform_roles WHERE user_id = $1 AND role = 'operations_admin'", [adminUser.id]);
    assert(row.rows[0]?.n === 1, 'Admin role was not stored.');
    let refused = false;
    try {
      await execFileAsync(process.execPath, ['--env-file=.env', '--import', 'tsx', 'scripts/bootstrap-admin.ts'], {
        cwd: process.cwd(),
        env: { ...environment, BOOTSTRAP_ADMIN_EMAIL: unverified.email },
        timeout: 15_000,
      });
    } catch { refused = true; }
    assert(refused, 'Unverified user was accepted for Admin bootstrap.');
    return 'verified active user granted; unverified user refused';
  });

  const cases = [
    { label: 'generator', dashboard: '/generator', forbidden: '/receiver' },
    { label: 'receiver', dashboard: '/receiver', forbidden: '/generator' },
    { label: 'helper', dashboard: '/helper', forbidden: '/admin' },
    { label: 'admin', dashboard: '/admin', forbidden: '/generator' },
  ];
  let id = 2;
  for (const item of cases) {
    await check(id, `${item.label} login resolves to ${item.dashboard} and denies an unapproved dashboard`, async () => {
      const cookie = await login(users[item.label].email);
      const continueResponse = await http('/auth/continue', { cookie });
      assert(continueResponse.headers.get('location') === item.dashboard, `Post-login destination was not ${item.dashboard}.`);
      const allowed = await http(item.dashboard, { cookie });
      assert(allowed.status === 200, `Approved dashboard ${item.dashboard} returned ${allowed.status}.`);
      const denied = await http(item.forbidden, { cookie });
      assert(denied.status === 307 || denied.status === 302, `Unapproved dashboard ${item.forbidden} was served.`);
      assert((denied.headers.get('location') ?? '').includes(item.dashboard), 'Unapproved dashboard did not redirect to the trusted primary dashboard.');
      return `login → ${item.dashboard}; ${item.forbidden} → ${item.dashboard}`;
    });
    id += 1;
  }

  await check(id, 'Admin API is available to the granted Admin and denied to a Generator', async () => {
    const adminCookie = await login(adminUser.email);
    const generatorCookie = await login(users.generator.email);
    const allowed = await http('/api/admin/overview', { cookie: adminCookie });
    assert(allowed.status === 200, `Admin API returned ${allowed.status}.`);
    const denied = await http('/api/admin/overview', { cookie: generatorCookie });
    assert(denied.status === 403, `Generator received Admin API status ${denied.status}.`);
    return 'Admin 200, Generator 403';
  });

  await check(id + 1, 'Verified account without an approved role stays pending', async () => {
    const cookie = await login(pending.email);
    const destination = await http('/auth/continue', { cookie });
    assert(destination.headers.get('location') === '/account/pending', 'Pending account was sent to an operational dashboard.');
    const page = await http('/generator', { cookie });
    assert(page.status === 307 || page.status === 302, 'Pending account opened the Generator dashboard.');
    return 'login → /account/pending; /generator redirects';
  });
} catch (error) {
  await admin.query('ROLLBACK').catch(() => {});
  results.push({ id: 0, name: 'Fixture setup', status: 'FAIL', detail: error instanceof Error ? error.message : 'unknown error' });
} finally {
  await admin.end().catch(() => {});
}

console.log('\nTrusted role-routing test results (isolated local PostgreSQL)');
for (const result of results) {
  console.log(`${String(result.id).padStart(2)}   ${result.status.padEnd(6)}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
const failures = results.filter((result) => result.status === 'FAIL');
console.log(`\n${results.length - failures.length}/${results.length} checks passed. ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
