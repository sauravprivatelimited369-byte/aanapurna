import { correctMyProfile } from "@/domain/service";
import { displayNameSchema } from "@/domain/validation";
import { assertSameOrigin, fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Correcting a display name is the one field a person owns outright. Every change is audited. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "account-display-name", userMax: 10, ipMax: 30 });
    const body = await readJson(request, displayNameSchema);
    return json(await correctMyProfile(identity, body));
  } catch (error) {
    return fail(error);
  }
}
