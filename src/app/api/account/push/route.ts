import { sql } from "drizzle-orm";
import { withUserContext } from "@/db";
import { assertSameOrigin, fail, HttpError, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";
import { deviceLabelOf, endpointFingerprint, isUsableEndpoint, parseSubscription, pushServiceOf } from "@/push/subscription";
import { pushConfigured, vapidKeys } from "@/push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Register or revoke a device for Web Push.
 *
 * The subscription is created by the browser against its push service and handed here. What arrives is
 * a credential for that device, so the rules are strict:
 *
 * - Only the signed-in person's own devices. Every statement below runs inside `withUserContext`, which
 *   is what tells the database who is asking; the table's row-level security is forced, so a statement
 *   sent without it reads nothing and writes nothing. That is not a formality. The first version of this
 *   file queried the table directly, the database refused every insert, and "Turn on for this device"
 *   could not succeed for anybody on any deployment.
 * - The endpoint must be https. A push endpoint is where this server will send signed requests; an
 *   http or relative value would be an SSRF primitive.
 * - A browser has one live registration. Registering it again updates that row, and a browser that was
 *   registered to a different account - a shared phone - moves to the person now signed in on it.
 * - A replacement continues a registration, it does not start one. The service worker reports a
 *   subscription the browser rotated by itself, naming the one it replaces (`replaces`). That is
 *   accepted only if the old one is live and belongs to the caller; otherwise a background event could
 *   enrol whoever happens to be signed in on a browser where somebody else once pressed the button.
 *
 * Nothing here ever returns an endpoint or a key back to the browser. The person can see which devices
 * they have registered (label, date and a fingerprint of the endpoint), not the secrets behind them.
 */

function databaseErrorCode(error: unknown): string | undefined {
  // The query layer wraps the driver's error, so the SQLSTATE is on the cause, not on what is thrown.
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    const rows = await withUserContext(identity.id, (tx) => tx.execute<{ label: string | null; created_at: Date; endpoint: string }>(sql`
      select device_label as label, created_at, endpoint
      from public.push_subscriptions
      where user_id = ${identity.id} and revoked_at is null
      order by last_seen_at desc, created_at desc
      limit 10
    `));
    const configured = pushConfigured();
    return json({
      configured,
      publicKey: configured ? vapidKeys()!.publicKey : null,
      devices: rows.rows.map((row) => ({
        label: row.label,
        addedAt: row.created_at,
        // The host's first label, never the endpoint: it identifies the push service, not the device.
        service: pushServiceOf(row.endpoint),
        // Lets a browser recognise its own subscription in this list without the list containing it.
        fingerprint: endpointFingerprint(row.endpoint),
      })),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, bucket: "push-subscribe", userId: identity.id, userMax: 20 });

    if (!pushConfigured()) {
      throw new HttpError(503, "Notifications to your device are not configured on this deployment.", "PUSH_NOT_CONFIGURED");
    }

    const body = await request.json().catch(() => null) as { replaces?: unknown } | null;
    const subscription = parseSubscription(body);
    if (!subscription) {
      throw new HttpError(400, "That notification subscription is not usable.", "PUSH_SUBSCRIPTION_INVALID");
    }
    const replaces = body?.replaces === undefined || body.replaces === null ? null : body.replaces;
    if (replaces !== null && !isUsableEndpoint(replaces)) {
      throw new HttpError(400, "That notification subscription is not usable.", "PUSH_SUBSCRIPTION_INVALID");
    }

    const label = deviceLabelOf(request.headers.get("user-agent"));
    try {
      await withUserContext(identity.id, async (tx) => {
        if (replaces !== null && replaces !== subscription.endpoint) {
          const retired = await tx.execute<{ id: string }>(sql`
            update public.push_subscriptions
            set revoked_at = now(), last_error = 'replaced_by_browser'
            where user_id = ${identity.id} and endpoint = ${replaces} and revoked_at is null
            returning id
          `);
          if (retired.rows.length === 0) {
            throw new HttpError(409, "There is no registration on this account for that device to continue.", "PUSH_SUBSCRIPTION_NOT_CONTINUED");
          }
        }
        await tx.execute(sql`
          select public.app_register_push_subscription(
            ${subscription.endpoint}, ${subscription.p256dh}, ${subscription.auth}, ${label}
          )
        `);
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        // Live for another account, and this browser did not present that registration's keys. A real
        // browser cannot get here; the answer still has to be a refusal rather than a takeover.
        throw new HttpError(409, "This browser is registered for notifications on another account. Turn notifications off for this site in the browser's settings, reload, and try again.", "PUSH_SUBSCRIPTION_CONFLICT");
      }
      throw error;
    }
    return json({ registered: true, label, fingerprint: endpointFingerprint(subscription.endpoint) }, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, bucket: "push-unsubscribe", userId: identity.id, userMax: 20 });
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown; all?: unknown } | null;

    // One device, or - only when asked for in so many words - every device. A body with neither used
    // to mean "all of them", which is the wrong thing to do by default: a browser that had lost its own
    // subscription and pressed "turn off" silenced the person's other phone.
    const everyDevice = body?.all === true;
    const endpoint = isUsableEndpoint(body?.endpoint) ? body.endpoint : null;
    if (!everyDevice && !endpoint) {
      throw new HttpError(400, "Say which device to turn notifications off for.", "PUSH_DEVICE_REQUIRED");
    }

    // There is no delete: a revoked row is the record that a device was once registered, which is what
    // somebody will ask for if a notification is claimed never to have arrived.
    const revoked = await withUserContext(identity.id, (tx) => tx.execute<{ id: string }>(sql`
      update public.push_subscriptions
      set revoked_at = now(), last_error = ${everyDevice ? "unsubscribed_everywhere_by_owner" : "unsubscribed_by_owner"}
      where revoked_at is null
        and user_id = ${identity.id}
        and (${everyDevice} or endpoint = ${endpoint})
      returning id
    `));
    return json({ revoked: true, devices: revoked.rows.length });
  } catch (error) {
    return fail(error);
  }
}
