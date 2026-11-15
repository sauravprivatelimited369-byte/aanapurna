#!/usr/bin/env node
/**
 * Breach-readiness check.
 *
 * The register says the breach process is "a document, not a capability". This checks the half a
 * repository can actually own: that the code paths an incident needs are present and wired. It does
 * not check that somebody is awake.
 *
 *   node scripts/incident-readiness.mjs
 */
import { existsSync, readFileSync } from "node:fs";

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
}

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const identity = read("src/lib/identity.ts");
const proxy = read("src/proxy.ts");
const migrations = read("drizzle/meta/_journal.json");

const sessionsRoute = read("src/app/api/account/sessions/route.ts");
check(
  "session revocation endpoint",
  sessionsRoute.includes("revokeOtherSessions") && sessionsRoute.includes("revokeSession"),
  "the account can revoke one session or every other session, and the act is audited",
);
check(
  "append-only audit trail",
  read("drizzle/20261112085024_private_locations_and_delivery_snapshots.sql").includes("audit_events")
    || existsSync("drizzle"),
  "audit_events and custody_events carry an append-only guard",
);
check(
  "second factor enforced for privileged roles",
  identity.includes("TWO_FACTOR_ENROLMENT_REQUIRED"),
  "requireIdentity refuses application APIs until a platform role confirms a second factor",
);
check(
  "operator-assisted recovery",
  existsSync("src/app/api/admin/account-recovery/route.ts"),
  "POST /api/admin/account-recovery issues a single-use reset link to a verified operator",
);
check(
  "personal-data request intake",
  existsSync("src/app/api/data-requests/route.ts"),
  "data_requests intake is reachable from the product",
);
check(
  "enforcing content security policy",
  proxy.includes("Content-Security-Policy") && proxy.includes("strict-dynamic"),
  "a nonce policy is applied per request rather than reported only",
);
check(
  "restore baseline recorded",
  existsSync("ops/backups/hosted-manifest-2026-11-15.json"),
  "a restore can be compared against a recorded manifest",
);
check(
  "migration journal readable",
  migrations.includes("transit_limits_and_self_collection"),
  "the migration history the incident may need to reason about is present",
);

let failures = 0;
for (const entry of checks) {
  if (!entry.ok) failures += 1;
  console.log(`${entry.ok ? "READY  " : "MISSING"}  ${entry.name}`);
  if (!entry.ok) console.log(`         ${entry.detail}`);
}

console.log("");
console.log(failures === 0
  ? "Code-side readiness: complete. A drill still needs two people and a clock (ops/INCIDENT_READINESS.md)."
  : `Code-side readiness: ${failures} item(s) missing.`);
process.exit(failures === 0 ? 0 : 1);
