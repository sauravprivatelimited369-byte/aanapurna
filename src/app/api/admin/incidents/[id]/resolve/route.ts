import { resolveSafetyIncident } from "@/domain/service";
import { incidentResolutionSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "safety-incident-review", userMax: 20, ipMax: 40 });
    const { id } = await params;
    const body = await readJson(request, incidentResolutionSchema);
    return json(await resolveSafetyIncident(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
