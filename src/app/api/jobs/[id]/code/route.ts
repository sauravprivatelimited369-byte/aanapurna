import { fail, assertSameOrigin, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { getReceiverDeliveryCode } from "@/domain/service";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    await enforceRateLimit({ bucket: `delivery-code-user:${id}`, subject: identity.id, max: 10, windowSeconds: 60 });
    await enforceRateLimit({ bucket: `delivery-code-ip:${id}`, subject: getRequestAddressKey(request), max: 30, windowSeconds: 60 });
    return json(await getReceiverDeliveryCode(identity, id));
  } catch (error) {
    return fail(error);
  }
}
