import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const node = process.execPath;
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", NODE_ENV: "development", OPERATIONS_ENABLED: "false" };

function run(script: string, extra: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(node, [script], { encoding: "utf8", env: { ...env, ...extra, NODE_ENV: extra.NODE_ENV ?? env.NODE_ENV } });
}

describe("native development safeguards", () => {
  it("requires an explicit database administrator URL", () => {
    const result = run("scripts/setup-native-db.mjs");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Set PG_ADMIN_URL");
  });
  it("rejects non-local database administrators before connecting", () => {
    const result = run("scripts/setup-native-db.mjs", { PG_ADMIN_URL: "postgres://postgres:secret@example.com/postgres" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must point to a local PostgreSQL server");
    expect(result.stderr).not.toContain("secret");
  });
  it("rejects connection parameter host overrides", () => {
    const result = run("scripts/setup-native-db.mjs", { PG_ADMIN_URL: "postgres://postgres@localhost/postgres?host=example.com" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must point to a local PostgreSQL server");
  });
  it("refuses bootstrap in production or with real operations enabled", () => {
    for (const extra of [{ NODE_ENV: "production" }, { OPERATIONS_ENABLED: "true" }] satisfies Partial<NodeJS.ProcessEnv>[]) {
      const result = run("scripts/setup-native-db.mjs", extra);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("isolated development only");
    }
  });
  it("refuses to start with real operations enabled", () => {
    const result = run("scripts/local-start.mjs", { OPERATIONS_ENABLED: "true" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refuses enabled real operations");
  });
  it("refuses a non-local runtime database", () => {
    const result = run("scripts/local-start.mjs", { DATABASE_URL: "postgres://app:secret@example.com/database" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must point to local PostgreSQL");
    expect(result.stderr).not.toContain("secret");
  });
});
