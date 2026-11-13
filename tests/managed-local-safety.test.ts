import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function sandbox(test: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "annapurna-launch-test-"));
  try { test(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function launch(dir: string, extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [resolve(root, "scripts/windows-start.mjs")], {
    cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "development", ...extra }, timeout: 10_000,
  });
}
describe("managed local launcher safeguards", () => {
  it("refuses enabled real operations before creating anything", () => sandbox((dir) => {
    const result = launch(dir, { OPERATIONS_ENABLED: "true" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot enable real operations");
    expect(existsSync(join(dir, ".env"))).toBe(false);
  }));
  it("does not create new credentials over existing PostgreSQL data", () => sandbox((dir) => {
    mkdirSync(join(dir, ".local-data/postgres"), { recursive: true });
    writeFileSync(join(dir, ".local-data/postgres/sentinel"), "preserve");
    const result = launch(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".env is missing");
    expect(readFileSync(join(dir, ".local-data/postgres/sentinel"), "utf8")).toBe("preserve");
    expect(existsSync(join(dir, ".env"))).toBe(false);
  }));
  it("refuses a managed database URL that points elsewhere", () => sandbox((dir) => {
    mkdirSync(join(dir, ".local-data"));
    writeFileSync(join(dir, ".local-data/managed-postgres.json"), JSON.stringify({ version: 1, port: 55432, password: "a".repeat(45) }));
    writeFileSync(join(dir, ".env"), "APP_URL=http://localhost:3000\nOPERATIONS_ENABLED=false\nDATABASE_URL=postgres://annapurna_app:fake@example.test:55432/annapurna_link\n");
    const result = launch(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must match the managed loopback database");
  }));
  it("generates fresh local URLs on the explicitly selected port", () => sandbox((dir) => {
    mkdirSync(join(dir, "scripts"));
    copyFileSync(join(root, "scripts/create-local-env.mjs"), join(dir, "scripts/create-local-env.mjs"));
    copyFileSync(join(root, ".env.example"), join(dir, ".env.example"));
    const result = spawnSync(process.execPath, [join(dir, "scripts/create-local-env.mjs")], { env: { PATH: process.env.PATH, NODE_ENV: "development", LOCAL_DATABASE_PORT: "55432" }, encoding: "utf8" });
    expect(result.status).toBe(0);
    const envFile = readFileSync(join(dir, ".env"), "utf8");
    expect(envFile).toContain("POSTGRES_PORT=55432");
    expect(envFile.match(/@127\.0\.0\.1:55432\/annapurna_link/g)).toHaveLength(4);
    expect(envFile).toContain("OPERATIONS_ENABLED=false");
  }));
});
