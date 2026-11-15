import type { Pool } from "pg";
import {
  createPushSender,
  sendToDevices,
  type DeviceAnswer,
  type PushPayload,
  type PushSender,
  type PushTarget,
} from "@/push/deliver";

/**
 * Deliver pending notifications to the devices their owners registered.
 *
 * Driven from the notification rows, not from the code that creates them. Every notification in this
 * system is written by a database function, so sweeping what was written covers all of them - including
 * the ones that fan out to an unbounded set of people - and a new notification kind is push-enabled the
 * day it is added rather than when somebody remembers to wire it.
 *
 * This runs in three places and has to be correct in all of them at once: the long-lived worker, the
 * scheduled `/api/worker/drain` request, and straight after any web request that wrote a notification.
 * On the hosted deployment only the last two exist, and the scheduler fires hours apart, so the request
 * path is what makes a push arrive in seconds. Several of these can therefore be running at the same
 * moment, which is why nothing is sent that has not first been claimed:
 *
 * - `app_claim_push_batch` takes rows under `FOR UPDATE SKIP LOCKED` and leases them. Two senders never
 *   hold the same notification, so nobody gets it twice.
 * - A sender that dies - a serverless function reaching its time limit is the ordinary case - finishes
 *   nothing. The lease lapses and the rows are claimed again by whoever runs next.
 * - A notification is finished only when it has an ending: a push service accepted it, or there was no
 *   device to send it to. A send that failed for a passing reason leaves it pending.
 *
 * The batch is bounded by the claim: the last fifteen minutes only. A sender that has not run for a
 * night must not wake up and fire pushes about food that was collected yesterday.
 */
export type PushDrainResult = {
  /** False when this process has no key pair. Nothing was claimed, so a process that has one still can. */
  configured: boolean;
  /** Notifications claimed. */
  considered: number;
  /** Devices a push service accepted the message for. */
  delivered: number;
  /** Devices that could not be reached this time. */
  failed: number;
  /** Devices the push service reported as gone, now retired. */
  revoked: number;
  /** Notifications left pending for another attempt. */
  deferred: number;
};

export type PushDrainOptions = {
  /** Stop starting new sends after this long. Whatever was claimed but not started is released. */
  budgetMs?: number;
  /** Injected in tests. `undefined` builds the real sender; `null` behaves as an unconfigured process. */
  sender?: PushSender | null;
  /** Wait before the one immediate retry of a transient failure; negative turns the retry off. */
  retryDelayMs?: number;
  /** How long one push service may take to answer. A caller inside a web request allows less. */
  requestTimeoutMs?: number;
};

type Queryable = Pick<Pool, "query">;
type ClaimedRow = { id: string; user_id: string; title: string; body: string; href: string | null; attempts: number };
type TargetRow = PushTarget & { user_id: string };

const BATCH_SIZE = 100;
/** Longer than one batch can take: eight seconds per request, one retry, and room to record the result. */
const LEASE_SECONDS = 60;
const RETRY_SECONDS = 30;
/** After this many tries the notification is left to age out of the window rather than hammered. */
const MAX_ATTEMPTS = 5;
const PEOPLE_AT_ONCE = 8;
const DEFAULT_BUDGET_MS = 20_000;

type BatchEndings = {
  /** A push service accepted it for at least one device. */
  delivered?: string[];
  /** There was no device to send it to. */
  noDevice?: string[];
  /** Nothing accepted it. Try again after `retrySeconds`. */
  retry?: string[];
  retrySeconds?: number;
  /** Never tried: out of time. Straight back, and not counted as an attempt. */
  released?: string[];
  answers?: DeviceAnswer[];
};

async function finishBatch(pool: Queryable, endings: BatchEndings): Promise<void> {
  const { delivered = [], noDevice = [], retry = [], retrySeconds = RETRY_SECONDS, released = [], answers = [] } = endings;
  if (delivered.length + noDevice.length + retry.length + released.length + answers.length === 0) return;
  await pool.query(
    "select public.app_finish_push_batch($1::uuid[], $2::uuid[], $3::uuid[], $4::integer, $5::uuid[], $6::jsonb)",
    [delivered, noDevice, retry, retrySeconds, released, JSON.stringify(answers)],
  );
}

export async function drainPushOnce(pool: Queryable, options: PushDrainOptions = {}): Promise<PushDrainResult> {
  const result: PushDrainResult = { configured: false, considered: 0, delivered: 0, failed: 0, revoked: 0, deferred: 0 };
  const send = options.sender === undefined
    ? await createPushSender({ timeoutMs: options.requestTimeoutMs })
    : options.sender;
  // Checked before anything is claimed. Claiming and then finding there is no key to sign with would
  // spend an attempt on every pending notification and hide them from a process that could send them.
  if (!send) return result;
  result.configured = true;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  for (;;) {
    const batch = await pool.query<ClaimedRow>(
      "select id, user_id, title, body, href, attempts from public.app_claim_push_batch($1::integer, $2::integer)",
      [BATCH_SIZE, LEASE_SECONDS],
    );
    if (batch.rows.length === 0) break;
    result.considered += batch.rows.length;

    // One person can have several notifications in a batch. Sending each separately would put four
    // entries on a lock screen for one event, so they are grouped: the first is pushed with a count of
    // the rest, and all of them share its ending. A person who needs the detail opens the list.
    const byUser = new Map<string, ClaimedRow[]>();
    for (const row of batch.rows) {
      const existing = byUser.get(row.user_id);
      if (existing) existing.push(row);
      else byUser.set(row.user_id, [row]);
    }

    const targets = await pool.query<TargetRow>(
      "select user_id, id, endpoint, p256dh, auth from public.app_push_targets_for($1::text[])",
      [[...byUser.keys()]],
    );
    const targetsByUser = new Map<string, PushTarget[]>();
    for (const { user_id: userId, ...target } of targets.rows) {
      const existing = targetsByUser.get(userId);
      if (existing) existing.push(target);
      else targetsByUser.set(userId, [target]);
    }

    const delivered: string[] = [];
    const noDevice: string[] = [];
    const retry: string[] = [];
    const exhausted: string[] = [];
    const released: string[] = [];
    const answers: DeviceAnswer[] = [];

    const people = [...byUser.entries()];
    let next = 0;
    const sendToNextPerson = async (): Promise<void> => {
      while (next < people.length) {
        const [userId, rows] = people[next]!;
        next += 1;
        const ids = rows.map((row) => row.id);
        if (Date.now() >= deadline) {
          // Out of time before this person was reached. Hand the rows straight back rather than
          // letting them sit out the lease: the next sender should not have to wait for it.
          released.push(...ids);
          continue;
        }
        const devices = targetsByUser.get(userId) ?? [];
        if (devices.length === 0) {
          // Finished, not skipped: otherwise every notification for a person who never turned push on
          // is claimed again on every pass for the fifteen minutes it stays in the window, and turning
          // push on would replay the last quarter of an hour onto the new device.
          noDevice.push(...ids);
          continue;
        }
        const first = rows[0]!;
        const payload: PushPayload = {
          title: first.title,
          body: rows.length > 1 ? `${first.body} (+${rows.length - 1} more)` : first.body,
          href: first.href,
        };
        const deviceAnswers = await sendToDevices(send, devices, payload, { retryDelayMs: options.retryDelayMs });
        answers.push(...deviceAnswers);
        let accepted = 0;
        let gone = 0;
        for (const answer of deviceAnswers) {
          if (answer.outcome === "delivered") accepted += 1;
          else if (answer.outcome === "gone") gone += 1;
        }
        result.delivered += accepted;
        result.revoked += gone;
        result.failed += deviceAnswers.length - accepted - gone;

        if (accepted > 0) delivered.push(...ids);
        // Every device this person had is gone. There is nothing left to deliver to.
        else if (gone === deviceAnswers.length) noDevice.push(...ids);
        // Nothing accepted it and at least one device may yet. This is the case that used to be
        // recorded as delivered.
        else if (first.attempts >= MAX_ATTEMPTS) exhausted.push(...ids);
        else retry.push(...ids);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PEOPLE_AT_ONCE, people.length) }, sendToNextPerson));

    await finishBatch(pool, { delivered, noDevice, retry, released, answers });
    // Tried as often as is reasonable. Pushed past the end of the window rather than hammered: it
    // stays in the list and in email, which were always the record. Rare enough for its own round trip.
    await finishBatch(pool, { retry: exhausted, retrySeconds: 3_600 });
    result.deferred += retry.length + exhausted.length + released.length;

    if (batch.rows.length < BATCH_SIZE || Date.now() >= deadline) break;
  }
  return result;
}

export type TestPushStatus = "delivered" | "gone" | "failed" | "not_registered" | "not_configured";

/**
 * Send a test message to one device a person registered, and say what the push service answered.
 *
 * This exists because the only other way to find out whether a phone is really set up is to wait for
 * something to happen on the account - and on a deployment whose operations are paused, nothing does.
 * It writes no notification row: a test is not an event, and it should not appear in anybody's record
 * or reach their email. The device's own row does record the answer, so a subscription the push service
 * says is gone is retired by a test exactly as it would be by a real notification.
 *
 * The caller chooses `userId` from the session and `endpoint` from the browser. Only a device that is
 * registered to that person is addressed, so the endpoint cannot be used to reach anybody else's.
 */
export async function sendTestPush(
  pool: Queryable,
  userId: string,
  endpoint: string,
  payload: PushPayload,
  options: Pick<PushDrainOptions, "sender" | "retryDelayMs" | "requestTimeoutMs"> = {},
): Promise<TestPushStatus> {
  const send = options.sender === undefined
    ? await createPushSender({ timeoutMs: options.requestTimeoutMs })
    : options.sender;
  if (!send) return "not_configured";
  const targets = await pool.query<TargetRow>(
    "select user_id, id, endpoint, p256dh, auth from public.app_push_targets_for($1::text[])",
    [[userId]],
  );
  const device = targets.rows.find((row) => row.user_id === userId && row.endpoint === endpoint);
  if (!device) return "not_registered";
  const answers = await sendToDevices(
    send,
    [{ id: device.id, endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth }],
    payload,
    { retryDelayMs: options.retryDelayMs },
  );
  await finishBatch(pool, { answers });
  return answers[0]?.outcome ?? "failed";
}
