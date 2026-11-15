import { exportMyData } from "@/domain/service";
import { fail, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The data export a person is entitled to.
 *
 * Deliberately not a page that renders the data: it returns a downloadable document, because the
 * access right is about receiving the data, not about being shown a screen. The read is logged as a
 * disclosure every time, so a person's own access is visible in the trail alongside everyone else's.
 */
export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    // A person has the right to their data whenever they ask; the limit here is only against a loop,
    // not against the request itself.
    await enforceRateLimit({ bucket: "account-export", subject: getRequestAddressKey(request), max: 10, windowSeconds: 3600 });
    const { document, filename, generatedAt } = await exportMyData(identity);
    return json({ document, filename, generatedAt });
  } catch (error) {
    return fail(error);
  }
}
