import { fail, assertSameOrigin, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { claimDelivery } from "@/domain/service";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

/**
 * The receiving organisation collects the food itself.
 *
 * Same state machine as a Helper claim - assignment, custody event, collection code, receipt - with
 * the receiving operator as the assigned collector. It is refused when the service area's transit
 * limit says the route is too long, and the caller must already operate the receiving organisation.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "delivery-self-collect", userMax: 10, ipMax: 30 });
    const { id } = await params;
    return json(await claimDelivery(identity, id, { selfCollection: true }));
  } catch (error) {
    return fail(error);
  }
}
