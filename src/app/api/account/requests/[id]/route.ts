import { getRequestProgress } from "@/domain/service";
import { fail, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where one of a person's own requests has got to.
 *
 * Scoped to the caller: asking about somebody else's request returns 404, the same answer as asking
 * about an id that does not exist, so this cannot be used to enumerate requests. Staff may read any
 * request because they are answerable for the queue.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireIdentity(request.headers);
    enforceRateLimit({
      bucket: "account-request-progress",
      subject: getRequestAddressKey(request),
      max: 120,
      windowSeconds: 3600,
    });
    const { id } = await context.params;
    return json(await getRequestProgress(identity, id));
  } catch (error) {
    return fail(error);
  }
}
