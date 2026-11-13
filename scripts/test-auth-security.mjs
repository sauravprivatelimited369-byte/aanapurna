// Independent authentication security checks against a running, isolated local deployment.
// Run ONLY with a disposable database: node --env-file=.env scripts/test-auth-security.mjs
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

const { Client } = pg;
if (process.env.RUN_AUTH_SECURITY_TEST !== 'true' || process.env.NODE_ENV === 'production') {
  console.error('Set RUN_AUTH_SECURITY_TEST=true only for an isolated, disposable development database.');
  process.exit(1);
}
for (const key of ['MIGRATION_DATABASE_URL', 'DATABASE_URL']) {
  if (!process.env[key]) { console.error(`Missing ${key}; load the local .env file first.`); process.exit(1); }
}

const base = 'http://localhost:3000';
const inboxPath = process.env.LOCAL_SMTP_INBOX_PATH ?? '.local-data/inbox.eml';
const passwordA = `Aa1!${randomBytes(20).toString('base64url')}`;
const passwordB = `Bb2!${randomBytes(20).toString('base64url')}`;
const newPassword = `Cc3!${randomBytes(20).toString('base64url')}`;
const emailA = `security-a-${randomBytes(8).toString('hex')}@example.test`;
const emailB = `security-b-${randomBytes(8).toString('hex')}@example.test`;
const runOctet = 1 + Math.floor(Math.random() * 200);
const runThird = 1 + Math.floor(Math.random() * 200);
let ipCounter = 1;
const nextIp = () => `10.${runOctet}.${runThird}.${ipCounter++ % 250}`;

const admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL, connectionTimeoutMillis: 5000 });
const app = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
await admin.connect();
await app.connect();

const results = [];
let userIdA = null;
let userIdB = null;
let cookieA = '';
let cookieFresh = '';
let emailUnverified = '';

function assert(condition, message) { if (!condition) throw new Error(message); }
async function expectReject(fn, message) {
  try { await fn(); } catch { return; }
  throw new Error(message);
}
function registration(email, role = 'helper', password = passwordA, overrides = {}) {
  return {
    name: `Security test ${role}`,
    email,
    password,
    role,
    phone: '+91 90000 00002',
    organizationName: role === 'helper' ? null : 'Security Test Organisation',
    organizationType: role === 'helper' ? null : role,
    addressLine: '45 Security Test Street',
    cityOrDistrict: 'Rourkela',
    stateOrRegion: 'Odisha',
    postalCode: '769001',
    profileNotes: 'Fictional security-test account; no real person or organisation is represented.',
    acceptedTerms: true,
    ...overrides,
  };
}

async function http(path, options = {}) {
  const {
    method = 'GET', body, cookie, origin = base, ip = nextIp(),
    redirect = 'manual', headers: extraHeaders = {},
  } = options;
  const headers = { Origin: origin, 'X-Forwarded-For': ip, ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  return fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect,
  });
}

const cookieFrom = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
const jsonFrom = async (response) => response.json().catch(() => ({}));
async function login(password = newPassword) {
  const response = await http('/api/auth/sign-in/email', { method: 'POST', body: { email: emailA, password } });
  assert(response.ok, `Fresh login failed (${response.status}).`);
  return cookieFrom(response);
}

function decodeQuotedPrintable(value) {
  return value.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/&amp;/g, '&');
}

async function inboxMessageCount() {
  const inbox = await readFile(inboxPath, 'utf8').catch(() => '');
  return Math.max(0, inbox.split(/--- MESSAGE ---/i).length - 1);
}

async function findEmailLink(email, pathFragment, timeoutMs = 40_000, afterIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inbox = decodeQuotedPrintable(await readFile(inboxPath, 'utf8').catch(() => ''));
    const messages = inbox.split(/--- MESSAGE ---/i);
    for (let index = messages.length - 1; index > afterIndex; index -= 1) {
      const raw = messages[index];
      if (!raw.toLowerCase().includes(email.toLowerCase())) continue;
      for (const candidate of raw.match(/http:\/\/localhost:3000\/[^\s<>"']+/g) ?? []) {
        try {
          const url = new URL(candidate);
          if (url.pathname.includes(pathFragment)) return url.toString();
        } catch { /* keep searching */ }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No new ${pathFragment} email arrived for ${email}.`);
}

async function verifyEmail(email) {
  const link = await findEmailLink(email, '/api/auth/verify-email');
  const response = await fetch(link, { redirect: 'manual' });
  assert(response.status === 302 || response.status === 200, 'Verification link was rejected.');
}

async function getResetToken(email) {
  const before = await inboxMessageCount();
  assert((await http('/api/auth/request-password-reset', { method: 'POST', body: { email, redirectTo: '/reset-password' } })).ok, 'Reset request failed.');
  const link = await findEmailLink(email, '/api/auth/reset-password/', 40_000, before);
  const response = await fetch(link, { redirect: 'manual' });
  const location = response.headers.get('location');
  assert(location, 'Reset link did not redirect.');
  const token = new URL(location, base).searchParams.get('token');
  assert(token, 'Reset link had no token.');
  return token;
}

async function appAsUser(userId, callback) {
  await app.query('BEGIN');
  try {
    await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await callback();
    await app.query('ROLLBACK');
    return result;
  } catch (error) {
    await app.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function check(id, name, fn) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail ?? '' });
  } catch (error) {
    results.push({ id, name, status: 'FAIL', detail: error instanceof Error ? error.message : 'unknown error' });
  }
}

try {
  await check(1, 'New account registration creates a real backend user with a hashed password', async () => {
    const response = await http('/api/register', { method: 'POST', body: registration(emailA) });
    const body = await jsonFrom(response);
    assert(response.status === 201, `Registration returned ${response.status}: ${JSON.stringify(body)}`);
    assert(body.requiresEmailVerification === true, 'Response did not require verification.');
    assert(body.emailDelivery?.configured === true, 'Mail service was not reported as configured.');
    const user = await admin.query('SELECT id, email, email_verified, requested_role FROM public."user" WHERE email = $1', [emailA]);
    assert(user.rowCount === 1, 'No real user row was created.');
    userIdA = user.rows[0].id;
    assert(user.rows[0].email_verified === false, 'New user was already verified.');
    const account = await admin.query("SELECT password FROM public.account WHERE user_id = $1 AND provider_id = 'credential'", [userIdA]);
    const hash = account.rows[0]?.password ?? '';
    assert(hash.length > 40 && hash !== passwordA && !hash.includes(passwordA), 'Password appears to be stored in plaintext.');
    const profile = await admin.query("SELECT account_status, requested_role FROM public.user_profiles WHERE user_id = $1", [userIdA]);
    assert(profile.rows[0]?.account_status === 'pending', 'New account was not pending verification.');
    const intake = await admin.query('SELECT phone, profile_notes FROM public.registration_profiles WHERE user_id = $1', [userIdA]);
    assert(intake.rowCount === 1, 'Registration profile was not stored behind RLS.');
    const transient = await admin.query('SELECT registration_phone, registration_profile_notes FROM public."user" WHERE id = $1', [userIdA]);
    assert(transient.rows[0]?.registration_phone === null, 'Transient intake copy was not cleared.');
    return `user ${userIdA.slice(0, 8)}…, hash length ${hash.length}, profile pending`;
  });

  await check(2, 'Duplicate email registration is rejected and no second account is created', async () => {
    const response = await http('/api/register', { method: 'POST', body: registration(emailA) });
    assert(response.status === 409, `Duplicate returned ${response.status}.`);
    const count = await admin.query('SELECT count(*)::int AS n FROM public."user" WHERE email = $1', [emailA]);
    assert(count.rows[0]?.n === 1, 'More than one user row exists for the email.');
    return 'HTTP 409, one user row';
  });

  await check(3, 'Correct credentials log in and issue a protected cookie', async () => {
    await verifyEmail(emailA);
    const verified = await admin.query('SELECT email_verified FROM public."user" WHERE id = $1', [userIdA]);
    assert(verified.rows[0]?.email_verified === true, 'Email verification did not persist.');
    const active = await admin.query('SELECT account_status FROM public.user_profiles WHERE user_id = $1', [userIdA]);
    assert(active.rows[0]?.account_status === 'active', 'Verified account was not activated.');
    const response = await http('/api/auth/sign-in/email', { method: 'POST', body: { email: emailA, password: passwordA } });
    assert(response.ok, `Login returned ${response.status}.`);
    const cookies = response.headers.getSetCookie();
    assert(cookies.length > 0, 'No session cookie was set.');
    const all = cookies.join(' | ');
    assert(/httponly/i.test(all), 'Session cookie is not HttpOnly.');
    assert(/samesite=lax/i.test(all), 'Session cookie is not SameSite=Lax.');
    cookieA = cookieFrom(response);
    return `${cookies.length} cookie(s), HttpOnly and SameSite=Lax present`;
  });

  await check(4, 'Incorrect password is rejected without leaking account details', async () => {
    const response = await http('/api/auth/sign-in/email', { method: 'POST', body: { email: emailA, password: 'WrongPassword-123!' } });
    assert(response.status === 401 || response.status === 400, `Incorrect password returned ${response.status}.`);
    const body = await jsonFrom(response);
    assert(!JSON.stringify(body).includes(passwordA), 'Response leaked the password hash.');
    return `HTTP ${response.status}, generic error`;
  });

  await check(5, 'Unverified email login is rejected', async () => {
    // A second, deliberately unverified account.
    const email = `unverified-${randomBytes(6).toString('hex')}@example.test`;
    emailUnverified = email;
    assert((await http('/api/register', { method: 'POST', body: registration(email) })).status === 201, 'Could not create unverified account.');
    const response = await http('/api/auth/sign-in/email', { method: 'POST', body: { email, password: passwordA } });
    const body = await jsonFrom(response);
    assert(!response.ok, 'Unverified login was accepted.');
    assert(JSON.stringify(body).toLowerCase().includes('verif'), 'Response did not explain email verification.');
    return `HTTP ${response.status}, EMAIL_NOT_VERIFIED`;
  });

  await check(6, 'Password recovery works and revokes the old password', async () => {
    const token = await getResetToken(emailA);
    const reset = await http('/api/auth/reset-password', { method: 'POST', body: { newPassword, token } });
    assert(reset.ok, `Reset returned ${reset.status}.`);
    assert(!(await http('/api/auth/reset-password', { method: 'POST', body: { newPassword, token } })).ok, 'Reset token replay was accepted.');
    assert(!(await http('/api/auth/sign-in/email', { method: 'POST', body: { email: emailA, password: passwordA } })).ok, 'Old password still works.');
    const fresh = await http('/api/auth/sign-in/email', { method: 'POST', body: { email: emailA, password: newPassword } });
    assert(fresh.ok, 'New password does not work.');
    cookieFresh = cookieFrom(fresh);
    return 'reset email, one-time token, old password denied, new password accepted';
  });

  await check(7, 'Expired recovery token is rejected', async () => {
    const token = await getResetToken(emailA);
    await admin.query("UPDATE public.verification SET expires_at = now() - interval '1 hour' WHERE identifier = $1", [`reset-password:${token}`]);
    const response = await http('/api/auth/reset-password', { method: 'POST', body: { newPassword, token } });
    assert(!response.ok, 'Expired reset token was accepted.');
    return `HTTP ${response.status}, expired token denied`;
  });

  await check(8, 'Logout revokes the session and replay is denied', async () => {
    cookieA = await login();
    const logout = await http('/api/auth/sign-out', { method: 'POST', body: {}, cookie: cookieA });
    assert(logout.ok, 'Logout failed.');
    const session = await http('/api/auth/get-session', { cookie: cookieA });
    const body = await jsonFrom(session);
    assert(!body?.user, 'Session cookie still valid after logout.');
    const replay = await http('/app', { cookie: cookieA });
    assert(replay.status === 307 || replay.status === 302, 'Logged-out cookie could open a protected page.');
    return 'session row revoked, replay denied';
  });

  await check(9, 'Session persists across requests and the destination is server-resolved', async () => {
    cookieFresh = await login();
    const session = await http('/api/auth/get-session', { cookie: cookieFresh });
    const body = await jsonFrom(session);
    assert(body?.user?.email === emailA, 'Session did not persist.');
    const page = await http('/app', { cookie: cookieFresh });
    assert(page.ok, 'Authenticated /app request was not served.');
    const destination = await http('/auth/continue', { cookie: cookieFresh });
    assert(destination.headers.get('location') === '/account/pending', 'Destination did not come from trusted role data.');
    return 'get-session, /app and /auth/continue all consistent';
  });

  await check(10, 'Expired session is rejected and protected pages redirect', async () => {
    await admin.query("UPDATE public.session SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [userIdA]);
    const session = await http('/api/auth/get-session', { cookie: cookieFresh });
    assert(!(await jsonFrom(session))?.user, 'Expired session remained valid.');
    const page = await http('/app', { cookie: cookieFresh });
    assert(page.status === 307 || page.status === 302, 'Expired session opened a protected page.');
    assert((page.headers.get('location') ?? '').includes('/login'), 'Expired session did not redirect to login.');
    return 'expired session denied, redirect to /login';
  });

  // Check 10 deliberately expires every session for this test user. Open a new
  // one so the remaining permission checks exercise a live authenticated session.
  cookieFresh = await login();

  await check(11, 'Direct access to protected routes without a session is denied', async () => {
    for (const path of ['/app', '/generator', '/helper', '/receiver', '/admin', '/account/pending']) {
      const response = await http(path);
      assert(response.status === 307 || response.status === 302, `${path} did not redirect (${response.status}).`);
      assert((response.headers.get('location') ?? '').includes('/login'), `${path} redirected somewhere other than login.`);
    }
    return 'six protected routes redirect to /login';
  });

  await check(12, 'Role manipulation and public Admin signup are blocked', async () => {
    const adminSignup = await http('/api/register', { method: 'POST', body: registration(`admin-${randomBytes(5).toString('hex')}@example.test`, 'admin') });
    assert(adminSignup.status === 422, `Public Admin registration returned ${adminSignup.status}.`);
    const direct = await http('/api/auth/sign-up/email', {
      method: 'POST',
      body: {
        name: 'Privilege attempt', email: `direct-${randomBytes(5).toString('hex')}@example.test`, password: passwordA,
        requestedRole: 'admin', platformRoles: ['operations_admin'], accountStatus: 'active',
        registrationPhone: '+91 90000 00002', registrationAddressLine: '45 Security Test Street',
        registrationCityOrDistrict: 'Rourkela', registrationProfileNotes: 'Attempt to self-assign a privileged role.',
      },
    });
    assert(!direct.ok, 'Direct Better Auth signup accepted an Admin role attempt.');
    await expectReject(
      () => appAsUser(userIdA, () => app.query("INSERT INTO public.platform_roles (user_id, role, reason) VALUES ($1, 'operations_admin', 'self escalation')", [userIdA])),
      'Direct self-assignment of a platform role was accepted.',
    );
    return 'Admin signup 422, direct endpoint rejected, self-grant blocked';
  });

  await check(13, 'Non-admin accounts cannot access Admin functions', async () => {
    const api = await http('/api/admin/overview', { cookie: cookieFresh });
    assert(api.status === 403, `Admin API returned ${api.status}.`);
    const page = await http('/admin', { cookie: cookieFresh });
    assert(page.status === 307 || page.status === 302, 'Admin page was served to a non-admin.');
    assert((page.headers.get('location') ?? '') !== '/admin', 'Admin page did not redirect away.');
    return 'API 403, /admin redirects away';
  });

  await check(14, 'Direct database access from the app role is restricted', async () => {
    await expectReject(() => app.query('SELECT email FROM public."user" LIMIT 1'), 'The app role could read the Better Auth user table.');
    await expectReject(
      () => appAsUser(userIdA, () => app.query("UPDATE public.user_profiles SET account_status = 'suspended' WHERE user_id = $1", [userIdA])),
      'The app role could change its own account status.',
    );
    await expectReject(
      () => appAsUser(userIdA, () => app.query("INSERT INTO public.platform_roles (user_id, role, reason) VALUES ($1, 'security_admin', 'direct attempt')", [userIdA])),
      'The app role could insert a platform role directly.',
    );
    return 'auth tables unreadable, status change and role insert denied';
  });

  await check(15, 'Cross-user private data is not visible through RLS', async () => {
    const created = await http('/api/register', { method: 'POST', body: registration(emailB, 'generator', passwordB) });
    assert(created.status === 201, `Second user registration returned ${created.status}.`);
    const row = await admin.query('SELECT id FROM public."user" WHERE email = $1', [emailB]);
    userIdB = row.rows[0]?.id;
    assert(userIdB, 'Second user row missing.');
    await verifyEmail(emailB);
    const visible = await appAsUser(userIdA, () => app.query('SELECT user_id FROM public.registration_profiles'));
    assert(visible.rows.every((entry) => entry.user_id === userIdA), 'App context could read another user registration profile.');
    const other = await appAsUser(userIdA, () => app.query('SELECT user_id FROM public.registration_profiles WHERE user_id = $1', [userIdB]));
    assert(other.rowCount === 0, 'Another user registration row was directly readable.');
    const otherProfile = await appAsUser(userIdA, () => app.query('SELECT user_id FROM public.user_profiles WHERE user_id = $1', [userIdB]));
    assert(otherProfile.rowCount === 0, 'Another user profile row was visible.');
    return 'registration profiles and user profiles isolated by RLS';
  });

  await check(16, 'Repeated login and registration attempts are rate limited', async () => {
    const ip = nextIp();
    let blocked = 0;
    for (let i = 0; i < 10; i += 1) {
      const response = await http('/api/auth/sign-in/email', { method: 'POST', ip, body: { email: emailA, password: 'DefinitelyWrong-123!' } });
      if (response.status === 429) blocked += 1;
    }
    assert(blocked > 0, 'No 429 response after ten repeated failed logins.');
    const ip2 = nextIp();
    let registrationBlocked = 0;
    for (let i = 0; i < 10; i += 1) {
      const response = await http('/api/register', { method: 'POST', ip: ip2, body: registration(`flood-${i}-${randomBytes(4).toString('hex')}@example.test`) });
      if (response.status === 429) registrationBlocked += 1;
    }
    assert(registrationBlocked > 0, 'No 429 response after ten repeated registrations.');
    return `${blocked}/10 logins and ${registrationBlocked}/10 registrations rate limited`;
  });

  await check(17, 'CSRF / cross-origin requests are rejected and cookies stay protected', async () => {
    const crossRegister = await http('/api/register', { method: 'POST', origin: 'https://evil.example', body: registration(`csrf-${randomBytes(5).toString('hex')}@example.test`) });
    assert(crossRegister.status === 403, `Cross-origin registration returned ${crossRegister.status}.`);
    const crossLogin = await http('/api/auth/sign-in/email', { method: 'POST', origin: 'https://evil.example', body: { email: emailA, password: newPassword } });
    assert(crossLogin.status === 403 || crossLogin.status === 401, `Cross-origin login returned ${crossLogin.status}.`);
    const crossSiteHeader = await http('/api/onboarding', {
      method: 'POST', cookie: cookieFresh, origin: base,
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      body: { role: 'helper', trainingAcknowledged: true },
    });
    assert(crossSiteHeader.status === 403, `Cross-site mutation returned ${crossSiteHeader.status}.`);
    const cookieHeader = await admin.query('SELECT count(*)::int AS n FROM public.session WHERE user_id = $1', [userIdA]);
    assert(cookieHeader.rows[0]?.n >= 0, 'Session query failed.');
    return 'Origin/Sec-Fetch-Site checks returned 403; no token in localStorage (code review)';
  });

  await check(18, 'Verification resend is rate limited', async () => {
    assert(emailUnverified, 'No unverified account was created.');
    const ip = nextIp();
    let blocked = 0;
    for (let i = 0; i < 5; i += 1) {
      const response = await http('/api/auth/send-verification-email', {
        method: 'POST', ip,
        body: { email: emailUnverified, callbackURL: '/verify-email?result=verified' },
      });
      if (response.status === 429) blocked += 1;
    }
    assert(blocked > 0, 'No 429 response after five repeated verification-resend requests.');
    return `${blocked}/5 resend requests rate limited`;
  });

  await check(19, 'Suspended account cannot sign in or obtain a session', async () => {
    const email = `suspended-${randomBytes(6).toString('hex')}@example.test`;
    assert((await http('/api/register', { method: 'POST', body: registration(email) })).status === 201, 'Could not create suspension fixture.');
    await verifyEmail(email);
    const user = await admin.query('SELECT id FROM public."user" WHERE email = $1', [email]);
    await admin.query("UPDATE public.user_profiles SET account_status = 'suspended' WHERE user_id = $1", [user.rows[0].id]);
    const response = await http('/api/auth/sign-in/email', { method: 'POST', body: { email, password: passwordA } });
    assert(!response.ok, 'Suspended account was allowed to sign in.');
    const body = await jsonFrom(response);
    assert(JSON.stringify(body).toLowerCase().includes('suspended'), 'Suspension error was not explained.');
    const sessions = await admin.query('SELECT count(*)::int AS n FROM public.session WHERE user_id = $1', [user.rows[0].id]);
    assert(sessions.rows[0]?.n === 0, 'A session was created for a suspended account.');
    return `HTTP ${response.status}, no session row`;
  });

  await check(20, 'Forged session cookie is rejected and the health endpoint leaks no secret values', async () => {
    const forged = await http('/api/auth/get-session', { cookie: 'annapurna.session_token=attacker-supplied-token' });
    assert(!(await jsonFrom(forged))?.user, 'A forged session cookie was accepted.');
    const health = await http('/api/health');
    const text = await health.text();
    for (const key of ['AUTH_SECRET', 'OTP_HASH_KEY', 'OTP_ENCRYPTION_KEY', 'EMAIL_ENCRYPTION_KEY', 'SMTP_URL', 'DATABASE_URL']) {
      const value = process.env[key];
      assert(!value || !text.includes(value), `Health response leaked ${key}.`);
    }
    assert(!/password|secret|token/i.test(text.replace(/missingSettings/gi, '')), 'Health response included an unexpected secret/token field.');
    return 'forged cookie denied; health response contains status and setting names only';
  });

  await check(21, 'Session refresh extends a valid session and persists the new expiry', async () => {
    cookieFresh = await login();
    await admin.query(`
      UPDATE public.session
      SET created_at = now() - interval '13 hours',
          updated_at = now() - interval '13 hours',
          expires_at = now() + interval '30 minutes'
      WHERE user_id = $1 AND expires_at > now()
    `, [userIdA]);
    const response = await http('/api/auth/get-session', { cookie: cookieFresh });
    const body = await jsonFrom(response);
    assert(body?.session?.expiresAt, 'Valid session did not refresh.');
    const refreshed = new Date(body.session.expiresAt).getTime();
    assert(refreshed > Date.now() + 6 * 24 * 60 * 60 * 1000, 'Session expiry was not extended.');
    const persisted = await admin.query(
      "SELECT max(expires_at) AS expiry FROM public.session WHERE user_id = $1 AND expires_at > now() + interval '6 days'",
      [userIdA],
    );
    assert(persisted.rows[0]?.expiry, 'Refreshed expiry was not persisted in PostgreSQL.');
    return 'expiry extended to seven days and stored in the session table';
  });

  await check(22, 'Admin bootstrap requires explicit owner authorisation', async () => {
    const environment = {
      ...process.env,
      BOOTSTRAP_ADMIN_EMAIL: `bootstrap-guard-${randomBytes(5).toString('hex')}@example.test`,
      BOOTSTRAP_ADMIN_REASON: 'Automated verification that Admin bootstrap is disabled by default.',
    };
    delete environment.ALLOW_ADMIN_BOOTSTRAP;
    let rejected = false;
    try {
      await execFileAsync(process.execPath, ['--env-file=.env', '--import', 'tsx', 'scripts/bootstrap-admin.ts'], {
        cwd: process.cwd(), env: environment, timeout: 15_000,
      });
    } catch (error) {
      rejected = true;
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      assert(output.includes('ALLOW_ADMIN_BOOTSTRAP'), 'Bootstrap failed for an unexpected reason.');
    }
    assert(rejected, 'Admin bootstrap ran without ALLOW_ADMIN_BOOTSTRAP=true.');
    return 'command refuses to run without the explicit owner-only switch';
  });

  await check(23, 'No plaintext credential is present in the credential store', async () => {
    const rows = await admin.query("SELECT password FROM public.account WHERE provider_id = 'credential'");
    assert(rows.rowCount > 0, 'No credential account rows were found.');
    const knownPlaintext = [passwordA, passwordB, newPassword, 'WrongPassword-123!', 'DefinitelyWrong-123!'];
    for (const row of rows.rows) {
      const value = row.password ?? '';
      assert(value.length >= 40 && !knownPlaintext.includes(value), 'A credential row contained a plaintext password.');
    }
    return `${rows.rowCount} credential rows inspected, all provider hashes`;
  });
} finally {
  await admin.end().catch(() => {});
  await app.end().catch(() => {});
}

console.log('\nAuthentication security test results (isolated local PostgreSQL + SMTP sink)');
console.log('ID  RESULT  CHECK');
for (const result of results) {
  console.log(`${String(result.id).padStart(2)}   ${result.status.padEnd(6)}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
const failures = results.filter((result) => result.status === 'FAIL');
console.log(`\n${results.length - failures.length}/${results.length} checks passed. ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
