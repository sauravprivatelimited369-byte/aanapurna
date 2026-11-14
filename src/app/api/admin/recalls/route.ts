import { listRecalls } from "@/domain/service";
import { fail, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    return json(await listRecalls(identity));
  } catch (error) {
    return fail(error);
  }
}
