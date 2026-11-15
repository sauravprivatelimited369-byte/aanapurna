import { listAccountRecoveryRequests } from "@/domain/service";
import { fail, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The operations queue for people who are locked out. Staff only; the service re-checks the role. */
export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    return json(await listAccountRecoveryRequests(identity));
  } catch (error) {
    return fail(error);
  }
}
