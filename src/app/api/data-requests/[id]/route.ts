import { updateDataRequest } from "@/domain/service";
import { dataRequestUpdateSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "privacy-data-request-review", userMax: 20, ipMax: 40 });
    const { id } = await params;
    const body = await readJson(request, dataRequestUpdateSchema);
    return json(await updateDataRequest(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
