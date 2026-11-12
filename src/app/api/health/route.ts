import { NextResponse } from "next/server";
import { checkDatabase } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await checkDatabase();
  const smtpConfigured = Boolean(process.env.SMTP_FROM && (process.env.SMTP_URL || process.env.SMTP_HOST));
  const body = {
    status: database.ok ? "ok" : "degraded",
    application: "annapurna-link",
    database: database.ok ? { status: "ok", latencyMs: database.latencyMs } : { status: "unavailable" },
    email: { status: smtpConfigured ? "configured" : "not_configured" },
    realOperationsEnabled: process.env.OPERATIONS_ENABLED === "true",
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
