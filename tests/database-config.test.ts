import { afterEach, describe, expect, it } from "vitest";
import { databaseConnectionTimeoutMillis, databaseSslOptions, databaseUrl } from "../src/lib/database-config";
import { SUPABASE_ROOT_CA_2021 } from "../src/lib/supabase-ca";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

function setPoolerEnv(): void {
  process.env.DATABASE_URL_REWRITE_TO_POOLER = "true";
  process.env.SUPABASE_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";
  process.env.SUPABASE_PROJECT_REF = "synthetic-ref";
  process.env.DATABASE_POOLER_PORT = "5432";
}

describe("managed database URL rewrite", () => {
  it("returns the original URL when the rewrite is disabled", () => {
    process.env.DATABASE_URL = "postgres://annapurna_app:synthetic@db.example.test:5432/postgres";
    expect(databaseUrl("DATABASE_URL")).toBe(process.env.DATABASE_URL);
  });

  it("rewrites a direct Supabase role URL to the IPv4 session pooler", () => {
    setPoolerEnv();
    process.env.DATABASE_URL = "postgres://annapurna_app:synthetic@db.synthetic-ref.supabase.co:5432/postgres";
    const rewritten = new URL(databaseUrl("DATABASE_URL")!);
    expect(rewritten.hostname).toBe("aws-0-ap-south-1.pooler.supabase.com");
    expect(rewritten.port).toBe("5432");
    expect(rewritten.username).toBe("annapurna_app.synthetic-ref");
    expect(rewritten.password).toBe("synthetic");
    expect(rewritten.pathname).toBe("/postgres");
  });

  it("does not double-rewrite an already pooled username", () => {
    setPoolerEnv();
    const pooled = "postgres://postgres.synthetic-ref:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";
    process.env.MIGRATION_DATABASE_URL = pooled;
    expect(databaseUrl("MIGRATION_DATABASE_URL")).toBe(pooled);
  });

  it("requires the non-secret pooler settings when enabled", () => {
    process.env.DATABASE_URL_REWRITE_TO_POOLER = "true";
    delete process.env.SUPABASE_POOLER_HOST;
    delete process.env.SUPABASE_PROJECT_REF;
    process.env.DATABASE_URL = "postgres://annapurna_app:synthetic@db.example.test:5432/postgres";
    expect(() => databaseUrl("DATABASE_URL")).toThrow(/SUPABASE_POOLER_HOST/);
  });

  it("strips URL SSL parameters so the explicit TLS option is not overridden", () => {
    setPoolerEnv();
    process.env.DATABASE_URL = "postgres://annapurna_app:synthetic@db.synthetic-ref.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true";
    const rewritten = new URL(databaseUrl("DATABASE_URL")!);
    expect(rewritten.searchParams.has("sslmode")).toBe(false);
    expect(rewritten.searchParams.has("uselibpqcompat")).toBe(false);
    expect(rewritten.username).toBe("annapurna_app.synthetic-ref");
  });
});

describe("managed database TLS", () => {
  it("uses the reviewed public Supabase root CA for pooler hosts", () => {
    process.env.DATABASE_SSL = "true";
    const options = databaseSslOptions("postgres://role.ref:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres");
    expect(options).toMatchObject({ ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true });
    expect(SUPABASE_ROOT_CA_2021).toContain("BEGIN CERTIFICATE");
  });

  it("uses system roots for other managed hosts and no TLS for local development", () => {
    process.env.DATABASE_SSL = "true";
    expect(databaseSslOptions("postgres://role:synthetic@db.example.test:5432/postgres")).toEqual({ rejectUnauthorized: true });
    process.env.DATABASE_SSL = "false";
    expect(databaseSslOptions("postgres://role:synthetic@127.0.0.1:5432/postgres")).toBeUndefined();
  });
});

describe("managed database connection timeout", () => {
  it("defaults to 30 seconds and accepts a valid override", () => {
    delete process.env.DATABASE_CONNECT_TIMEOUT_MS;
    expect(databaseConnectionTimeoutMillis()).toBe(30_000);
    process.env.DATABASE_CONNECT_TIMEOUT_MS = "12000";
    expect(databaseConnectionTimeoutMillis()).toBe(12_000);
    process.env.DATABASE_CONNECT_TIMEOUT_MS = "not-a-number";
    expect(databaseConnectionTimeoutMillis()).toBe(30_000);
  });
});
