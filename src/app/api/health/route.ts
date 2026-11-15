import { NextResponse } from "next/server";
import { checkDatabase, pool } from "@/db";
import { getEmailDeliveryStatus } from "@/email/config";
import { pushConfigured } from "@/push/vapid";
import { evaluateReadiness } from "@/domain/readiness";
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

/**
 * Readiness without reading the declarations themselves. The SQL function returns booleans only,
 * because this endpoint is public: it may name the missing requirement, never the policy number.
 */
async function readDeclaredReadiness(): Promise<Record<string, boolean> | null> {
  try {
    // `app_launch_readiness()` returns a table, so it must be expanded. Writing
    // `select app_launch_readiness() as readiness` yields a Postgres *record*, which the driver hands
    // back with numeric keys — the endpoint then reports `{"0": true, "1": false}` and every named
    // requirement disappears. `to_jsonb` gives one object with the column names as keys.
    const { rows } = await pool.query<{ readiness: Record<string, boolean> }>(
      "select to_jsonb(app_launch_readiness()) as readiness",
    );
    return rows[0]?.readiness ?? null;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await checkDatabase();
  const email = getEmailDeliveryStatus();
  const worker = await readWorkerHealth();
  const declared = await readDeclaredReadiness();

  // A missing function means the migration has not run, which is itself an unmet requirement, so
  // readiness reports every owner declaration as absent rather than silently omitting them.
  const readiness = evaluateReadiness({
    now: new Date(),
    declared: declared ?? {},
    attestations: [],
    onCallShifts: [],
    email: {
      configured: email.configured,
      testSink: email.testSink,
      localOnly: email.localOnly,
      missingSettings: email.missingSettings,
    },
    scanner: {
      mode: (process.env.FILE_SCAN_MODE ?? "disabled").trim().toLowerCase(),
      hostConfigured: Boolean(process.env.CLAMAV_HOST?.trim()),
    },
  });

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
    // Whether a person can turn on notifications to their own device. A boolean, deliberately: the
    // subscription key is handed out by the authenticated account API, never by this public page.
    push: { configured: pushConfigured() },
    realOperationsEnabled: process.env.OPERATIONS_ENABLED === "true",
    // Names of unmet requirements only, never their values.
    launchReadiness: {
      complete: readiness.complete,
      missing: readiness.missing,
      unmetOwnerActions: readiness.items
        .filter((item) => !item.satisfied)
        .map((item) => ({ key: item.key, ownerAction: item.ownerAction })),
    },
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
