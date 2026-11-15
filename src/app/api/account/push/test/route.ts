import { assertSameOrigin, fail, HttpError, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { isUsableEndpoint } from "@/push/subscription";
import { pushConfigured } from "@/push/vapid";
import { enforceMutationRateLimit } from "@/security/rate-limit";
import { withWorkerPool } from "@/worker/inline-delivery";
import { sendTestPush } from "@/worker/push-drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Send a test notification to the device the caller is holding, and report what happened.
 *
 * "Notifications are on" is a claim about four separate systems - this server's keys, a push service,
 * the browser and the operating system's own notification settings - and until now the only way to
 * check it was to wait for something to happen on the account. On a deployment whose operations are
 * paused, nothing does. This answers the question in one tap, and the answer is specific: the push
 * service accepted the message, or it said the subscription is gone, or it could not be reached.
 *
 * It is deliberately narrow. The device is named by the endpoint the browser holds and must already be
 * registered to the signed-in person, so this cannot be pointed at anybody else's phone. It sends fixed
 * text, never anything from the request. And it is rate limited per person, because a button that makes
 * a phone buzz is a button somebody will lean on.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, bucket: "push-test", userId: identity.id, userMax: 5, ipMax: 30 });

    if (!pushConfigured()) {
      throw new HttpError(503, "Notifications to your device are not configured on this deployment.", "PUSH_NOT_CONFIGURED");
    }
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (!isUsableEndpoint(body?.endpoint)) {
      throw new HttpError(400, "Turn notifications on for this device first.", "PUSH_DEVICE_REQUIRED");
    }
    const endpoint = body.endpoint;

    const status = await withWorkerPool("annapurna-link-push-test", (pool) => sendTestPush(
      pool,
      identity.id,
      endpoint,
      {
        title: "Annapurna Link",
        body: "Test notification. This device is set up to receive updates from your account.",
        href: "/app/notifications",
      },
      { requestTimeoutMs: 6_000, retryDelayMs: 1_000 },
    ));
    if (status === null || status === "not_configured") {
      throw new HttpError(503, "Notifications cannot be sent from this deployment right now.", "PUSH_SENDER_UNAVAILABLE");
    }

    // 200 in every case that reached a decision: the request worked, and the body says what the push
    // service did. The page words each outcome for the person; nothing here names the push service's
    // own response.
    return json({ status });
  } catch (error) {
    return fail(error);
  }
}
