import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { reportDeliveryIncident } from "@/domain/service";
import { incidentSchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "safety-incident", userMax: 10, ipMax: 30 });
    const { id } = await params;
    const body = await readJson(request, incidentSchema);
    return json(await reportDeliveryIncident(identity, id, body), 201);
  } catch (error) {
    return fail(error);
  }
}
