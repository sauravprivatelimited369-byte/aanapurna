import { createPolicyDraft, listPolicyVersions } from "@/domain/service";
import { policyDraftSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    return json(await listPolicyVersions(identity));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "policy-draft", userMax: 10, ipMax: 30 });
    const body = await readJson(request, policyDraftSchema);
    return json(await createPolicyDraft(identity, body), 201);
  } catch (error) {
    return fail(error);
  }
}
