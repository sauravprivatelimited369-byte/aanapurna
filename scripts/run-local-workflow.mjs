// Browser E2E fixture runner. Only an empty, disposable local test database is allowed.
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import pg from 'pg';
import { hashPassword } from 'better-auth/crypto';

if (process.env.RUN_LOCAL_WORKFLOW_TEST !== 'true' || process.env.NODE_ENV === 'production' || process.env.OPERATIONS_ENABLED !== 'false' || process.env.APP_URL !== 'http://localhost:3000') {
  throw new Error('Requires explicit RUN_LOCAL_WORKFLOW_TEST=true, local APP_URL and operations disabled in an isolated development environment.');
}
let server;
for (const [key, role] of Object.entries({ DATABASE_URL: 'annapurna_app', AUTH_DATABASE_URL: 'annapurna_auth', WORKER_DATABASE_URL: 'annapurna_worker', MIGRATION_DATABASE_URL: 'annapurna_migrator' })) {
  const url = new URL(process.env[key] ?? 'invalid:');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/annapurna_link_test' || url.search || url.hash || decodeURIComponent(url.username) !== role) throw new Error(`${key} must use the expected role and local isolated annapurna_link_test database.`);
  const target = `${url.hostname === 'localhost' ? '127.0.0.1' : url.hostname}:${url.port || '5432'}`;
  if (server && server !== target) throw new Error('All database URLs must use the same isolated server.');
  server = target;
}
const occupied = await new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: 3000 });
  socket.setTimeout(1500);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => { socket.destroy(); resolve(true); });
});
if (occupied) throw new Error('Port 3000 is in use. Stop the existing server; this test starts an isolated loopback-only server.');
const db = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await db.connect();
const password = randomBytes(24).toString('base64url');
try {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const { tablename } of tables.rows) {
    const result = await db.query(`SELECT count(*)::text AS count FROM public.${pg.escapeIdentifier(tablename)}`);
    if (result.rows[0].count !== '0') throw new Error(`The isolated test database must be empty; ${tablename} contains data.`);
  }
  const roles = ['generator', 'receiver', 'helper1', 'helper2', 'admin', 'safety'];
  const ids = Object.fromEntries(roles.map((role) => [role, `browser-test-${randomUUID()}`]));
  const passwordHash = await hashPassword(password);
  await db.query('BEGIN');
  for (const role of roles) {
    const id = ids[role];
    await db.query('INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,$2,$3,true)', [id, `Fictional ${role}`, `${role}@example.test`]);
    await db.query("INSERT INTO public.account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, passwordHash]);
    await db.query("INSERT INTO public.user_profiles (user_id,account_status,display_name,demo_account) VALUES ($1,'active',$2,true)", [id, `Fictional ${role}`]);
  }
  await db.query("INSERT INTO public.platform_roles (user_id,role,reason) VALUES ($1,'operations_admin','Fictional browser test fixture'),($2,'safety_officer','Fictional browser test fixture')", [ids.admin, ids.safety]);
  const area = randomUUID();
  await db.query("INSERT INTO public.service_areas (id,label,country_code,timezone,active) VALUES ($1,'Fictional browser test area','IN','Asia/Kolkata',true)", [area]);
  for (const role of ['generator', 'receiver']) {
    const org = randomUUID();
    await db.query(`INSERT INTO public.organizations (id,name,type,status,service_area_id,operating_address,city_or_district,contact_name,contact_email,receiving_capacity,capacity_unit,food_capabilities,created_by,reviewed_by,reviewed_at,review_reason)
      VALUES ($1,$2,$3,'verified',$4,'Fictional address','Test district','Test contact','fixture@example.test',100,'servings',ARRAY['produce'],$5,$6,now(),'Fictional browser fixture')`, [org, `Fictional ${role}`, role, area, ids[role], ids.admin]);
    await db.query("INSERT INTO public.organization_memberships (organization_id,user_id,role,status) VALUES ($1,$2,'owner','active')", [org, ids[role]]);
  }
  for (const role of ['helper1','helper2']) {
    await db.query("INSERT INTO public.helper_profiles (user_id,status,service_area_id,training_acknowledged_at,approved_by,approved_at,reviewed_by,reviewed_at) VALUES ($1,'active',$2,now(),$3,now(),$3,now())", [ids[role], area, ids.admin]);
  }
  const rules = { allowedCategories: ['produce'], allowedFoodTypes: ['vegetarian'], minimumPickupLeadMinutes: 0, minimumExpiryAfterPickupMinutes: 0, offerResponseMinutes: 60, allowPartialAcceptance: false, requireAllergenDisclosure: true };
  await db.query("INSERT INTO public.policy_versions (version,status,rules,created_by,approved_by,approved_at,effective_from) VALUES ('fictional-browser-test','approved',$1,$2,$3,now(),now()-interval '1 minute')", [JSON.stringify(rules), ids.admin, ids.safety]);
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  throw error;
} finally { await db.end(); }
console.log('Fictional browser fixtures created in disposable test database. No real operations or approvals.');
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/local-workflow.integration.spec.ts', '--workers=1'], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', OPERATIONS_ENABLED: 'true', RUN_LOCAL_WORKFLOW_E2E: 'true', PLAYWRIGHT_BASE_URL: 'http://localhost:3000', WORKFLOW_TEST_PASSWORD: password },
});
child.on('error', () => { console.error('Unable to start the browser test.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
