import { approvePolicy } from "@/domain/service";
import { policyApprovalSchema } from "@/domain/validation";
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
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "policy-approval", userMax: 10, ipMax: 30 });
    const { id } = await params;
    const body = await readJson(request, policyApprovalSchema);
    return json(await approvePolicy(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
