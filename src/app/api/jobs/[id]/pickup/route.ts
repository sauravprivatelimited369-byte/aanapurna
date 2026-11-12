import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { confirmPickup } from "@/domain/service";
import { pickupSchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "delivery-pickup", userMax: 20, ipMax: 60 });
    const { id } = await params;
    const body = await readJson(request, pickupSchema);
    return json(await confirmPickup(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
