import { clearAttestation, recordAttestation } from "@/domain/service";
import { attestationSchema } from "@/domain/validation";
import { assertSameOrigin, fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const withdrawalSchema = z.object({
  key: z.enum(["legal_entity", "insurance", "data_protection_contact", "penetration_test"]),
  reason: z.string().trim().min(20).max(500),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "platform-attestation", userMax: 20, ipMax: 60 });
    const body = await readJson(request, attestationSchema);
    return json(await recordAttestation(identity, body), 201);
  } catch (error) {
    return fail(error);
  }
}

/** Withdrawing a declaration is recorded with a reason; it never deletes the audit trail. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "platform-attestation", userMax: 20, ipMax: 60 });
    const body = await readJson(request, withdrawalSchema);
    return json(await clearAttestation(identity, body.key, body.reason));
  } catch (error) {
    return fail(error);
  }
}
