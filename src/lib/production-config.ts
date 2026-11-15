/**
 * Production configuration preflight. This does NOT create a database, domain,
 * SMTP account or deployment. It fails closed before the web app or worker can
 * start when an owner-only setting is missing, still a placeholder, or points
 * at a local test sink. It reports setting NAMES only, never values.
 */

import { isLocalDeliveryHost, isPlaceholderValue, isTestCaptureHost } from "../email/settings";

export type ProductionConfigResult = {
  ok: boolean;
  problems: string[];
  warnings: string[];
};

export type ProductionConfigOptions = {
  /** Permit reserved .test domains for synthetic CI/unit checks only. */
  allowTestDomains?: boolean;
};

const REQUIRED_NAMES = [
  "NODE_ENV",
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "AUTH_SECRET",
  "OTP_HASH_KEY",
  "OTP_ENCRYPTION_KEY",
  "EMAIL_ENCRYPTION_KEY",
  "APP_URL",
  "SMTP_FROM",
] as const;

const DB_NAMES = [
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
] as const;

const KEY_NAMES = ["OTP_HASH_KEY", "OTP_ENCRYPTION_KEY", "EMAIL_ENCRYPTION_KEY"] as const;

const TEST_DOMAIN = /\.test$/i;

function isTestOnlyHost(host: string): boolean {
  return TEST_DOMAIN.test(host);
}

function isUnusablePublicHost(host: string, allowTestDomains: boolean): boolean {
  if (isLocalDeliveryHost(host)) return true;
  if (host.endsWith(".e2b.app") || host.endsWith(".invalid")) return true;
  if (!allowTestDomains && isTestOnlyHost(host)) return true;
  return false;
}

function parsePostgresUrl(name: string, raw: string | undefined, problems: string[]): { host: string; username: string } | null {
  if (isPlaceholderValue(raw)) {
    problems.push(`${name} is missing or still a placeholder`);
    return null;
  }
  try {
    const url = new URL(raw!);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("protocol");
    if (url.search || url.hash) throw new Error("query");
    const host = url.hostname.toLowerCase();
    const username = decodeURIComponent(url.username);
    if (!host || !username) throw new Error("host/user");
    if (isLocalDeliveryHost(host)) throw new Error("local");
    if (isPlaceholderValue(raw) || isPlaceholderValue(username)) throw new Error("placeholder");
    return { host, username };
  } catch {
    problems.push(`${name} must be a valid non-local PostgreSQL URL with a role name`);
    return null;
  }
}

function emailDomain(value: string): string | null {
  const bracketed = value.match(/<([^>]+)>/);
  const address = (bracketed?.[1] ?? value).trim();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase();
}

function validBase64Key(value: string | undefined): boolean {
  if (isPlaceholderValue(value)) return false;
  try {
    return Buffer.from(value!, "base64").length === 32;
  } catch {
    return false;
  }
}

/**
 * Parse `APP_ADDITIONAL_ORIGINS`, a comma-separated list of extra HTTPS origins
 * that may submit forms (for example a previous deployment alias that must keep
 * working after the canonical domain changes). Wildcards, paths, credentials and
 * non-HTTPS entries are rejected rather than silently trusted.
 */
export function parseAdditionalOrigins(value: string | undefined): { origins: string[]; problems: string[] } {
  const problems: string[] = [];
  const origins: string[] = [];
  if (!value || isPlaceholderValue(value)) return { origins, problems };

  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      problems.push("APP_ADDITIONAL_ORIGINS entries must be absolute HTTPS origins");
      continue;
    }
    if (url.protocol !== "https:") problems.push("APP_ADDITIONAL_ORIGINS entries must use HTTPS");
    else if (url.username || url.password || url.search || url.hash) problems.push("APP_ADDITIONAL_ORIGINS entries must be clean origins without credentials or a query");
    else if (entry.includes("*")) problems.push("APP_ADDITIONAL_ORIGINS entries must not use wildcards");
    else if (url.pathname !== "/" && url.pathname !== "") problems.push("APP_ADDITIONAL_ORIGINS entries must be origins without a path");
    else origins.push(url.origin);
  }
  return { origins: [...new Set(origins)], problems };
}

export function validateProductionConfig(
  env: NodeJS.ProcessEnv,
  options: ProductionConfigOptions = {},
): ProductionConfigResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const allowTestDomains = options.allowTestDomains === true;

  for (const name of REQUIRED_NAMES) {
    if (isPlaceholderValue(env[name])) problems.push(`${name} is missing or still a placeholder`);
  }
  if (env.NODE_ENV && env.NODE_ENV !== "production") problems.push("NODE_ENV must be production");

  const dbRecords: Array<{ name: string; host: string; username: string }> = [];
  for (const name of DB_NAMES) {
    const parsed = parsePostgresUrl(name, env[name], problems);
    if (parsed) dbRecords.push({ name, ...parsed });
  }
  if (dbRecords.length === DB_NAMES.length) {
    const usernames = new Set(dbRecords.map((record) => record.username));
    if (usernames.size !== DB_NAMES.length) {
      problems.push("DATABASE_URL, AUTH_DATABASE_URL, WORKER_DATABASE_URL and MIGRATION_DATABASE_URL must use four distinct least-privilege roles");
    }
    const externalHost = dbRecords.some((record) => record.host !== "db" && !isLocalDeliveryHost(record.host));
    if (externalHost && env.DATABASE_SSL !== "true") {
      problems.push("DATABASE_SSL=true is required for an external managed database");
    }
  }

  if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32) problems.push("AUTH_SECRET must be at least 32 characters");
  for (const name of KEY_NAMES) {
    if (!validBase64Key(env[name])) problems.push(`${name} must be a base64-encoded 32-byte key`);
  }

  let appHost = "";
  if (env.APP_URL && !isPlaceholderValue(env.APP_URL)) {
    try {
      const url = new URL(env.APP_URL);
      appHost = url.hostname.toLowerCase();
      if (url.protocol !== "https:") problems.push("APP_URL must use HTTPS");
      if (url.username || url.password || url.search || url.hash) problems.push("APP_URL must be a clean origin without credentials or a query");
      if (isUnusablePublicHost(appHost, allowTestDomains)) problems.push("APP_URL must be a public HTTPS domain owned by the operator");
    } catch {
      problems.push("APP_URL must be a valid HTTPS URL");
    }
  }
  if (env.APP_ADDITIONAL_ORIGINS) {
    const additional = parseAdditionalOrigins(env.APP_ADDITIONAL_ORIGINS);
    problems.push(...additional.problems);
  }

  if (env.APP_DOMAIN) {
    const domain = env.APP_DOMAIN.trim().toLowerCase();
    if (isUnusablePublicHost(domain, allowTestDomains)) problems.push("APP_DOMAIN must be a public domain owned by the operator");
    if (appHost && domain !== appHost) problems.push("APP_DOMAIN must match the APP_URL hostname");
  }

  if (env.SMTP_FROM && !isPlaceholderValue(env.SMTP_FROM)) {
    const domain = emailDomain(env.SMTP_FROM);
    if (!domain) problems.push("SMTP_FROM must contain a valid sender address");
    else if (isUnusablePublicHost(domain, allowTestDomains)) problems.push("SMTP_FROM must use a verified sender domain, not a local or test domain");
  }

  const smtpUrl = env.SMTP_URL?.trim();
  const smtpHost = env.SMTP_HOST?.trim();
  if (smtpUrl) {
    try {
      const url = new URL(smtpUrl);
      if (!["smtp:", "smtps:"].includes(url.protocol)) throw new Error("protocol");
      if (isUnusablePublicHost(url.hostname.toLowerCase(), allowTestDomains)) throw new Error("host");
      if (isPlaceholderValue(smtpUrl)) throw new Error("placeholder");
    } catch {
      problems.push("SMTP_URL must be a real smtp:// or smtps:// provider URL, not a loopback test sink");
    }
  } else if (smtpHost) {
    if (isUnusablePublicHost(smtpHost.toLowerCase(), allowTestDomains)) problems.push("SMTP_HOST must be a real provider host, not a loopback test sink");
    if (isTestCaptureHost(smtpHost)) problems.push("SMTP_HOST must be a real mail provider, not a capture service (message capture is for verification only and never reaches a recipient)");
    const port = Number(env.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) problems.push("SMTP_PORT must be a valid TCP port");
    if (isPlaceholderValue(env.SMTP_USER) || isPlaceholderValue(env.SMTP_PASS)) {
      problems.push("SMTP_USER and SMTP_PASS are both required for authenticated production SMTP");
    }
    if (env.SMTP_SECURE && !["true", "false"].includes(env.SMTP_SECURE)) problems.push("SMTP_SECURE must be true or false");
  } else {
    problems.push("SMTP_URL or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS must be configured");
  }

  if (env.OPERATIONS_ENABLED === "true") {
    warnings.push("OPERATIONS_ENABLED=true must not be used until human food-safety, legal, privacy and security approvals are recorded");
  }

  // Web Push is optional: a deployment without keys is a deployment where nobody can turn on
  // notifications, which is a lesser failure than a web app that will not start. It is reported
  // rather than enforced so a build log answers "is push on here?" without anyone guessing, and so
  // a half-configured pair — a public key with no private key signs nothing — is called out loudly
  // instead of showing a button that fails when a person taps it.
  const vapidPublic = env.WEB_PUSH_PUBLIC_KEY?.trim();
  const vapidPrivate = env.WEB_PUSH_PRIVATE_KEY?.trim();
  if (vapidPublic || vapidPrivate) {
    if (!vapidPublic || !vapidPrivate) {
      warnings.push("WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY must be set together; with only one of them push stays off");
    } else if (vapidPublic.length < 40 || vapidPrivate.length < 20) {
      warnings.push("WEB_PUSH_PUBLIC_KEY or WEB_PUSH_PRIVATE_KEY has the wrong shape for a VAPID key; push stays off");
    } else {
      const subject = env.WEB_PUSH_SUBJECT?.trim();
      if (!subject) {
        warnings.push("WEB_PUSH_SUBJECT is unset; push services are told to contact an unroutable default address");
      } else if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
        warnings.push("WEB_PUSH_SUBJECT must be a mailto: address or an https: URL");
      }
    }
  } else {
    warnings.push("WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY are not set; notifications to a person's device are off");
  }

  return { ok: problems.length === 0, problems, warnings };
}
