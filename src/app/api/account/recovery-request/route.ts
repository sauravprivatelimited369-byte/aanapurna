import { fileAccountRecoveryRequest } from "@/domain/service";
import { accountRecoveryRequestSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The locked-out person's way in.
 *
 * Deliberately unauthenticated: somebody who cannot sign in cannot authenticate. The protection is
 * that the response carries no information about whether the address is registered, the rate limit
 * is keyed on both address and IP, and the request only enters a queue a human reviews. The route
 * never issues a token and never resets anything by itself.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    // No session exists to key on, so the limit is per-address and deliberately tight: a burst of
    // recovery requests from one address is not a person, it is a probe. The limiter HMACs the
    // address before it is stored.
    await enforceRateLimit({
      bucket: "mutation:account-recovery-intake:ip",
      subject: getRequestAddressKey(request),
      max: 5,
      windowSeconds: 60,
    });
    const body = await readJson(request, accountRecoveryRequestSchema);
    await enforceRateLimit({ bucket: "mutation:account-recovery-intake:email", subject: body.email, max: 3, windowSeconds: 3600 });
    return json(await fileAccountRecoveryRequest(body), 201);
  } catch (error) {
    return fail(error);
  }
}
