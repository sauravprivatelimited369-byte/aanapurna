import { recordOrganizationInsurance } from "@/domain/service";
import { organizationInsuranceSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

/** An organisation declares its own cover. A declaration with an expiry, not a certificate. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "organization-insurance", userMax: 10, ipMax: 30 });
    const { id } = await params;
    const body = await readJson(request, organizationInsuranceSchema);
    return json(await recordOrganizationInsurance(identity, id, body), 201);
  } catch (error) {
    return fail(error);
  }
}
