import { getRetentionStatus, runRetentionSweep, updateRetentionSettings } from "@/domain/retention";
import { retentionRunSchema, retentionSettingsSchema } from "@/domain/validation";
import { assertSameOrigin, fail, json, readJson } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current windows, the active hold count and the last few sweeps. */
export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    return json(await getRetentionStatus(identity));
  } catch (error) {
    return fail(error);
  }
}

/** Change a window. Recorded against the person who changed it. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "retention-settings", userMax: 20, ipMax: 60 });
    const body = await readJson(request, retentionSettingsSchema);
    return json(await updateRetentionSettings(identity, body));
  } catch (error) {
    return fail(error);
  }
}

/** Run the sweep. `dryRun: true` reports counts and changes nothing. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "retention-run", userMax: 6, ipMax: 20 });
    const body = await readJson(request, retentionRunSchema);
    return json(await runRetentionSweep(identity, { dryRun: body.dryRun }));
  } catch (error) {
    return fail(error);
  }
}
