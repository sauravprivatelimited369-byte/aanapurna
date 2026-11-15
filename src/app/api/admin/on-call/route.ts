import { scheduleOnCallShift } from "@/domain/service";
import { onCallShiftSchema } from "@/domain/validation";
import { assertSameOrigin, fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "on-call-shift", userMax: 20, ipMax: 60 });
    const body = await readJson(request, onCallShiftSchema);
    return json(await scheduleOnCallShift(identity, body), 201);
  } catch (error) {
    return fail(error);
  }
}
