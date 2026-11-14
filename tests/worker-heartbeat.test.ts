import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  WORKER_HEARTBEAT_STALE_SECONDS,
  evaluateWorkerHealth,
  recordWorkerHeartbeat,
  tryRecordWorkerHeartbeat,
} from "@/worker/heartbeat";

function fakePool() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { pool: { query } as unknown as Pool, query };
}

describe("worker heartbeat", () => {
  it("writes one row per service so a restart cannot accumulate rows", async () => {
    const { pool, query } = fakePool();
    await recordWorkerHeartbeat(pool, { event: "started" });
    expect(query).toHaveBeenCalledTimes(1);
    const [statement, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("insert into public.service_health");
    expect(statement).toContain("on conflict (service) do update");
    expect(parameters[0]).toBe("worker");
    const details = JSON.parse(String(parameters[1]));
    expect(details.event).toBe("started");
    expect(typeof details.recordedAt).toBe("string");
  });

  it("swallows a heartbeat failure so the worker keeps draining", async () => {
    const { pool, query } = fakePool();
    query.mockRejectedValueOnce(new Error("connection terminated"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(tryRecordWorkerHeartbeat(pool, { event: "tick" })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports a fresh beat as healthy and an old one as stale", () => {
    const now = new Date("2026-11-14T10:00:00.000Z");
    const fresh = evaluateWorkerHealth({ updated_at: new Date("2026-11-14T09:59:30.000Z"), details: { event: "tick" } }, now);
    expect(fresh).toMatchObject({ status: "ok", ageSeconds: 30, details: { event: "tick" } });

    const stale = evaluateWorkerHealth(
      { updated_at: new Date(now.getTime() - (WORKER_HEARTBEAT_STALE_SECONDS + 60) * 1000), details: {} },
      now,
    );
    expect(stale.status).toBe("stale");
    expect(stale.ageSeconds).toBe(WORKER_HEARTBEAT_STALE_SECONDS + 60);
  });

  it("distinguishes a worker that never ran from one that stopped", () => {
    const health = evaluateWorkerHealth(undefined);
    expect(health).toEqual({ status: "never_seen", ageSeconds: null, details: {} });
  });

  it("accepts a string timestamp from the driver and ignores a malformed one", () => {
    const now = new Date("2026-11-14T10:00:00.000Z");
    expect(evaluateWorkerHealth({ updated_at: "2026-11-14T09:59:00+00:00", details: null }, now).status).toBe("ok");
    expect(evaluateWorkerHealth({ updated_at: "not-a-date", details: { event: "tick" } }, now)).toMatchObject({
      status: "stale",
      ageSeconds: 0,
    });
  });

  it("never reports a negative age when the clock jumps", () => {
    const now = new Date("2026-11-14T10:00:00.000Z");
    const future = evaluateWorkerHealth({ updated_at: new Date("2026-11-14T10:05:00.000Z"), details: {} }, now);
    expect(future.ageSeconds).toBe(0);
    expect(future.status).toBe("ok");
  });
});
