import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema";
import { db } from "@/db";
import { encryptValue } from "@/security/crypto";
import { databaseSslOptions, databaseUrl } from "@/lib/database-config";

export type AuthEmailKind = "verification" | "password_reset";

type AuthEmailPayload = {
  url: string;
  heading: string;
  description: string;
  buttonLabel: string;
};

/** Store the sensitive link encrypted, then kick the PostgreSQL-backed worker. A scheduled scan recovers missed kicks. */
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

  const id = randomUUID();
  await db.insert(emailOutbox).values({
    id,
    recipient: recipient.toLowerCase(),
    kind,
    encryptedPayload: encryptValue(JSON.stringify(payload), "EMAIL_ENCRYPTION_KEY"),
    messageId: `<${id}@annapurna-link.local>`,
  });

  // A durable outbox row is the source of truth. If the worker or its queue is unavailable,
  // the periodic worker scan will still deliver it. Do not log the link or the error payload.
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
