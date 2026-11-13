import { NextResponse } from "next/server";
import { pool } from "@/db";
import { PublicImpactResponseSchema } from "@/integrations/public-impact-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImpactRow = {
  verified_servings: string | number;
  verified_deliveries: string | number;
  verified_organizations: string | number;
  active_helpers: string | number;
  verified_generators: string | number;
};

function count(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Invalid aggregate impact result.");
  return parsed;
}

export async function GET() {
  try {
    const result = await pool.query<ImpactRow>("SELECT * FROM public.app_public_impact()");
    const row = result.rows[0];
    if (!row) throw new Error("Impact aggregate unavailable.");

    const metrics = {
      verifiedServings: count(row.verified_servings),
      verifiedDeliveries: count(row.verified_deliveries),
      verifiedOrganizations: count(row.verified_organizations),
      activeHelpers: count(row.active_helpers),
      verifiedGenerators: count(row.verified_generators),
    };
    const hasActivity = Object.values(metrics).some((value) => value > 0);
    const response = PublicImpactResponseSchema.parse({ status: hasActivity ? "available" : "empty", metrics });
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ status: "unavailable", message: "Verified impact is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
