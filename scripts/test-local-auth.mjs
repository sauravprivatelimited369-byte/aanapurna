// Destructive to neither existing users nor data: creates one fictional test account.
// Run ONLY against an isolated local development database and local:start mail sink.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

if (process.env.RUN_LOCAL_AUTH_TEST !== 'true' || process.env.NODE_ENV === 'production') {
  console.error('Set RUN_LOCAL_AUTH_TEST=true only for an isolated development database.');
  process.exit(1);
}
const base = 'http://localhost:3000';
const email = `native-test-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(24).toString('base64url');
const inboxPath = '.local-data/inbox.eml';
const clientIp = `198.51.100.${10 + Math.floor(Math.random() * 200)}`;

const post = (path, body, cookie, ip = clientIp) => fetch(base + path, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: base,
    'X-Forwarded-For': ip,
    ...(cookie ? { Cookie: cookie } : {}),
  },
  body: JSON.stringify(body),
});

const registration = (address, role = 'helper', overrides = {}) => ({
  name: 'Local integration test',
  email: address,
  password,
  role,
  phone: '+91 90000 00001',
  organizationName: role === 'helper' ? null : 'Local Test Organisation',
  organizationType: role === 'helper' ? null : role,
  addressLine: '12 Local Test Street',
  cityOrDistrict: 'Rourkela',
  stateOrRegion: 'Odisha',
  postalCode: '769001',
  profileNotes: 'Fictional local integration account used only for automated authentication checks.',
  acceptedTerms: true,
  ...overrides,
});

function assert(condition, message) { if (!condition) throw new Error(message); }
async function findEmailLink(pathFragment) {
  for (let i = 0; i < 160; i++) {
    const inbox = await readFile(inboxPath, 'utf8').catch(() => '');
    const messages = inbox.split(/--- MESSAGE ---/).filter((message) => message.includes(email));
    for (const raw of messages.reverse()) {
      const message = raw.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&amp;/g, '&');
      for (const candidate of message.match(/http:\/\/localhost:3000\/[^\s<>"']+/g) ?? []) {
        const url = new URL(candidate);
        if (url.pathname.includes(pathFragment)) return url.toString();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('A local test email did not arrive within 40 seconds.');
}
async function main() {
  const health = await fetch(`${base}/api/health`);
  const state = await health.json();
  assert(health.ok && state.realOperationsEnabled === false, 'Local app is unavailable or real operations are enabled.');

  const signup = await post('/api/register', registration(email));
  assert(signup.status === 201, `Signup failed (${signup.status}).`);
  const signupBody = await signup.json();
  assert(signupBody.status === 'created' && signupBody.requiresEmailVerification, 'Signup did not confirm a real account.');
  assert((await post('/api/register', registration(email))).status === 409, 'Duplicate email registration was accepted.');
  assert((await post('/api/register', registration(`admin-${randomBytes(4).toString('hex')}@example.test`, 'admin'))).status === 422, 'Public Admin signup was accepted.');
  assert((await post('/api/register', registration(`weak-${randomBytes(4).toString('hex')}@example.test`, 'helper', { phone: 'not-a-phone' }))).status === 422, 'Invalid phone number was accepted.');

  assert(!(await post('/api/auth/sign-in/email', { email, password })).ok, 'Unverified login was not rejected.');
  const verify = await fetch(await findEmailLink('/api/auth/verify-email'), { redirect: 'manual' });
  assert(verify.status === 302 || verify.status === 200, 'Verification failed.');
  const login = await post('/api/auth/sign-in/email', { email, password });
  assert(login.ok, 'Verified login failed.');
  const cookie = login.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  const session = () => fetch(`${base}/api/auth/get-session`, { headers: { Cookie: cookie } }).then((res) => res.json());
  assert((await session())?.user, 'Session missing after login.');

  // The post-login destination is resolved from backend data, not a browser value.
  const destination = await fetch(`${base}/auth/continue`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert(destination.headers.get('location') === '/account/pending', 'Post-login destination was not resolved from trusted role data.');

  const admin = await fetch(`${base}/api/admin/overview`, { headers: { Cookie: cookie } });
  assert(admin.status === 403, 'An unprivileged user could access the admin overview.');
  assert(!(await post('/api/auth/sign-in/email', { email, password: 'incorrect-password-value' })).ok, 'Incorrect password was accepted.');
  assert((await post('/api/auth/sign-out', {}, cookie)).ok, 'Logout failed.');
  assert(!(await session()), 'Replayed session remained valid after logout.');

  assert((await post('/api/auth/request-password-reset', { email, redirectTo: '/reset-password' })).ok, 'Password reset request failed.');
  const redirect = await fetch(await findEmailLink('/api/auth/reset-password/'), { redirect: 'manual' });
  const location = redirect.headers.get('location');
  assert(location, 'Reset link did not redirect.');
  const token = new URL(location, base).searchParams.get('token');
  assert(token, 'Reset token missing.');
  const newPassword = randomBytes(24).toString('base64url');
  assert((await post('/api/auth/reset-password', { newPassword, token })).ok, 'Password reset failed.');
  assert(!(await post('/api/auth/reset-password', { newPassword, token })).ok, 'Reset token replay was accepted.');
  assert(!(await post('/api/auth/sign-in/email', { email, password })).ok, 'Old password still accepted.');
  assert((await post('/api/auth/sign-in/email', { email, password: newPassword })).ok, 'New password login failed.');
  console.log('PASS: full registration validation, duplicate/Admin denial, unverified denial, local verification email, login, trusted destination, admin denial, logout/replay denial, reset email, reset replay denial, password change.');
  console.log('A fictional example.test account remains in the isolated database; the private test inbox contains one-time links.');
}
main().catch((error) => { console.error(`Local auth test failed: ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 1; });
