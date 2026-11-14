import "server-only";
import { Pool } from "pg";
import { run } from "graphile-worker";
import { databaseConnectionTimeoutMillis, databaseSslOptions, databaseUrl } from "../lib/database-config";
import { drainEmailOutboxOnce } from "./outbox-drain";
import { tryRecordWorkerHeartbeat } from "./heartbeat";

// The delivery logic lives in ./outbox-drain so the same code can be driven by
// this long-lived process or by a short-lived hosted scheduler invocation.
const workerDatabaseUrl = databaseUrl("WORKER_DATABASE_URL");
if (!workerDatabaseUrl) throw new Error("WORKER_DATABASE_URL is required to run the background worker.");
if (process.env.NODE_ENV === "production" && !process.env.APP_URL) {
  throw new Error("APP_URL is required in production so action links can be origin-checked.");
}
const pool = new Pool({
  connectionString: workerDatabaseUrl,
  max: 4,
  connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
  idleTimeoutMillis: 30_000,
  application_name: "annapurna-link-worker",
  ssl: databaseSslOptions(workerDatabaseUrl),
});

let stopping = false;
let poolClosed = false;

function logDatabaseError(event: string, error: unknown): void {
  console.error(JSON.stringify({
    level: "error",
    event,
    message: error instanceof Error ? error.message : "unknown",
  }));
}

// A dropped PostgreSQL connection can otherwise surface as an unhandled
// `error` event and crash the whole worker. Share one guarded pool with
// Graphile Worker; it installs no duplicate handlers when these are present.
pool.on("error", (error) => logDatabaseError("worker.database_pool_idle_error", error));
pool.on("connect", (client) => {
  client.on("error", (error) => logDatabaseError("worker.database_client_error", error));
});

async function closePool(): Promise<void> {
  if (poolClosed) return;
  poolClosed = true;
  await pool.end().catch(() => undefined);
}

async function startWorker() {
  const runner = await run({
    pgPool: pool,
    schema: "graphile_worker",
    concurrency: 2,
    pollInterval: 1_000,
    noHandleSignals: true,
    taskList: {
      "drain-email-outbox": async () => {
        try {
          const result = await drainEmailOutboxOnce(pool);
          await tryRecordWorkerHeartbeat(pool, {
            event: "tick",
            processed: result.sent,
            failed: result.failed,
            lastError: null,
          });
        } catch (error) {
          // Record the failure, then re-throw so Graphile Worker applies its own
          // bounded retry policy instead of the job disappearing silently.
          await tryRecordWorkerHeartbeat(pool, {
            event: "tick",
            lastError: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          });
          throw error;
        }
      },
    },
    crontab: "* * * * * drain-email-outbox",
  });

  // The cron job runs once a minute and not at all when the queue is quiet, so
  // beat independently: otherwise an idle worker looks identical to a dead one.
  await tryRecordWorkerHeartbeat(pool, { event: "started" });
  const heartbeatTimer = setInterval(() => {
    void tryRecordWorkerHeartbeat(pool, { event: "tick" });
  }, 30_000);
  heartbeatTimer.unref();

  runner.promise.catch(async (error: unknown) => {
    if (stopping) return;
    console.error(JSON.stringify({ level: "error", event: "worker.stopped_unexpectedly", message: error instanceof Error ? error.message : "unknown" }));
    await closePool();
    process.exitCode = 1;
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      stopping = true;
      clearInterval(heartbeatTimer);
      void tryRecordWorkerHeartbeat(pool, { event: "stopping" })
        .then(() => runner.stop(signal))
        .then(closePool)
        .catch(async () => {
          await closePool();
          process.exitCode = 1;
        });
    });
  }
}

void startWorker().catch(async (error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "worker.startup_failed", message: error instanceof Error ? error.message : "unknown" }));
  await closePool();
  process.exitCode = 1;
});
