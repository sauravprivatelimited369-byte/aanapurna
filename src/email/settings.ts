/**
 * Shared, side-effect-free email configuration checks. This module is imported
 * by both Next.js server code and the standalone worker, so it must not import
 * `server-only` or any framework-specific dependency.
 */

export type EmailSettingsStatus = {
  configured: boolean;
  provider: "smtp" | null;
  missingSettings: string[];
  localOnly: boolean;
};

const PLACEHOLDER = /REPLACE_WITH|GENERATED_BY_SCRIPT|build-only|ci-only|placeholder/i;

export function isLocalDeliveryHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!value) return true;
  if (value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "mailpit") return true;
  if (value.startsWith("127.") || value.endsWith(".localhost") || value.endsWith(".local")) return true;
  return false;
}

export function isPlaceholderValue(value: string | undefined): boolean {
  return !value || PLACEHOLDER.test(value);
}

function validPort(value: string | undefined): boolean {
  if (!value) return false;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}

function appUrlProblem(env: NodeJS.ProcessEnv): { missing: string[]; local: boolean } {
  const missing: string[] = [];
  let local = false;
  if (env.NODE_ENV !== "production") return { missing, local };
  if (isPlaceholderValue(env.APP_URL)) {
    missing.push("APP_URL");
    return { missing, local };
  }
  try {
    const url = new URL(env.APP_URL!);
    if (url.protocol !== "https:") missing.push("APP_URL (HTTPS)");
    if (isLocalDeliveryHost(url.hostname) || url.hostname.endsWith(".e2b.app")) local = true;
  } catch {
    missing.push("APP_URL");
  }
  return { missing, local };
}

export function getEmailSettingsStatus(env: NodeJS.ProcessEnv = process.env): EmailSettingsStatus {
  const missingSettings: string[] = [];
  let localOnly = false;

  if (isPlaceholderValue(env.SMTP_FROM)) missingSettings.push("SMTP_FROM");

  const smtpUrl = env.SMTP_URL?.trim();
  const smtpHost = env.SMTP_HOST?.trim();
  if (!smtpUrl && !smtpHost) {
    missingSettings.push("SMTP_URL or SMTP_HOST");
  } else if (smtpUrl) {
    try {
      const url = new URL(smtpUrl);
      if (!["smtp:", "smtps:"].includes(url.protocol) || isPlaceholderValue(smtpUrl)) {
        missingSettings.push("SMTP_URL");
      } else if (isLocalDeliveryHost(url.hostname)) {
        localOnly = true;
      }
    } catch {
      missingSettings.push("SMTP_URL");
    }
  } else {
    if (isLocalDeliveryHost(smtpHost!)) localOnly = true;
    if (!validPort(env.SMTP_PORT)) missingSettings.push("SMTP_PORT");
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) missingSettings.push("SMTP_USER/SMTP_PASS");
    if ((env.SMTP_USER || env.SMTP_PASS) && (isPlaceholderValue(env.SMTP_USER) || isPlaceholderValue(env.SMTP_PASS))) {
      missingSettings.push("SMTP_USER/SMTP_PASS");
    }
  }

  const appUrl = appUrlProblem(env);
  missingSettings.push(...appUrl.missing);
  localOnly ||= appUrl.local;

  const production = env.NODE_ENV === "production";
  const uniqueMissingSettings = [...new Set(missingSettings)];
  // A loopback sink is a real delivery path for local development only. It must
  // never be reported as configured production email.
  const configured = uniqueMissingSettings.length === 0 && (!production || !localOnly);
  return {
    configured,
    provider: configured ? "smtp" : null,
    missingSettings: uniqueMissingSettings,
    localOnly,
  };
}
