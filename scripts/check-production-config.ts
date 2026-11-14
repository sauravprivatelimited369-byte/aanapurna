import { validateProductionConfig } from "../src/lib/production-config";

/**
 * CLI preflight for a production deployment. Run automatically by the
 * production Compose stack and manually with `npm run check:production-config`.
 * It never prints environment values, only setting names and instructions.
 */
const result = validateProductionConfig(process.env, {
  allowTestDomains: process.env.ALLOW_TEST_DOMAINS === "true",
});

for (const warning of result.warnings) {
  console.warn(`WARNING: ${warning}`);
}

if (!result.ok) {
  console.error("Production configuration is incomplete. Fix these settings in the host's secure environment settings:");
  for (const problem of result.problems) console.error(`- ${problem}`);
  console.error("No database, domain, SMTP account or secret can be created by this repository. See AUTHENTICATION_IMPLEMENTATION_REPORT.md section 9.");
  process.exit(1);
}

console.info("PASS: production configuration names and shapes are valid. No values were printed.");
