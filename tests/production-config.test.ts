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

function explicitSmtpEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = baseEnv();
  delete env.SMTP_URL;
  return {
    ...env,
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "465",
    SMTP_USER: "not-a-real-user",
    SMTP_PASS: "not-a-real-pass",
    SMTP_SECURE: "true",
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

  it("accepts explicit SMTP settings without SMTP_URL", () => {
    const result = validateProductionConfig(explicitSmtpEnv(), { allowTestDomains: true });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a placeholder SMTP app password by name only", () => {
    const result = validateProductionConfig(
      explicitSmtpEnv({ SMTP_PASS: "REPLACE_WITH_GMAIL_APP_PASSWORD" }),
      { allowTestDomains: true },
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("SMTP_USER and SMTP_PASS");
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

  it("flags a capture service as a working transport that is not production delivery", () => {
    const status = getEmailSettingsStatus({
      NODE_ENV: "production",
      SMTP_FROM: "Annapurna Link <capture@ethereal.email>",
      SMTP_HOST: "smtp.ethereal.email",
      SMTP_PORT: "587",
      SMTP_USER: "capture-user",
      SMTP_PASS: "capture-pass",
      APP_URL: "https://app.example.test",
    } as NodeJS.ProcessEnv);
    // The transport really is usable, so delivery attempts are made...
    expect(status.configured).toBe(true);
    // ...but it must never be presented as production-ready email.
    expect(status.testSink).toBe(true);
    expect(status.localOnly).toBe(false);

    const urlForm = getEmailSettingsStatus({
      NODE_ENV: "production",
      SMTP_FROM: "Annapurna Link <capture@ethereal.email>",
      SMTP_URL: "smtp://capture-user:capture-pass@smtp.ethereal.email:587",
      APP_URL: "https://app.example.test",
    } as NodeJS.ProcessEnv);
    expect(urlForm.testSink).toBe(true);
  });

  it("does not flag a real provider as a capture service", () => {
    const status = getEmailSettingsStatus(explicitSmtpEnv());
    expect(status.configured).toBe(true);
    expect(status.testSink).toBe(false);
  });

  it("rejects a capture service in the production preflight", () => {
    const result = validateProductionConfig(explicitSmtpEnv({
      SMTP_HOST: "smtp.ethereal.email",
      SMTP_FROM: "Annapurna Link <capture@ethereal.email>",
    }));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("capture service");
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
  it("disables Mailpit, allows either SMTP form and requires the fail-closed preflight", () => {
    const compose = readFileSync("docker-compose.production.yml", "utf8");
    expect(compose).toContain('profiles: ["local"]');
    expect(compose).toContain('command: ["npm", "run", "check:production-config"]');
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("${SMTP_URL:-}");
    expect(compose).toContain("${SMTP_PORT:-}");
    expect(compose).not.toContain("${SMTP_PORT:-587}");
    expect(compose).not.toContain("smtp://mailpit");
  });
});

describe("managed database Compose overlay", () => {
  it("uses direct role URLs, disables local services and gates on preflight", () => {
    const compose = readFileSync("docker-compose.managed-db.yml", "utf8");
    expect(compose).toContain("${DATABASE_URL:?");
    expect(compose).toContain("${AUTH_DATABASE_URL:?");
    expect(compose).toContain("DATABASE_SSL: ${DATABASE_SSL:-true}");
    expect(compose).toContain('profiles: ["local"]');
    expect(compose).toContain("required: false");
    expect(compose).toContain('command: ["npm", "run", "check:production-config"]');
    expect(compose).not.toContain("@db:5432");
  });
});

describe("Vercel build configuration", () => {
  it("installs dev dependencies and gates the build on migrations", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      installCommand?: string;
      buildCommand?: string;
    };
    // NODE_ENV=production is present during Vercel's install, so a plain
    // `npm ci` omits devDependencies and `next build` fails its type check.
    expect(config.installCommand).toBe("npm ci --include=dev");
    expect(config.buildCommand).toBe("npm run db:migrate && npm run db:check && npm run build");
  });
});
