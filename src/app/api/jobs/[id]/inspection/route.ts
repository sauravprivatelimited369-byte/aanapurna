import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { confirmDeliveryInspection } from "@/domain/service";
import { inspectionSchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "delivery-inspection", userMax: 20, ipMax: 60 });
    const body = await readJson(request, inspectionSchema);
    return json(await confirmDeliveryInspection(identity, (await params).id, body));
  } catch (error) { return fail(error); }
}
