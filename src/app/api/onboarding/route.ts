import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { getOnboarding, requestOnboarding } from "@/domain/service";
import { onboardingSchema } from "@/domain/validation";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    return json(await getOnboarding(identity));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "onboarding", userMax: 5, ipMax: 20 });
    const body = await readJson(request, onboardingSchema);
    return json(await requestOnboarding(identity, body), 201);
  } catch (error) {
    return fail(error);
  }
}
