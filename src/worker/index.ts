import "server-only";
import { createTransport, type Transporter } from "nodemailer";
import { Pool } from "pg";
import { run } from "graphile-worker";
import { decryptValue } from "@/security/crypto";
import { getEmailSettingsStatus } from "../email/settings";

type OutboxRow = {
  id: string;
  recipient: string;
  kind: string;
  encrypted_payload: string;
  attempts: number;
  message_id: string;
};
type EmailPayload = { url: string; heading: string; description: string; buttonLabel: string };

const workerDatabaseUrl = process.env.WORKER_DATABASE_URL;
if (!workerDatabaseUrl) throw new Error("WORKER_DATABASE_URL is required to run the background worker.");
if (process.env.NODE_ENV === "production" && !process.env.APP_URL) {
  throw new Error("APP_URL is required in production so action links can be origin-checked.");
}
const pool = new Pool({
  connectionString: workerDatabaseUrl,
  max: 4,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  application_name: "annapurna-link-worker",
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 20;
const RETRY_INTERVAL_MS = 30_000;
let transporter: Transporter | null = null;

function smtpConfigured() {
  // In production this rejects loopback sinks, placeholder URLs and incomplete
  // explicit SMTP settings instead of pretending a delivery attempt was made.
  return getEmailSettingsStatus().configured;
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (process.env.SMTP_URL) {
    transporter = createTransport(process.env.SMTP_URL);
    return transporter;
  }
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP is not configured.");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  transporter = createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function validateActionUrl(raw: string): string {
  let actionUrl: URL;
  try {
    actionUrl = new URL(raw);
  } catch {
    throw new Error("EMAIL_ACTION_URL_INVALID");
  }
  if (actionUrl.protocol !== "https:" && actionUrl.protocol !== "http:") throw new Error("EMAIL_ACTION_URL_INVALID");
  if (actionUrl.username || actionUrl.password) throw new Error("EMAIL_ACTION_URL_INVALID");

  const configuredAppUrl = process.env.APP_URL;
  if (configuredAppUrl) {
    let appOrigin: string;
    try { appOrigin = new URL(configuredAppUrl).origin; } catch { throw new Error("APP_URL_INVALID"); }
    if (actionUrl.origin !== appOrigin) throw new Error("EMAIL_ACTION_URL_ORIGIN_MISMATCH");
    return actionUrl.toString();
  }
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL_REQUIRED");
  const localOrigin = actionUrl.origin === "http://localhost:3000" || actionUrl.origin === "http://127.0.0.1:3000";
  const arenaPreview = actionUrl.protocol === "https:" && /^[a-z0-9-]+\.e2b\.app$/i.test(actionUrl.hostname);
  if (!localOrigin && !arenaPreview) throw new Error("EMAIL_ACTION_URL_ORIGIN_MISMATCH");
  return actionUrl.toString();
}

async function deferOutboxUntilSmtpIsConfigured() {
  await pool.query("SELECT public.app_worker_defer_outbox($1, $2)", [MAX_ATTEMPTS, 15]);
}

async function reserveOutboxBatch(): Promise<OutboxRow[]> {
  const result = await pool.query<OutboxRow>(
    "SELECT * FROM public.app_worker_reserve_outbox_batch($1, $2)",
    [MAX_ATTEMPTS, BATCH_SIZE],
  );
  return result.rows;
}

async function markSent(row: OutboxRow) {
  await pool.query("SELECT public.app_worker_mark_outbox_sent($1::uuid)", [row.id]);
}

async function markFailed(row: OutboxRow, code: string) {
  const backoffSeconds = Math.min(3600, Math.max(30, RETRY_INTERVAL_MS / 1000 * 2 ** Math.max(0, row.attempts - 1)));
  const result = await pool.query<{ app_worker_mark_outbox_failed: boolean }>(
    "SELECT public.app_worker_mark_outbox_failed($1::uuid, $2, $3, $4) AS app_worker_mark_outbox_failed",
    [row.id, MAX_ATTEMPTS, backoffSeconds, code],
  );
  console.error(JSON.stringify({
    level: "error",
    event: "email_outbox.delivery_failed",
    outboxId: row.id,
    code,
    updated: result.rows[0]?.app_worker_mark_outbox_failed ?? false,
  }));
}

async function deliverRow(row: OutboxRow) {
  try {
    const payload = JSON.parse(decryptValue(row.encrypted_payload, "EMAIL_ENCRYPTION_KEY")) as EmailPayload;
    if (!payload.url || !payload.heading || !payload.description || !payload.buttonLabel) throw new Error("EMAIL_PAYLOAD_INVALID");
    const actionUrl = validateActionUrl(payload.url);
    const safeUrl = escapeHtml(actionUrl);
    const safeHeading = escapeHtml(payload.heading);
    const safeDescription = escapeHtml(payload.description);
    const safeButtonLabel = escapeHtml(payload.buttonLabel);
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to: row.recipient,
      subject: payload.heading,
      text: `${payload.description}\n\n${actionUrl}\n\nIf you did not request this message, you may ignore it.`,
      html: `<!doctype html><html lang="en"><body style="margin:0;background:#0a0a0c;color:#f5f1e8;font:16px/1.6 Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#14141a;border:1px solid #303039;border-radius:16px"><p style="color:#ffb703;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;font-size:12px">Annapurna Link</p><h1 style="font-size:26px">${safeHeading}</h1><p>${safeDescription}</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:14px 20px;border-radius:24px;background:#ffb703;color:#1a1200;text-decoration:none;font-weight:bold">${safeButtonLabel}</a></p><p style="color:#9a9aa5;font-size:13px">If you did not request this message, you may ignore it. This email is not confirmation of account or partner approval.</p></main></body></html>`,
      messageId: row.message_id,
      headers: { "X-Entity-Ref-ID": row.id },
    });
    await markSent(row);
  } catch {
    // Do not log action URLs, payloads, SMTP response text or recipients.
    await markFailed(row, "SMTP_OR_PAYLOAD_ERROR");
  }
}

async function drainEmailOutbox() {
  if (!smtpConfigured()) {
    await deferOutboxUntilSmtpIsConfigured();
    return;
  }
  const rows = await reserveOutboxBatch();
  for (const row of rows) await deliverRow(row);
}

async function startWorker() {
  const runner = await run({
    connectionString: workerDatabaseUrl,
    schema: "graphile_worker",
    concurrency: 2,
    pollInterval: 1_000,
    taskList: { "drain-email-outbox": drainEmailOutbox },
    crontab: "* * * * * drain-email-outbox",
  });

  runner.promise.catch(async (error: unknown) => {
    console.error(JSON.stringify({ level: "error", event: "worker.stopped_unexpectedly", message: error instanceof Error ? error.message : "unknown" }));
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void runner.stop(signal).then(() => pool.end()).catch(() => { process.exitCode = 1; });
    });
  }
}

void startWorker().catch(async (error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "worker.startup_failed", message: error instanceof Error ? error.message : "unknown" }));
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
