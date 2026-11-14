import { NextResponse } from "next/server";
import { checkDatabase, pool } from "@/db";
import { getEmailDeliveryStatus } from "@/email/config";
import { evaluateWorkerHealth, WORKER_SERVICE_KEY, type WorkerHealth } from "@/worker/heartbeat";

/**
 * Read the worker's own heartbeat. A hosted deployment that runs no worker is
 * reported as `never_seen`, which is the truth rather than an error.
 */
async function readWorkerHealth(): Promise<WorkerHealth> {
  try {
    const { rows } = await pool.query(
      "select updated_at, details from public.service_health where service = $1 limit 1",
      [WORKER_SERVICE_KEY],
    );
    return evaluateWorkerHealth(rows[0]);
  } catch {
    return { status: "never_seen", ageSeconds: null, details: {} };
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await checkDatabase();
  const email = getEmailDeliveryStatus();
  const worker = await readWorkerHealth();
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
    worker: {
      status: worker.status,
      // A worker that has never beaten is a configuration fact, not a failure of
      // the web application, so it does not change the top-level status.
      ageSeconds: worker.ageSeconds,
      lastEvent: typeof worker.details.event === "string" ? worker.details.event : null,
      lastError: typeof worker.details.lastError === "string" ? worker.details.lastError : null,
    },
    realOperationsEnabled: process.env.OPERATIONS_ENABLED === "true",
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
