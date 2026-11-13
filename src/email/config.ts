import "server-only";

/**
 * Server-side truth about outbound email. The browser never sees SMTP settings
 * or credentials; it only receives the list of setting NAMES that are missing.
 */
export function getEmailDeliveryStatus(): {
  configured: boolean;
  provider: "smtp" | null;
  missingSettings: string[];
} {
  const missingSettings: string[] = [];
  if (!process.env.SMTP_FROM) missingSettings.push("SMTP_FROM");
  if (!process.env.SMTP_URL && !process.env.SMTP_HOST) missingSettings.push("SMTP_URL or SMTP_HOST");
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL) missingSettings.push("APP_URL");
  return {
    configured: missingSettings.length === 0,
    provider: missingSettings.length === 0 ? "smtp" : null,
    missingSettings,
  };
}
