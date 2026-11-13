import { NextResponse } from "next/server";
import {
  RestaurantDirectoryResponseSchema,
} from "@/integrations/restaurant-directory-contract";
import { getHallaBowlDirectoryListing, HALLA_BOWL_LAST_KNOWN } from "@/integrations/indiarestros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  try {
    const listing = await getHallaBowlDirectoryListing();
    const response = RestaurantDirectoryResponseSchema.parse({ status: "live", listing });
    return NextResponse.json(response, { headers });
  } catch {
    // The last-seen record is real, sourced directory data—not a partner approval or a live verification.
    const response = RestaurantDirectoryResponseSchema.parse({
      status: "snapshot",
      listing: HALLA_BOWL_LAST_KNOWN,
      snapshotCapturedOn: "2026-11-12",
      warning: "The live directory lookup is unavailable. This saved public-directory record was captured on 12 November 2026; IndiaRestros lists its last update as 25 October 2026. Details may have changed.",
    });
    return NextResponse.json(response, { headers });
  }
}
