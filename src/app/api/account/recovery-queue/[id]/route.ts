import { resolveAccountRecoveryRequest } from "@/domain/service";
import { accountRecoveryResolutionSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

/** Answering a recovery request. The link itself is still issued through the audited recovery flow. */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "account-recovery-review", userMax: 20, ipMax: 40 });
    const { id } = await params;
    const body = await readJson(request, accountRecoveryResolutionSchema);
    return json(await resolveAccountRecoveryRequest(identity, id, body));
  } catch (error) {
    return fail(error);
  }
}
