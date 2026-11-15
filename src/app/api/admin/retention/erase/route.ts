import { erasePerson } from "@/domain/retention";
import { erasureSchema } from "@/domain/validation";
import { assertSameOrigin, fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fulfil an erasure request. This overwrites the person's identifying columns and destroys their
 * credentials; it does not delete the receipts or the audit trail that answer for what happened.
 * Security administrators only, because it is irreversible.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "retention-erase", userMax: 5, ipMax: 15 });
    const body = await readJson(request, erasureSchema);
    return json(await erasePerson(identity, body.userId, body.reason));
  } catch (error) {
    return fail(error);
  }
}
