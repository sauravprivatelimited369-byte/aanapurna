import { releaseRetentionHold } from "@/domain/retention";
import { retentionHoldReleaseSchema } from "@/domain/validation";
import { assertSameOrigin, fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Releasing is the only way to end a hold. The row and its reason stay readable afterwards. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "retention-hold-release", userMax: 20, ipMax: 60 });
    const { id } = await context.params;
    const body = await readJson(request, retentionHoldReleaseSchema);
    return json(await releaseRetentionHold(identity, id, body.reason));
  } catch (error) {
    return fail(error);
  }
}
