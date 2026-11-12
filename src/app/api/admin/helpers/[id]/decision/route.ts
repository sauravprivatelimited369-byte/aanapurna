import { decideHelper } from "@/domain/service";
import { helperDecisionSchema } from "@/domain/validation";
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
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "helper-review", userMax: 30, ipMax: 60 });
    const { id } = await params;
    const body = await readJson(request, helperDecisionSchema);
    return json(await decideHelper(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
