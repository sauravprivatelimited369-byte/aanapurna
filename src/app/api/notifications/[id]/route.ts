import { fail, assertSameOrigin, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { markNotificationRead } from "@/domain/service";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "notification-read", userMax: 60, ipMax: 120 });
    const { id } = await params;
    return json(await markNotificationRead(identity, id));
  } catch (error) {
    return fail(error);
  }
}
