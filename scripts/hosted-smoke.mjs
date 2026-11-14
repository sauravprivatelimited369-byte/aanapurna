#!/usr/bin/env node
// Read-only smoke check for an already-deployed Annapurna Link instance.
// It never prints secrets and never deletes data. Default mode only issues GET
// requests. The optional --register mode creates exactly one fictional account
// and prints the SQL an owner can use to remove it.
//
// Usage:
//   HOSTED_SMOKE_BASE_URL=https://example.vercel.app npm run smoke:hosted
//   HOSTED_SMOKE_BASE_URL=... HOSTED_SMOKE_EMAIL=you@example.com \
//     HOSTED_SMOKE_PASSWORD='...' npm run smoke:hosted -- --register
//
// A local HTTP target is refused unless HOSTED_SMOKE_ALLOW_HTTP=true, which
// exists only so the script itself can be exercised against a mock server.

const baseUrl = (process.env.HOSTED_SMOKE_BASE_URL ?? "").replace(/\/+$/, "");
const allowHttp = process.env.HOSTED_SMOKE_ALLOW_HTTP === "true";
const registerMode = process.argv.includes("--register");

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(message) {
  console.error(`ERROR ${message}`);
  process.exit(2);
}

if (!baseUrl) fail("HOSTED_SMOKE_BASE_URL is required, for example https://your-app.vercel.app");
if (!/^https:\/\//.test(baseUrl) && !(allowHttp && /^http:\/\//.test(baseUrl))) {
  fail("Refusing a non-HTTPS target. Set HOSTED_SMOKE_ALLOW_HTTP=true only for a local mock server.");
}

const origin = new URL(baseUrl).origin;

async function get(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    redirect: options.redirect ?? "manual",
    headers: { Accept: "application/json, text/html" },
  });
  const text = await response.text();
  return { response, text };
}

async function postJson(path, body) {
  const response = await fetch(baseUrl + path, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", Origin: origin, Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function checkHomepage() {
  const { response, text } = await get("/");
  const looksRendered = /Annapurna Link/i.test(text) && text.length > 500;
  record("homepage renders", response.status === 200 && looksRendered, `HTTP ${response.status}`);
}

async function checkHealth() {
  const { response, text } = await get("/api/health");
  const body = parseJson(text);
  if (!body) return record("health endpoint", false, `HTTP ${response.status}, non-JSON body`);
  const databaseOk = body?.database?.status === "ok";
  record(
    "health endpoint reports a healthy database",
    response.status === 200 && body.status === "ok" && databaseOk,
    `HTTP ${response.status}, database=${body?.database?.status ?? "unknown"}, latencyMs=${body?.database?.latencyMs ?? "?"}`,
  );
  record(
    "health endpoint keeps real operations disabled",
    body.realOperationsEnabled === false,
    `realOperationsEnabled=${String(body.realOperationsEnabled)}`,
  );
  record(
    "health endpoint reports email configuration honestly",
    typeof body?.email?.status === "string",
    `email=${body?.email?.status ?? "unknown"}${
      Array.isArray(body?.email?.missingSettings) && body.email.missingSettings.length > 0
        ? ` (missing: ${body.email.missingSettings.join(", ")})`
        : ""
    }`,
  );
}

async function checkPublicImpact() {
  const { response, text } = await get("/api/public/impact");
  const body = parseJson(text);
  if (!body) return record("public impact endpoint", false, `HTTP ${response.status}, non-JSON body`);
  const numeric = body?.metrics && Object.values(body.metrics).every((value) => typeof value === "number");
  record(
    "public impact endpoint returns server-computed metrics",
    response.status === 200 && numeric && ["ok", "empty"].includes(body.status),
    `HTTP ${response.status}, status=${body.status}, verifiedServings=${body?.metrics?.verifiedServings ?? "?"}`,
  );
}

async function checkProtectedRedirect() {
  for (const path of ["/admin", "/app"]) {
    const { response } = await get(path);
    const location = response.headers.get("location") ?? "";
    const redirected = response.status >= 300 && response.status < 400 && /\/login/.test(location);
    record(
      `${path} redirects an anonymous visitor to login`,
      redirected,
      `HTTP ${response.status}${location ? `, location=${location.split("?")[0]}` : ""}`,
    );
  }
}

async function checkRegistration() {
  const email = process.env.HOSTED_SMOKE_EMAIL;
  const password = process.env.HOSTED_SMOKE_PASSWORD;
  if (!email || !password) {
    return record("registration (optional)", false, "set HOSTED_SMOKE_EMAIL and HOSTED_SMOKE_PASSWORD, or omit --register");
  }
  const { response, text } = await postJson("/api/register", {
    name: "Hosted smoke test",
    email,
    password,
    role: "helper",
    phone: "+91 90000 00001",
    organizationName: null,
    organizationType: null,
    addressLine: "12 Hosted Smoke Street",
    cityOrDistrict: "Rourkela",
    stateOrRegion: "Odisha",
    postalCode: "769001",
    profileNotes: "Fictional hosted smoke-test account; safe to delete.",
    acceptedTerms: true,
  });
  const body = parseJson(text);
  const created = response.status === 201 && body?.status === "created";
  record(
    "registration creates a pending, unverified account",
    created,
    `HTTP ${response.status}${body?.status ? `, status=${body.status}` : ""}${
      body?.emailDelivery?.configured === false ? ", email delivery NOT configured" : ""
    }`,
  );
  if (created) {
    console.log(`NOTE  remove the test account with: DELETE FROM "user" WHERE email = '${body.email}';`);
    console.log("NOTE  related account/session rows cascade or must be removed by the owner.");
  }

  const signIn = await postJson("/api/auth/sign-in/email", { email, password });
  const signInBody = parseJson(signIn.text);
  const sessionCookie = (signIn.response.headers.getSetCookie?.() ?? []).find((value) =>
    /session_token|better-auth/i.test(value),
  );
  record(
    "unverified account cannot obtain a usable session",
    signIn.response.status >= 400 || signInBody?.user?.emailVerified === false || !sessionCookie,
    `HTTP ${signIn.response.status}`,
  );
  if (sessionCookie) {
    const flags = ["HttpOnly", "Secure", "SameSite"].filter((flag) => new RegExp(flag, "i").test(sessionCookie));
    record("session cookie carries hardened flags", flags.length === 3, `flags present: ${flags.join(", ") || "none"}`);
  }
}

async function main() {
  console.log(`Hosted smoke check against ${baseUrl}`);
  await checkHomepage();
  await checkHealth();
  await checkPublicImpact();
  await checkProtectedRedirect();
  if (registerMode) await checkRegistration();

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error("Some hosted checks did not pass. Review the failures above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`ERROR ${error instanceof Error ? error.message : "unknown failure"}`);
  process.exit(2);
});
