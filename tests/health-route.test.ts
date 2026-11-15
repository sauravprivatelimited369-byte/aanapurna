import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the public health page says about delivery.
 *
 * On the deployment with no worker, mail and device notifications are sent by the request that queued
 * them, once it has answered, with a scheduled call as the second chance. For days that schedule fired
 * hours apart and this page had nothing to say about it: it reported a worker that had never run,
 * which was true and told nobody that verification emails were arriving after their links expired.
 */

const world = vi.hoisted(() => ({
  rows: [] as { service: string; updated_at: Date | string; details?: unknown }[],
  healthTableBroken: false,
  statements: [] as string[],
}));

vi.mock("@/db", () => ({
  checkDatabase: async () => ({ ok: true, latencyMs: 3 }),
  pool: {
    query: async (text: string, parameters: unknown[] = []) => {
      world.statements.push(text);
      if (text.includes("service_health")) {
        if (world.healthTableBroken) throw new Error("relation does not exist");
        const wanted = parameters[0];
        const keys = Array.isArray(wanted) ? wanted : [wanted];
        return { rows: world.rows.filter((row) => keys.includes(row.service)) };
      }
      return { rows: [{ readiness: {} }] };
    },
  },
}));
vi.mock("@/email/config", () => ({
  getEmailDeliveryStatus: () => ({ configured: true, testSink: false, localOnly: false, missingSettings: [] }),
}));

import { GET } from "@/app/api/health/route";

type Body = {
  status: string;
  worker: { status: string };
  delivery: { afterResponse: { status: string; ageSeconds: number | null }; scheduledDrain: { status: string; ageSeconds: number | null } };
};
const health = async () => (await (await GET()).json()) as Body;
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

beforeEach(() => {
  world.rows.length = 0;
  world.statements.length = 0;
  world.healthTableBroken = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the health page says when delivery last ran", () => {
  it("reports both senders as never seen on a deployment where neither has run", async () => {
    const body = await health();
    expect(body.delivery).toEqual({
      afterResponse: { status: "never_seen", ageSeconds: null },
      scheduledDrain: { status: "never_seen", ageSeconds: null },
    });
    // Not a failure of the web application: the page still says the application is up.
    expect(body.status).toBe("ok");
  });

  it("reports how long ago each ran", async () => {
    world.rows.push(
      { service: "after-response-delivery", updated_at: ago(12) },
      { service: "scheduled-drain", updated_at: ago(25_200) },
    );
    const { delivery } = await health();
    expect(delivery.afterResponse.status).toBe("seen");
    expect(delivery.afterResponse.ageSeconds).toBeGreaterThanOrEqual(11);
    expect(delivery.afterResponse.ageSeconds).toBeLessThanOrEqual(14);
    // Seven hours between scheduled calls is what was actually happening. It is now a number on a
    // page anybody can open, instead of something inferred from when an email turned up.
    expect(delivery.scheduledDrain.status).toBe("seen");
    expect(delivery.scheduledDrain.ageSeconds).toBeGreaterThanOrEqual(25_199);
    expect(delivery.scheduledDrain.ageSeconds).toBeLessThanOrEqual(25_203);
  });

  it("keeps the worker's heartbeat separate: a deployment with no worker is not thereby undelivered", async () => {
    world.rows.push({ service: "after-response-delivery", updated_at: ago(5) });
    const body = await health();
    expect(body.worker.status).toBe("never_seen");
    expect(body.delivery.afterResponse.status).toBe("seen");

    world.rows.length = 0;
    world.rows.push({ service: "worker", updated_at: ago(5), details: { event: "tick" } });
    const withWorker = await health();
    expect(withWorker.worker.status).toBe("ok");
    expect(withWorker.delivery.afterResponse.status).toBe("never_seen");
  });

  it("publishes ages and nothing else from those rows", async () => {
    world.rows.push(
      { service: "after-response-delivery", updated_at: ago(3), details: { mailSent: 7, pushDelivered: 2 } },
      { service: "scheduled-drain", updated_at: ago(40), details: { mailSent: 1 } },
    );
    const response = await GET();
    const text = await response.text();
    const { delivery } = JSON.parse(text) as Body;
    expect(Object.keys(delivery).sort()).toEqual(["afterResponse", "scheduledDrain"]);
    expect(Object.keys(delivery.afterResponse).sort()).toEqual(["ageSeconds", "status"]);
    expect(Object.keys(delivery.scheduledDrain).sort()).toEqual(["ageSeconds", "status"]);
    // How much mail a deployment sends is not this page's to publish.
    expect(text).not.toContain("mailSent");
    expect(text).not.toContain("pushDelivered");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("still answers when that table cannot be read", async () => {
    world.healthTableBroken = true;
    const body = await health();
    expect(body.status).toBe("ok");
    expect(body.delivery.afterResponse).toEqual({ status: "never_seen", ageSeconds: null });
    expect(body.delivery.scheduledDrain).toEqual({ status: "never_seen", ageSeconds: null });
  });
});
