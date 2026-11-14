import { afterEach, describe, expect, it } from "vitest";
import { databaseConnectionTimeoutMillis, databaseUrl } from "../src/lib/database-config";

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
