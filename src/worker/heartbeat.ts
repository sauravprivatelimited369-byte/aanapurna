import type { Pool } from "pg";

/**
 * The worker records its own liveness in `public.service_health`.
 *
 * Before this existed, the browser could not tell a running worker from a dead
 * one: `/api/health` reported the database and email configuration only, and
 * queued notifications could sit in the outbox with nothing draining them. The
 * heartbeat is written by the worker process itself, so a stale row means the
 * process stopped rather than that a scheduler *said* it was fine.
 */
export const WORKER_SERVICE_KEY = "worker";

/** A heartbeat older than this is reported as stale, not healthy. */
export const WORKER_HEARTBEAT_STALE_SECONDS = 180;

export type WorkerHeartbeatDetails = {
  event: "started" | "tick" | "stopping" | "stopped";
  processed?: number;
  failed?: number;
  lastError?: string | null;
};

export type WorkerHealth =
  | { status: "ok"; ageSeconds: number; details: Record<string, unknown> }
  | { status: "stale"; ageSeconds: number; details: Record<string, unknown> }
  | { status: "never_seen"; ageSeconds: null; details: Record<string, never> };

export async function recordWorkerHeartbeat(pool: Pool, details: WorkerHeartbeatDetails): Promise<void> {
  await pool.query(
    `insert into public.service_health (service, status, details, updated_at)
     values ($1, 'ok', $2::jsonb, now())
     on conflict (service) do update
       set status = excluded.status, details = excluded.details, updated_at = now()`,
    [WORKER_SERVICE_KEY, JSON.stringify({ ...details, recordedAt: new Date().toISOString() })],
  );
}

/** Best effort: a heartbeat failure must never take the worker down. */
export async function tryRecordWorkerHeartbeat(pool: Pool, details: WorkerHeartbeatDetails): Promise<void> {
  try {
    await recordWorkerHeartbeat(pool, details);
  } catch (error) {
    console.error(JSON.stringify({
      level: "warn",
      event: "worker.heartbeat_failed",
      message: error instanceof Error ? error.message : "unknown",
    }));
  }
}

export function evaluateWorkerHealth(
  row: { updated_at: Date | string; details: unknown } | undefined,
  now: Date = new Date(),
): WorkerHealth {
  if (!row) return { status: "never_seen", ageSeconds: null, details: {} };
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  const updatedMs = updatedAt.getTime();
  if (Number.isNaN(updatedMs)) return { status: "stale", ageSeconds: 0, details: {} };
  const ageSeconds = Math.max(0, Math.round((now.getTime() - updatedMs) / 1000));
  const details = (row.details && typeof row.details === "object" ? row.details : {}) as Record<string, unknown>;
  return { status: ageSeconds > WORKER_HEARTBEAT_STALE_SECONDS ? "stale" : "ok", ageSeconds, details };
}
