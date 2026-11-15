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

/**
 * Two more rows in the same table, for a deployment that runs no worker.
 *
 * There, mail and device notifications are sent by the request that queued them, once it has
 * answered (`@/worker/inline-delivery`), and a scheduler calls `/api/worker/drain` as the second
 * chance. Neither left a trace anybody could look at. The schedule fired hours apart for days, and
 * the only sign was a verification email that arrived after its link had expired.
 *
 * Each now records when it last ran. Read together they say which half has stopped: a drain that is
 * recent beside an after-response pass that is not means the host no longer runs work after a
 * response, because every drain asks for one.
 */
export const AFTER_RESPONSE_DELIVERY_KEY = "after-response-delivery";
export const SCHEDULED_DRAIN_KEY = "scheduled-drain";

export type DeliverySightingKey = typeof AFTER_RESPONSE_DELIVERY_KEY | typeof SCHEDULED_DRAIN_KEY;

export type DeliverySighting =
  | { status: "seen"; ageSeconds: number }
  | { status: "never_seen"; ageSeconds: null };

/**
 * Best effort, and counts only: the row is read by the public health endpoint, and a failure to
 * write it must never be the reason a message was not sent.
 */
export async function tryRecordDeliverySighting(
  pool: Pool,
  service: DeliverySightingKey,
  counts: Record<string, number | null>,
): Promise<void> {
  try {
    await pool.query(
      `insert into public.service_health (service, status, details, updated_at)
       values ($1, 'ok', $2::jsonb, now())
       on conflict (service) do update
         set status = excluded.status, details = excluded.details, updated_at = now()`,
      [service, JSON.stringify(counts)],
    );
  } catch (error) {
    console.error(JSON.stringify({
      level: "warn",
      event: "delivery.sighting_failed",
      service,
      message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    }));
  }
}

/**
 * No "stale" here, deliberately. On a quiet site nobody queues anything for days, and an old
 * after-response pass is then the truth rather than a fault; how old is too old depends on the
 * schedule and on the traffic, which the reader knows and this function does not.
 */
export function evaluateDeliverySighting(
  row: { updated_at: Date | string } | undefined,
  now: Date = new Date(),
): DeliverySighting {
  if (!row) return { status: "never_seen", ageSeconds: null };
  const updatedMs = (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).getTime();
  if (Number.isNaN(updatedMs)) return { status: "never_seen", ageSeconds: null };
  return { status: "seen", ageSeconds: Math.max(0, Math.round((now.getTime() - updatedMs) / 1000)) };
}
