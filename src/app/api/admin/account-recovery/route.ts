import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { issueAccountRecoveryLink } from "@/domain/service";
import { accountRecoverySchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues the single-use password-reset link for an account and returns it once to
 * an authorised operator. Used when the deployment cannot deliver mail. The
 * service checks the role, the second factor, the reason and writes the audit
 * event; this route only parses input and rate limits.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "account-recovery", userMax: 10, ipMax: 20 });
    const body = await readJson(request, accountRecoverySchema);
    const result = await issueAccountRecoveryLink(identity, body);
    return json(result, result.issued ? 201 : 200);
  } catch (error) {
    return fail(error);
  }
}
