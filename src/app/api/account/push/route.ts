import { sql } from "drizzle-orm";
import { db } from "@/db";
import { assertSameOrigin, fail, json } from "@/lib/http";
import { HttpError } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";
import { pushConfigured, vapidKeys } from "@/push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Register or revoke a device for Web Push.
 *
 * The subscription is created by the browser against its push service and handed here. What arrives is
 * a credential for that device, so the rules are strict:
 *
 * - Only the signed-in person's own devices. The row is written through the app role, whose RLS policy
 *   is `user_id = app_current_user_id()`, so a bug in this handler cannot register a device to somebody
 *   else even if it tried.
 * - The endpoint must be https. A push endpoint is where this server will send signed requests; an
 *   http or relative value would be an SSRF primitive.
 * - Re-subscribing the same device updates it rather than adding a second row. Browsers re-issue the
 *   same endpoint, and duplicate rows mean duplicate notifications on one phone.
 *
 * Nothing here ever returns an endpoint or a key back to the browser. The person can see which devices
 * they have registered (label + date), not the secrets behind them.
 */

type SubscriptionBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  deviceLabel?: unknown;
};

/** A short, human label. Not the raw user agent: that is a fingerprint and a long one. */
export function deviceLabelOf(raw: unknown): string {
  const value = typeof raw === "string" ? raw.slice(0, 200) : "";
  const browser = /firefox/i.test(value) ? "Firefox"
    : /edg/i.test(value) ? "Edge"
    : /chrome|chromium/i.test(value) ? "Chrome"
    : /safari/i.test(value) ? "Safari"
    : "Browser";
  const platform = /android/i.test(value) ? "Android"
    : /iphone|ipad|ios/i.test(value) ? "iOS"
    : /windows/i.test(value) ? "Windows"
    : /mac os|macintosh/i.test(value) ? "macOS"
    : /linux/i.test(value) ? "Linux"
    : "device";
  return `${browser} on ${platform}`;
}

export function isUsableEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 8 || value.length > 2048) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    const rows = await db.execute<{ label: string | null; created_at: Date; endpoint_host: string }>(sql`
      select device_label as label, created_at, split_part(split_part(endpoint, '/', 3), '.', 1) as endpoint_host
      from public.push_subscriptions
      where user_id = ${identity.id} and revoked_at is null
      order by last_seen_at desc
    `);
    return json({
      configured: pushConfigured(),
      publicKey: pushConfigured() ? vapidKeys()!.publicKey : null,
      // The endpoint's host, never the endpoint: it identifies the push service, not the device.
      devices: rows.rows.map((row) => ({ label: row.label, addedAt: row.created_at, service: row.endpoint_host })),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    enforceMutationRateLimit({ request, bucket: "push-subscribe", userId: identity.id, userMax: 20 });

    if (!pushConfigured()) {
      return json({ error: { message: "Notifications to your device are not configured on this deployment." } }, 503);
    }

    const body = (await request.json().catch(() => ({}))) as SubscriptionBody;
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (!isUsableEndpoint(body.endpoint) || typeof p256dh !== "string" || typeof auth !== "string"
      || p256dh.length > 200 || auth.length > 100) {
      throw new HttpError(400, "That notification subscription is not usable.", "PUSH_SUBSCRIPTION_INVALID");
    }

    const label = deviceLabelOf(request.headers.get("user-agent"));
    await db.execute(sql`
      insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
      values (${identity.id}, ${body.endpoint}, ${p256dh}, ${auth}, ${label})
      on conflict (endpoint) do update
        set p256dh = excluded.p256dh,
            auth = excluded.auth,
            device_label = excluded.device_label,
            last_seen_at = now(),
            revoked_at = null,
            last_error = null
        where public.push_subscriptions.user_id = excluded.user_id
    `);
    return json({ registered: true, label }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    enforceMutationRateLimit({ request, bucket: "push-unsubscribe", userId: identity.id, userMax: 20 });
    const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };

    // Revoked by endpoint, scoped to the caller by RLS. There is no delete: a revoked row is the record
    // that a device was once registered, which is what somebody will ask for if a notification is
    // claimed never to have arrived.
    await db.execute(sql`
      update public.push_subscriptions
      set revoked_at = now(), last_error = 'unsubscribed_by_owner'
      where revoked_at is null
        and user_id = ${identity.id}
        and (${isUsableEndpoint(body.endpoint) ? body.endpoint : null}::text is null or endpoint = ${isUsableEndpoint(body.endpoint) ? body.endpoint : null})
    `);
    return json({ revoked: true });
  } catch (error) {
    return fail(error);
  }
}
