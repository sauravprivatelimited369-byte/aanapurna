import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { createDonation, listDonations } from "@/domain/service";
import { donationCreateSchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    return json(await listDonations(identity));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "donation-create", userMax: 10, ipMax: 40 });
    const body = await readJson(request, donationCreateSchema);
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    return json(await createDonation(identity, body, requestId), 201);
  } catch (error) {
    return fail(error);
  }
}
