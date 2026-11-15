import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { vapidKeys } from "@/push/vapid";

/**
 * Send one notification to every device a person has registered.
 *
 * This is the piece that makes a notification reach somebody who is not looking at the site. The
 * in-app list is the record, the email is the copy that survives, and a push is the one that arrives
 * while the person is standing in a kitchen.
 *
 * Three rules, each learned from how push actually fails:
 *
 * 1. **A dead device is revoked, not retried.** A push service answering 404 or 410 means the
 *    subscription is gone — the browser was reinstalled, the permission revoked, the phone wiped.
 *    Retrying it forever turns one stale device into a permanent error on every notification.
 *
 * 2. **A transient failure is not a dead device.** 429 and 5xx mean "not now", and revoking on those
 *    would silently unsubscribe somebody because a push service had a bad minute. Those are recorded
 *    and left alone.
 *
 * 3. **One device failing never stops the others.** A person with three devices needs the one that
 *    still works to get the message. Delivery is per-target and each is independent.
 *
 * Nothing here throws to the caller. Push is best-effort by design: the notification already exists,
 * and losing a push must never lose the record of what happened.
 */

type Target = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushPayload = {
  title: string;
  body: string;
  /** A relative path. Resolved by the service worker against the app's own origin. */
  href: string | null;
};

export type PushResult = { attempted: number; delivered: number; revoked: number; failed: number };

/** The push service's answer, reduced to the only distinction that changes behaviour. */
export function classifyPushFailure(statusCode: number | undefined): "gone" | "retry" {
  // 404: no such subscription. 410: it was explicitly unsubscribed. Both are permanent.
  if (statusCode === 404 || statusCode === 410) return "gone";
  return "retry";
}

/**
 * Build the message a phone will show.
 *
 * Kept deliberately small and free of anything that would not survive being read on a lock screen:
 * a title, one line, and where tapping it goes. The href is checked to be a site-relative path — a
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

async function targetsFor(userId: string): Promise<Target[]> {
  const result = await db.execute<Target>(sql`
    select id, endpoint, p256dh, auth from public.app_push_targets(${userId}::text)
  `);
  return result.rows;
}

async function revoke(id: string, reason: string): Promise<void> {
  await db.execute(sql`select public.app_revoke_push_subscription(${id}::uuid, ${reason})`);
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { attempted: 0, delivered: 0, revoked: 0, failed: 0 };
  const keys = vapidKeys();
  if (!keys) return result;

  let targets: Target[];
  try {
    targets = await targetsFor(userId);
  } catch {
    return result;
  }
  if (targets.length === 0) return result;

  // `web-push` is CommonJS with no ESM default wrapper, so a dynamic `import()` exposes its functions
  // at the top level and `mod.default` is undefined. Using `.default` here compiled cleanly, typechecked
  // cleanly, and would have thrown `Cannot read properties of undefined` on every single push — found
  // by actually calling this path, not by reading it.
  const webpush = await import("web-push");
  if (typeof webpush.setVapidDetails !== "function") {
    result.failed = targets.length;
    return result;
  }
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const message = buildPushPayload(payload.title, payload.body, payload.href);

  for (const target of targets) {
    result.attempted += 1;
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        message,
        // A push that has not been collected in an hour is about an offer that has expired by then.
        { TTL: 3600, urgency: "high" },
      );
      result.delivered += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (classifyPushFailure(statusCode) === "gone") {
        await revoke(target.id, `push_service_${statusCode}`).catch(() => undefined);
        result.revoked += 1;
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}
