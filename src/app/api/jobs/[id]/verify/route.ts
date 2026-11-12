import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { verifyDelivery } from "@/domain/service";
import { verifyDeliverySchema } from "@/domain/validation";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    await enforceRateLimit({ bucket: `delivery-verify-user:${id}`, subject: identity.id, max: 5, windowSeconds: 60 });
    await enforceRateLimit({ bucket: `delivery-verify-ip:${id}`, subject: getRequestAddressKey(request), max: 20, windowSeconds: 60 });
    const body = await readJson(request, verifyDeliverySchema);
    const result = await verifyDelivery(identity, id, body.code);
    return json(result, result.verified ? 200 : 422);
  } catch (error) {
    return fail(error);
  }
}
