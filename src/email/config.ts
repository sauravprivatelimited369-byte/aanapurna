import "server-only";
import { getEmailSettingsStatus } from "@/email/settings";

/**
 * Server-side truth about outbound email. The browser never sees SMTP settings
 * or credentials; it only receives the list of setting NAMES that are missing.
 */
export function getEmailDeliveryStatus(): {
  configured: boolean;
  provider: "smtp" | null;
  missingSettings: string[];
  localOnly: boolean;
  testSink: boolean;
} {
  return getEmailSettingsStatus();
}
