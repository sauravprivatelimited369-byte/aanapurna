import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateProductionConfig } from "../src/lib/production-config";
import { getEmailSettingsStatus } from "../src/email/settings";

const key = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://annapurna_app:not-a-real-password@db.example.test:5432/annapurna_link",
    AUTH_DATABASE_URL: "postgres://annapurna_auth:not-a-real-password@db.example.test:5432/annapurna_link",
    WORKER_DATABASE_URL: "postgres://annapurna_worker:not-a-real-password@db.example.test:5432/annapurna_link",
    MIGRATION_DATABASE_URL: "postgres://annapurna_migrator:not-a-real-password@db.example.test:5432/annapurna_link",
    DATABASE_SSL: "true",
    AUTH_SECRET: "not-a-real-secret-012345678901234567890123456789",
    OTP_HASH_KEY: key,
    OTP_ENCRYPTION_KEY: key,
    EMAIL_ENCRYPTION_KEY: key,
    APP_URL: "https://app.example.test",
    APP_DOMAIN: "app.example.test",
    SMTP_FROM: "Annapurna Link <noreply@example.test>",
    SMTP_URL: "smtps://not-a-real-user:not-a-real-pass@smtp.example.test:465",
    OPERATIONS_ENABLED: "false",
    ...overrides,
  };
}

describe("production configuration preflight", () => {
  it("accepts a complete synthetic production configuration", () => {
    const result = validateProductionConfig(baseEnv(), { allowTestDomains: true });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("rejects placeholders, local URLs and a loopback SMTP sink without printing values", () => {
    const result = validateProductionConfig(baseEnv({
      APP_URL: "http://localhost:3000",
      SMTP_URL: "smtp://127.0.0.1:2526",
      AUTH_SECRET: "REPLACE_WITH_RANDOM_SECRET",
    }), { allowTestDomains: true });
    expect(result.ok).toBe(false);
    const text = result.problems.join(" ");
    expect(text).toContain("APP_URL");
    expect(text).toContain("SMTP_URL");
    expect(text).toContain("AUTH_SECRET");
    expect(text).not.toContain("127.0.0.1:2526");
    expect(text).not.toContain("REPLACE_WITH_RANDOM_SECRET");
  });

  it("rejects one shared administrator database role", () => {
    const shared = "postgres://admin:not-a-real-password@db.example.test:5432/annapurna_link";
    const result = validateProductionConfig(baseEnv({
      DATABASE_URL: shared,
      AUTH_DATABASE_URL: shared,
      WORKER_DATABASE_URL: shared,
      MIGRATION_DATABASE_URL: shared,
    }), { allowTestDomains: true });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("distinct least-privilege roles");
  });

  it("rejects weak keys and warns about prematurely enabled operations", () => {
    const result = validateProductionConfig(baseEnv({
      OTP_HASH_KEY: "too-short",
      OPERATIONS_ENABLED: "true",
    }), { allowTestDomains: true });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("OTP_HASH_KEY");
    expect(result.warnings.join(" ")).toContain("OPERATIONS_ENABLED");
  });

  it("requires DATABASE_SSL=true for an external managed database", () => {
    const result = validateProductionConfig(baseEnv({ DATABASE_SSL: "false" }), { allowTestDomains: true });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("DATABASE_SSL=true");
  });
});

describe("shared email delivery status", () => {
  it("treats a loopback sink as configured only outside production", () => {
    const local = {
      NODE_ENV: "development",
      APP_URL: "http://localhost:3000",
      SMTP_FROM: "Annapurna Link <noreply@example.test>",
      SMTP_URL: "smtp://127.0.0.1:2526",
    } as NodeJS.ProcessEnv;
    expect(getEmailSettingsStatus(local)).toMatchObject({ configured: true, localOnly: true });
    expect(getEmailSettingsStatus({ ...local, NODE_ENV: "production" })).toMatchObject({ configured: false, localOnly: true });
  });

  it("rejects incomplete explicit SMTP settings by name only", () => {
    const result = getEmailSettingsStatus({
      NODE_ENV: "development",
      SMTP_FROM: "Annapurna Link <noreply@example.test>",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "user",
    } as NodeJS.ProcessEnv);
    expect(result.configured).toBe(false);
    expect(result.missingSettings.join(" ")).toContain("SMTP_PORT");
    expect(result.missingSettings.join(" ")).toContain("SMTP_USER/SMTP_PASS");
  });
});

describe("production Compose overlay", () => {
  it("disables Mailpit and requires the fail-closed preflight before web/worker", () => {
    const compose = readFileSync("docker-compose.production.yml", "utf8");
    expect(compose).toContain('profiles: ["local"]');
    expect(compose).toContain('command: ["npm", "run", "check:production-config"]');
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("${SMTP_URL:?");
    expect(compose).not.toContain("smtp://mailpit");
  });
});
