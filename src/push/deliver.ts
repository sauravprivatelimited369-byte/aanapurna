import "server-only";
import { vapidKeys } from "@/push/vapid";

/**
 * Send one message to a set of devices, and say exactly what each push service answered.
 *
 * This is the piece that makes a notification reach somebody who is not looking at the site. The
 * in-app list is the record, the email is the copy that survives, and a push is the one that arrives
 * while the person is standing in a kitchen.
 *
 * Four rules, each learned from how push actually fails:
 *
 * 1. **A dead device is retired, not retried.** A push service answering 404 or 410 means the
 *    subscription is gone - the browser was reinstalled, the permission revoked, the phone wiped.
 *    Retrying it forever turns one stale device into a permanent error on every notification.
 *
 * 2. **A transient failure is not a dead device, and it is not a delivery either.** 429, 5xx and a
 *    connection that never answered mean "not now". Retiring the device on those would silently
 *    unsubscribe somebody because a push service had a bad minute; reporting them as delivered loses the
 *    notification. They are tried once more straight away and otherwise reported as `failed`, so the
 *    caller can leave the notification pending.
 *
 * 3. **One device failing never stops the others.** A person with three devices needs the one that
 *    still works to get the message. Every device is addressed independently and at the same time.
 *
 * 4. **A push service that hangs is a failure with a deadline.** Without a timeout one stalled
 *    connection holds the whole batch, and on a serverless host it holds it until the function is
 *    killed with nothing recorded.
 *
 * Nothing here reads or writes the database, and nothing here throws: the answers go back to the
 * caller, which owns the record of what was and was not delivered.
 */

export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushPayload = {
  title: string;
  body: string;
  /** A relative path. Resolved by the service worker against the app's own origin. */
  href: string | null;
};

/** One device, one answer. `reason` never contains the endpoint or anything a push service said. */
export type DeviceAnswer = { id: string; outcome: "delivered" | "gone" | "failed"; reason: string | null };

/** Resolves when a push service accepted the message; rejects with `statusCode` when it answered otherwise. */
export type PushSender = (target: PushTarget, message: string) => Promise<void>;

/** Long enough for a slow mobile-network push service, short enough to fit inside one request. */
export const PUSH_REQUEST_TIMEOUT_MS = 8_000;

/** The push service's answer, reduced to the only distinction that changes what happens to the device. */
export function classifyPushFailure(statusCode: number | undefined): "gone" | "retry" {
  // 404: no such subscription. 410: it was explicitly unsubscribed. Both are permanent.
  if (statusCode === 404 || statusCode === 410) return "gone";
  return "retry";
}

/**
 * Whether asking again a moment later could plausibly get a different answer.
 *
 * No status at all is a network failure or a timeout. 408, 429 and 5xx are the push service saying it
 * could not take the message right now. Anything else - a rejected signature, a malformed request, a
 * payload that is too large - will be rejected identically a second time, so it is not asked twice.
 */
export function worthRetryingNow(statusCode: number | undefined): boolean {
  if (statusCode === undefined) return true;
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * Build the message a phone will show.
 *
 * Kept deliberately small and free of anything that would not survive being read on a lock screen:
 * a title, one line, and where tapping it goes. The href is checked to be a site-relative path - a
 * push payload is rendered by a service worker, and an absolute URL there is how a notification becomes
 * a redirect somewhere else.
 */
export function buildPushPayload(title: string, body: string, href: string | null): string {
  const safeHref = href && href.startsWith("/") && !href.startsWith("//") ? href : "/app";
  return JSON.stringify({
    title: title.slice(0, 120),
    body: body.slice(0, 240),
    href: safeHref,
  });
}

/**
 * The real sender, or null when this process has no key pair.
 *
 * Null is a normal answer, not an error: a process without keys must leave pending notifications alone
 * so that a process which has them can send them.
 */
export async function createPushSender(options: { timeoutMs?: number } = {}): Promise<PushSender | null> {
  const keys = vapidKeys();
  if (!keys) return null;
  // `web-push` exposes its functions as named exports of the module namespace; there is no default
  // export to reach through. Checked rather than assumed, because the wrong shape here typechecks and
  // then fails on every single send.
  const webpush = await import("web-push");
  if (typeof webpush.sendNotification !== "function") return null;
  const vapidDetails = { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey };
  const timeout = options.timeoutMs ?? PUSH_REQUEST_TIMEOUT_MS;
  return async (target, message) => {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      message,
      // A push that has not been collected in an hour is about an offer that has expired by then.
      { TTL: 3600, urgency: "high", timeout, vapidDetails },
    );
  };
}

function statusCodeOf(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendToDevice(send: PushSender, target: PushTarget, message: string, retryDelayMs: number): Promise<DeviceAnswer> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await send(target, message);
      return { id: target.id, outcome: "delivered", reason: null };
    } catch (error) {
      const statusCode = statusCodeOf(error);
      if (classifyPushFailure(statusCode) === "gone") {
        return { id: target.id, outcome: "gone", reason: `push_service_${statusCode}` };
      }
      if (attempt >= 2 || retryDelayMs < 0 || !worthRetryingNow(statusCode)) {
        return {
          id: target.id,
          outcome: "failed",
          reason: statusCode === undefined ? "push_service_unreachable" : `push_service_${statusCode}`,
        };
      }
      await pause(retryDelayMs);
    }
  }
}

/**
 * Address every target at once and collect one answer per device.
 *
 * `retryDelayMs` is how long to wait before the single immediate retry of a transient failure; a
 * negative value turns the retry off.
 */
export async function sendToDevices(
  send: PushSender,
  targets: PushTarget[],
  payload: PushPayload,
  options: { retryDelayMs?: number } = {},
): Promise<DeviceAnswer[]> {
  if (targets.length === 0) return [];
  const message = buildPushPayload(payload.title, payload.body, payload.href);
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  return Promise.all(targets.map((target) => sendToDevice(send, target, message, retryDelayMs)));
}
