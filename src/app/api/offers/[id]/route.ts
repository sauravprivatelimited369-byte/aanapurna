import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { getOfferDetail, respondToOffer } from "@/domain/service";
import { offerResponseSchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    return json(await getOfferDetail(identity, id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "offer-response", userMax: 20, ipMax: 80 });
    const { id } = await params;
    const body = await readJson(request, offerResponseSchema);
    return json(await respondToOffer(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
