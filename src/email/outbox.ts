import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema";
import { db } from "@/db";
import { encryptValue } from "@/security/crypto";
import { databaseSslOptions, databaseUrl } from "@/lib/database-config";
import { canSendMailHere, requestInlineDelivery } from "@/worker/inline-delivery";

export type AuthEmailKind = "verification" | "password_reset";
/** Operational mail: something happened that the person may need to act on before it expires. */
export type NotificationEmailKind = "notification";

type AuthEmailPayload = {
  url: string;
  heading: string;
  description: string;
  buttonLabel: string;
};

/** Store the sensitive link encrypted, then start delivery. A scheduled scan recovers anything that was missed. */
export async function enqueueAuthEmail(kind: AuthEmailKind, recipient: string, url: string): Promise<void> {
  const payload: AuthEmailPayload = kind === "verification"
    ? {
        url,
        heading: "Confirm your email",
        description: "Use the secure link below to confirm this email address and continue your Annapurna Link account setup.",
        buttonLabel: "Confirm email",
      }
    : {
        url,
        heading: "Reset your password",
        description: "A password reset was requested for your Annapurna Link account. If this was not you, you can ignore this message.",
        buttonLabel: "Choose a new password",
      };

  await storeAndKick(kind, recipient, payload);
}

/**
 * Turn a site-relative path into the absolute URL the drain will accept.
 *
 * The origin has to be the configured one, not whatever request happened to trigger this — an email is
 * read later, on a different device, and a link built from a preview deployment's hostname would be
 * dead by the time anybody clicked it. When no origin is configured the message is skipped rather than
 * queued: a link that cannot be validated is a link that will fail the drain later, and failing now is
 * cheaper and quieter than a backlog of undeliverable mail.
 */
function resolveActionUrl(href: string): string | null {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return null;
  try {
    const origin = new URL(configured).origin;
    return new URL(href, origin).toString();
  } catch {
    return null;
  }
}

/**
 * Email somebody that something happened in their account.
 *
 * Until now the outbox carried authentication mail only, so a food offer that expires in an hour
 * notified nobody who was not already looking at the application. That is the gap this closes: the
 * in-app notification list stays the record, and this is the copy that reaches a person who has not
 * opened the app. It is deliberately not a marketing channel and carries no food or health claims.
 *
 * The link must be a relative path. It is resolved against the configured app origin by the drain,
 * which refuses an off-origin URL, so a notification cannot be used to point a recipient somewhere
 * else. Returns silently when the address is unusable: a notification that cannot be emailed is still
 * a notification, and it is already in the list.
 */
export async function enqueueNotificationEmail(
  recipient: string | null | undefined,
  heading: string,
  description: string,
  href: string,
): Promise<void> {
  if (!recipient || !recipient.includes("@") || !href.startsWith("/")) return;
  // The drain validates with `new URL(...)` and refuses anything that is not absolute, so a bare
  // "/app/offers" is rejected as EMAIL_ACTION_URL_INVALID and the message fails on every retry, forever.
  // That is exactly what happened: the queue said `pending`, the drain said `failed`, and the reason
  // was a relative path. Resolving it here means the stored payload is already the URL that gets sent.
  const resolved = resolveActionUrl(href);
  if (!resolved) return;
  // Headings and bodies are bounded in the database function that writes the notification; the same
  // bounds are applied here so a pathological string cannot become a pathological email.
  const payload: AuthEmailPayload = {
    url: resolved,
    heading: heading.slice(0, 160),
    description: `${description.slice(0, 900)}\n\nYou are receiving this because it relates to an account you belong to on Annapurna Link. It is not confirmation of approval, and no food has been certified.`,
    buttonLabel: "Open Annapurna Link",
  };
  await storeAndKick("notification", recipient, payload);
}

/** The shared tail: encrypt, store durably, then get it sent - by this process if it can, by the worker if not. */
async function storeAndKick(kind: string, recipient: string, payload: AuthEmailPayload): Promise<void> {
  const id = randomUUID();
  await db.insert(emailOutbox).values({
    id,
    recipient: recipient.toLowerCase(),
    kind,
    encryptedPayload: encryptValue(JSON.stringify(payload), "EMAIL_ENCRYPTION_KEY"),
    messageId: `<${id}@annapurna-link.local>`,
  });

  // A durable outbox row is the source of truth. If nothing below manages to send it, the periodic
  // scan will. Do not log the link or the error payload.
  //
  // Where this process can send mail itself it does so, straight after the request has answered. That
  // is the only prompt path on a host with no long-lived worker, where the job queued below is never
  // picked up: each one sat in the queue for good, the person signing up waited on the round trips it
  // took to put it there, and the message itself left hours later. Queueing the job remains the path
  // for a web tier that has no SMTP settings of its own and relies on the worker beside it.
  if (canSendMailHere() && requestInlineDelivery()) return;

  const workerDatabaseUrl = databaseUrl("WORKER_DATABASE_URL");
  if (workerDatabaseUrl) {
    try {
      const [{ Pool }, { makeWorkerUtils }] = await Promise.all([import("pg"), import("graphile-worker")]);
      const workerPool = new Pool({
        connectionString: workerDatabaseUrl,
        max: 1,
        connectionTimeoutMillis: 30_000,
        application_name: "annapurna-link-outbox-adhoc",
        ssl: databaseSslOptions(workerDatabaseUrl),
      });
      const utils = await makeWorkerUtils({ pgPool: workerPool, schema: "graphile_worker" });
      try {
        await utils.addJob("drain-email-outbox", { requestedAt: new Date().toISOString() });
      } finally {
        await utils.release();
        await workerPool.end();
      }
    } catch {
      // Kept pending; the scheduled drain is the recovery path.
    }
  }
}

export async function emailOutboxHealth(): Promise<{ pending: number; failed: number }> {
  const result = await db.execute<{ pending: string; failed: string }>(sql`
    select
      count(*) filter (where status in ('pending', 'processing'))::text as pending,
      count(*) filter (where status = 'failed')::text as failed
    from email_outbox
  `);
  const row = result.rows[0];
  return { pending: Number(row?.pending ?? 0), failed: Number(row?.failed ?? 0) };
}
