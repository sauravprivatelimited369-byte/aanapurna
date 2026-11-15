import { acceptPartnerAgreement, getAgreementState } from "@/domain/service";
import { agreementAcceptanceSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    return json(await getAgreementState(identity, id));
  } catch (error) {
    return fail(error);
  }
}

/**
 * Accept the responsibility agreement for an organisation.
 *
 * The service refuses a version that is not the one currently published, so a stale tab cannot
 * accept superseded wording, and the acceptance is stored with the hash of exactly what was shown.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "organization-agreement", userMax: 10, ipMax: 30 });
    const { id } = await params;
    const body = await readJson(request, agreementAcceptanceSchema);
    return json(await acceptPartnerAgreement(identity, id, body), 201);
  } catch (error) {
    return fail(error);
  }
}
