import { fail, assertSameOrigin, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { claimDelivery } from "@/domain/service";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "delivery-claim", userMax: 20, ipMax: 60 });
    const { id } = await params;
    return json(await claimDelivery(identity, id));
  } catch (error) {
    return fail(error);
  }
}
