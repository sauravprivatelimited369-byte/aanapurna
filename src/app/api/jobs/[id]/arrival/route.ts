import { fail, assertSameOrigin, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { confirmDeliveryArrival } from "@/domain/service";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "delivery-arrival", userMax: 20, ipMax: 60 });
    return json(await confirmDeliveryArrival(identity, (await params).id));
  } catch (error) { return fail(error); }
}
