import { listDirectoryPlaces, updateDirectoryPlace } from "@/domain/service";
import { directoryPlaceUpdateSchema } from "@/domain/validation";
import { fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { assertSameOrigin } from "@/lib/http";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    return json(await listDirectoryPlaces(identity));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "directory-place", userMax: 60, ipMax: 120 });
    const body = await readJson(request, directoryPlaceUpdateSchema);
    return json(await updateDirectoryPlace(identity, body));
  } catch (error) {
    return fail(error);
  }
}
