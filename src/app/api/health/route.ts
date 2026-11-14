import { NextResponse } from "next/server";
import { checkDatabase } from "@/db";
import { getEmailDeliveryStatus } from "@/email/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await checkDatabase();
  const email = getEmailDeliveryStatus();
  const body = {
    status: database.ok ? "ok" : "degraded",
    application: "annapurna-link",
    database: database.ok ? { status: "ok", latencyMs: database.latencyMs } : { status: "unavailable" },
    // Only setting NAMES are reported; no SMTP credential or URL is exposed.
    email: {
      status: email.configured ? "configured" : "not_configured",
      localTestSink: email.localOnly,
      missingSettings: email.missingSettings,
    },
    realOperationsEnabled: process.env.OPERATIONS_ENABLED === "true",
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
