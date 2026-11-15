import { describe, expect, it } from "vitest";
import { compareManifests, durableDifferences, MANIFEST_SQL, type BackupManifest } from "../src/ops/backup-manifest";

const baseline: BackupManifest = {
  capturedAt: "2026-11-15",
  source: "hosted",
  tables: { audit_events: 3, session: 1, email_outbox: 2, user: 3 },
  totalRows: 9,
  schemaFingerprint: "abc",
  migrations: 15,
  policies: 66,
};

describe("restore verification", () => {
  it("accepts a faithful restore", () => {
    expect(compareManifests(baseline, { ...baseline, capturedAt: "2026-11-16", source: "restored" })).toEqual([]);
  });

  it("catches a missing row, a missing table and a schema drift", () => {
    const restored: BackupManifest = {
      ...baseline,
      tables: { audit_events: 2, session: 1, email_outbox: 2 },
      schemaFingerprint: "def",
      migrations: 14,
    };
    const differences = compareManifests(baseline, restored);
    expect(differences).toContainEqual({ field: "tables.audit_events", expected: "3", actual: "2" });
    expect(differences).toContainEqual({ field: "tables.user", expected: "3", actual: "0" });
    expect(differences).toContainEqual({ field: "schemaFingerprint", expected: "abc", actual: "def" });
    expect(differences).toContainEqual({ field: "migrations", expected: "15", actual: "14" });
    expect(durableDifferences(differences)).toHaveLength(4);
  });

  it("reports churn in volatile tables without failing the restore", () => {
    const restored: BackupManifest = { ...baseline, tables: { ...baseline.tables, session: 7, email_outbox: 0 } };
    const differences = compareManifests(baseline, restored);
    expect(differences).toHaveLength(2);
    expect(durableDifferences(differences)).toEqual([]);
  });

  it("documents the exact query a restored database must answer", () => {
    expect(MANIFEST_SQL).toContain("drizzle.__drizzle_migrations");
    expect(MANIFEST_SQL).toContain("pg_policy");
    expect(MANIFEST_SQL).toContain("information_schema.columns");
  });
});

describe("incident readiness script", () => {
  it("reports the code-side capability without needing a person", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run(process.execPath, ["scripts/incident-readiness.mjs"]);
    expect(stdout).toContain("READY    second factor enforced for privileged roles");
    expect(stdout).toContain("READY    session revocation endpoint");
    expect(stdout).toContain("Code-side readiness: complete");
  });
});
