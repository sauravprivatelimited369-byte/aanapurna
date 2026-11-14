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
      // A capture service accepts SMTP traffic but delivers to a test inbox, so
      // it is reported separately and never as production-ready email.
      status: !email.configured ? "not_configured" : email.testSink || email.localOnly ? "test_sink" : "configured",
      localTestSink: email.localOnly,
      captureTestSink: email.testSink,
      missingSettings: email.missingSettings,
    },
    realOperationsEnabled: process.env.OPERATIONS_ENABLED === "true",
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
