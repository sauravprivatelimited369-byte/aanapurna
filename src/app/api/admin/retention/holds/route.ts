import { listRetentionHolds, placeRetentionHold } from "@/domain/retention";
import { retentionHoldSchema } from "@/domain/validation";
import { assertSameOrigin, fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    const includeReleased = new URL(request.url).searchParams.get("released") === "true";
    return json({ holds: await listRetentionHolds(identity, { includeReleased }) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "retention-hold", userMax: 20, ipMax: 60 });
    const body = await readJson(request, retentionHoldSchema);
    return json(await placeRetentionHold(identity, body), 201);
  } catch (error) {
    return fail(error);
  }
}
