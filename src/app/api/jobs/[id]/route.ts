import { fail, json } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { getDeliveryDetail } from "@/domain/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const identity = await requireIdentity(request.headers);
    const { id } = await params;
    return json(await getDeliveryDetail(identity, id));
  } catch (error) {
    return fail(error);
  }
}
