import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { releaseDeliveryAssignment } from "@/domain/service";
import { deliveryReleaseSchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

/**
 * Operations-only release of an uncollected assignment. The service checks the
 * platform role, the delivery state and the recorded reason; the route only
 * parses input, enforces same-origin and rate limits.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "delivery-release", userMax: 20, ipMax: 60 });
    const { id } = await params;
    const body = await readJson(request, deliveryReleaseSchema);
    return json(await releaseDeliveryAssignment(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
