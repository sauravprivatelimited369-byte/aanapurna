#!/usr/bin/env node
/**
 * Restore verification.
 *
 *   node scripts/verify-restore.mjs --sql
 *       Print the manifest query to run on whatever database you restored into.
 *
 *   node scripts/verify-restore.mjs --expected ops/backups/hosted-manifest-2026-11-15.json --actual /tmp/restored.json
 *       Compare a restored database's manifest against the recorded baseline.
 *       Exit code 1 means the restore is not faithful. Rate-limit, session and
 *       outbox counts are reported separately because they legitimately move.
 */
import { readFileSync } from "node:fs";
import { compareManifests, durableDifferences, MANIFEST_SQL } from "../src/ops/backup-manifest.ts";

const args = process.argv.slice(2);
if (args.includes("--sql")) {
  process.stdout.write(`${MANIFEST_SQL}\n`);
  process.exit(0);
}

function readFlag(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] ?? "";
}

const expectedPath = readFlag("--expected");
const actualPath = readFlag("--actual");
if (!expectedPath || !actualPath) {
  console.error("Usage: verify-restore.mjs --sql | --expected <baseline.json> --actual <restored.json>");
  process.exit(2);
}

const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const actual = JSON.parse(readFileSync(actualPath, "utf8"));
const differences = compareManifests(expected, actual);
const durable = durableDifferences(differences);

for (const difference of differences) {
  const marker = durable.includes(difference) ? "FAIL" : "note";
  console.log(`${marker}  ${difference.field}: expected ${difference.expected}, found ${difference.actual}`);
}

if (durable.length > 0) {
  console.error(`Restore does not match the baseline: ${durable.length} durable difference(s).`);
  process.exit(1);
}
console.log(`Restore matches the baseline (${expected.totalRows} rows, ${expected.migrations} migrations, ${expected.policies} policies).`);
