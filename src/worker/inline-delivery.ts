import "server-only";
import { after } from "next/server";
import { Pool } from "pg";
import { getEmailSettingsStatus } from "@/email/settings";
import { databaseConnectionTimeoutMillis, databaseSslOptions, databaseUrl } from "@/lib/database-config";
import { pushConfigured } from "@/push/vapid";
import { AFTER_RESPONSE_DELIVERY_KEY, tryRecordDeliverySighting } from "@/worker/heartbeat";
import { drainEmailOutboxWhileDue } from "@/worker/outbox-drain";
import { drainPushOnce } from "@/worker/push-drain";

/**
 * Deliver what a request just queued, as soon as that request has answered.
 *
 * The outbox and the notification table were built for a long-lived worker that wakes every second.
 * The hosted deployment cannot run one. What it had instead was a scheduled call to
 * `/api/worker/drain`, and in practice that schedule fires hours apart: the two verification emails
 * real people had been sent left five and twelve hours after they signed up, against a link that
 * expires in one, and a push is only worth sending for fifteen minutes. A queue nobody drains in time
 * is a queue that loses things.
 *
 * So the web tier drains its own queue. `after()` runs a task once the response has been sent - on
 * Vercel the function instance is kept alive for it - which means the person who signed up is not kept
 * waiting on an SMTP conversation, and the person an offer is for is told within seconds rather than
 * whenever a scheduler next happens to run.
 *
 * Everything here goes through the same reservation the worker and the scheduled drain use, so the
 * three can run at once without sending anything twice, and none of them is required: whichever gets
 * there first delivers, and the others find nothing to do.
 */

/**
 * Mail is taken a few messages at a time, so that an instance stopped part-way strands a handful of
 * reservations and not a queue's worth; and batch after batch, because one batch is only the oldest
 * few. Six older messages waiting - undeliverable ones are enough - would otherwise mean the message
 * this request has just queued is not attempted at all, and nothing else runs here for hours.
 *
 * No batch is started after the budget. That leaves the last one eight seconds to finish before the
 * pass is given up on, which is several times what six messages, three at a time, take to send.
 */
const INLINE_MAIL_BATCH = 6;
const INLINE_MAIL_AT_ONCE = 3;
const INLINE_MAIL_BUDGET_MS = 12_000;
const INLINE_PUSH_BUDGET_MS = 5_000;
const INLINE_PUSH_TIMEOUT_MS = 4_000;
const INLINE_PUSH_RETRY_DELAY_MS = 750;
/**
 * The longest one pass may hold the instance. Reached only when something has stopped answering
 * altogether - a database socket that died while the instance was frozen is the realistic case. What
 * was claimed stays claimed until its lease lapses, and the next sender takes it from there.
 */
const INLINE_PASS_DEADLINE_MS = 20_000;
const WORKER_QUERY_TIMEOUT_MS = 12_000;

/**
 * Whether this process is able to send mail at all.
 *
 * Matters because the drain *defers* every queued message when SMTP is not configured. That is right
 * for the one process responsible for mail and badly wrong for a web tier sitting beside a worker that
 * can send: it would keep pushing the worker's mail into the future.
 */
export function canSendMailHere(): boolean {
  return getEmailSettingsStatus().configured;
}

/** Whether this process holds the worker's database credentials. Without them nothing here can send. */
export function inlineDeliveryAvailable(): boolean {
  return Boolean(databaseUrl("WORKER_DATABASE_URL"));
}

/** Resolve when `task` settles or when time runs out, whichever is first. Never rejects. */
function settledWithin(task: Promise<unknown>, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    const done = () => { clearTimeout(timer); resolve(); };
    task.then(done, done);
  });
}

/**
 * Run a task with a short-lived connection as the worker role, or return null where there is none.
 *
 * Opened per use and closed straight after, exactly as `/api/worker/drain` does: a serverless instance
 * that is frozen between requests must not be left holding database sessions it is not using.
 */
export async function withWorkerPool<T>(applicationName: string, task: (pool: Pool) => Promise<T>): Promise<T | null> {
  const url = databaseUrl("WORKER_DATABASE_URL");
  if (!url) return null;
  const pool = new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    idleTimeoutMillis: 5_000,
    // A query that gets no answer fails instead of waiting for ever. The sockets of a serverless
    // instance can die silently while it is frozen, and nothing else would ever notice.
    query_timeout: WORKER_QUERY_TIMEOUT_MS,
    application_name: applicationName,
    ssl: databaseSslOptions(url),
  });
  // A connection dropped while idle is reported as an `error` event; unhandled, it ends the process.
  pool.on("error", () => undefined);
  try {
    return await task(pool);
  } finally {
    // Closed politely, but not waited on indefinitely: a dead socket never acknowledges.
    await settledWithin(pool.end(), 2_000);
  }
}

function describeFailure(reason: unknown): string {
  return reason instanceof Error ? reason.message.slice(0, 200) : "unknown";
}

async function deliverPendingOnce(): Promise<void> {
  const mail = canSendMailHere();
  const push = pushConfigured();
  if (!mail && !push) return;
  try {
    await withWorkerPool("annapurna-link-inline-delivery", async (pool) => {
      // At the same time, on a connection each. A slow mail server must not be the reason a phone is
      // told late, and a push service having a bad minute must not hold up a verification link.
      const [mailed, pushed] = await Promise.allSettled([
        mail
          ? drainEmailOutboxWhileDue(pool, {
              batchSize: INLINE_MAIL_BATCH,
              sendsAtOnce: INLINE_MAIL_AT_ONCE,
              budgetMs: INLINE_MAIL_BUDGET_MS,
            })
          : null,
        push
          ? drainPushOnce(pool, {
              budgetMs: INLINE_PUSH_BUDGET_MS,
              requestTimeoutMs: INLINE_PUSH_TIMEOUT_MS,
              retryDelayMs: INLINE_PUSH_RETRY_DELAY_MS,
            })
          : null,
      ]);
      const mailResult = mailed.status === "fulfilled" ? mailed.value : null;
      const pushResult = pushed.status === "fulfilled" ? pushed.value : null;
      // Counts only. No recipient, link, endpoint or message text is ever logged.
      if (mailed.status === "rejected" || pushed.status === "rejected") {
        console.error(JSON.stringify({
          level: "error",
          event: "inline_delivery.failed",
          mail: mailed.status === "rejected" ? describeFailure(mailed.reason) : null,
          push: pushed.status === "rejected" ? describeFailure(pushed.reason) : null,
        }));
      }
      if ((mailResult?.reserved ?? 0) > 0 || (pushResult?.considered ?? 0) > 0) {
        console.info(JSON.stringify({
          level: "info",
          event: "inline_delivery.completed",
          mail: mailResult ? { sent: mailResult.sent, failed: mailResult.failed } : null,
          push: pushResult
            ? { considered: pushResult.considered, delivered: pushResult.delivered, failed: pushResult.failed, revoked: pushResult.revoked, deferred: pushResult.deferred }
            : null,
        }));
      }
      // When this last happened, for `/api/health`. It is the only evidence a person can look at
      // that the host really does run work after a response; without it a host that stopped doing
      // so would look exactly like a quiet day.
      await tryRecordDeliverySighting(pool, AFTER_RESPONSE_DELIVERY_KEY, {
        mailSent: mailResult ? mailResult.sent : null,
        mailFailed: mailResult ? mailResult.failed : null,
        pushDelivered: pushResult ? pushResult.delivered : null,
        pushFailed: pushResult ? pushResult.failed : null,
      });
    });
  } catch (error) {
    // Whatever was queued is still queued. The scheduled drain is the recovery path.
    console.error(JSON.stringify({ level: "error", event: "inline_delivery.failed", message: describeFailure(error) }));
  }
}

/** One pass over both queues. `reading` turns true once it has begun claiming rows. */
type Pass = { promise: Promise<void>; reading: boolean };

let current: Pass | null = null;
let following: Promise<void> | null = null;

function startPass(): Pass {
  const pass: Pass = { promise: Promise.resolve(), reading: false };
  pass.promise = (async () => {
    try {
      // One turn of the event loop before anything is read, so that every task the same response
      // registered has joined by then.
      await new Promise<void>((resolve) => setImmediate(resolve));
      pass.reading = true;
      await settledWithin(deliverPendingOnce(), INLINE_PASS_DEADLINE_MS);
    } finally {
      if (current === pass) current = null;
    }
  })();
  return pass;
}

/**
 * Deliver what is pending, once, however many callers ask at the same moment.
 *
 * One offer can notify a dozen people and queue a dozen emails, each of which asks for delivery. They
 * all share one pass. A caller that arrives after that pass has started reading needs another, because
 * its rows may have been committed after the batch was claimed; everybody who arrives in the meantime
 * shares that one too, and it starts when the pass in progress ends, so two never run side by side.
 *
 * Each caller's promise settles when the pass that covers it has finished - not before, because that
 * promise is what keeps a serverless instance alive for long enough, and not after, because a function
 * has a time limit and on a busy instance somebody new arrives during every pass. Nobody is held for
 * more than the pass in progress and one more, which is twice `INLINE_PASS_DEADLINE_MS` at the worst.
 */
export function deliverPendingNow(): Promise<void> {
  if (!current) {
    current = startPass();
    return current.promise;
  }
  if (!current.reading) return current.promise;
  if (!following) {
    const startNext = () => {
      following = null;
      // Somebody may have begun a pass in the instant between the last one ending and this running.
      // It cannot have read anything yet, so it covers these callers as well.
      if (!current) current = startPass();
      return current.promise;
    };
    following = current.promise.then(startNext, startNext);
  }
  return following;
}

/**
 * Ask for delivery once the current request has answered. Returns false when there is no request.
 *
 * Safe to call inside a transaction that has not committed yet: the task runs after the response, and
 * the response is sent after the transaction has ended. If it rolled back there is simply nothing to
 * deliver. Outside a request - a script, a test, the long-lived worker - there is nothing to wait for
 * and this declines, leaving delivery to whatever that process already does.
 */
export function requestInlineDelivery(): boolean {
  if (!inlineDeliveryAvailable()) return false;
  try {
    after(() => deliverPendingNow());
    return true;
  } catch {
    return false;
  }
}
