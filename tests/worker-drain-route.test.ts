import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduled drain, as the scheduler calls it.
 *
 * On the hosted deployment this route is the only thing that runs the escalation sweeps, and so the
 * only sender for the notifications they write: an unclaimed delivery, a lapsing declaration. It used
 * to drain mail and run the sweeps and stop there, so those notifications reached the list and nobody's
 * phone.
 */

const world = vi.hoisted(() => ({
  order: [] as string[],
  drainMail: vi.fn(),
  escalation: vi.fn(),
  readiness: vi.fn(),
  drainPush: vi.fn(),
  askForPassAfterResponse: vi.fn(),
  queries: [] as { text: string; parameters: unknown[] }[],
  poolsClosed: 0,
}));

vi.mock("pg", () => ({
  Pool: class {
    async query(text: string, parameters: unknown[] = []) {
      world.queries.push({ text, parameters });
      world.order.push("recorded");
      return { rows: [] };
    }
    async end() { world.poolsClosed += 1; }
  },
}));
vi.mock("@/worker/inline-delivery", () => ({ requestInlineDelivery: world.askForPassAfterResponse }));
vi.mock("@/worker/github-oidc", () => ({ verifyGithubOidcToken: vi.fn(), fetchGithubJwks: vi.fn() }));
vi.mock("@/worker/outbox-drain", () => ({ drainEmailOutboxOnce: world.drainMail }));
vi.mock("@/worker/escalation", () => ({ runEscalationSweep: world.escalation, runReadinessSweep: world.readiness }));
vi.mock("@/worker/push-drain", () => ({ drainPushOnce: world.drainPush }));

import { POST } from "@/app/api/worker/drain/route";

const TOKEN = "operator-trigger-token-0123456789abcdef";
const scheduled = () => POST(new Request("https://annapurna.test/api/worker/drain", {
  method: "POST",
  headers: { authorization: `Bearer ${TOKEN}` },
}));

beforeEach(() => {
  world.order.length = 0;
  world.queries.length = 0;
  world.poolsClosed = 0;
  world.askForPassAfterResponse.mockReset().mockImplementation(() => {
    world.order.push("asked for a pass after the response");
    return true;
  });
  world.drainMail.mockReset().mockImplementation(async () => {
    world.order.push("mail");
    return { delivered: true, reserved: 1, sent: 1, failed: 0 };
  });
  world.escalation.mockReset().mockImplementation(async () => {
    world.order.push("escalation sweep");
    return { unclaimedJobs: 1, expiringDocuments: 0 };
  });
  world.readiness.mockReset().mockImplementation(async () => {
    world.order.push("readiness sweep");
    return { expiringDeclarations: 0, coverageGaps: 1 };
  });
  world.drainPush.mockReset().mockImplementation(async () => {
    world.order.push("push");
    return { configured: true, considered: 2, delivered: 1, failed: 0, revoked: 0, deferred: 0 };
  });
  vi.stubEnv("WORKER_TRIGGER_TOKEN", TOKEN);
  vi.stubEnv("WORKER_DATABASE_URL", "postgres://annapurna_worker:not-a-real-password@db.example.test:5432/annapurna_link");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the scheduled drain sends what its own sweeps wrote", () => {
  it("pushes after the sweeps, so the notifications they just wrote are in the same pass", async () => {
    const response = await scheduled();
    expect(response.status).toBe(200);
    expect(world.order.slice(0, 4)).toEqual(["mail", "escalation sweep", "readiness sweep", "push"]);
    const body = await response.json() as Record<string, unknown>;
    expect(body.push).toEqual({ status: "ok", configured: true, considered: 2, delivered: 1, failed: 0, revoked: 0, deferred: 0 });
    // Counts only. Nothing here may name a person, an address or a device.
    expect(Object.keys(body).sort()).toEqual([
      "delivered", "escalation", "failed", "push", "readiness", "reserved", "schedule", "sent", "status", "via",
    ]);
    expect(world.poolsClosed).toBe(1);
  });

  it("bounds the push pass so a stalled push service cannot run out this route's clock", async () => {
    await scheduled();
    const [, options] = world.drainPush.mock.calls[0]! as [unknown, { budgetMs: number; requestTimeoutMs: number; retryDelayMs: number }];
    // Started no later than the budget; then a timeout, a pause and one more timeout.
    expect(options.budgetMs + options.requestTimeoutMs * 2 + options.retryDelayMs).toBeLessThan(20_000);
  });

  it("reports a push failure by itself, without making the mail drain look failed", async () => {
    world.drainPush.mockRejectedValueOnce(new Error("worker role cannot reach the database"));
    const response = await scheduled();
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", sent: 1, push: { status: "error" } });
    expect(world.poolsClosed).toBe(1);
  });

  it("does none of it for a caller that is not the scheduler", async () => {
    const response = await POST(new Request("https://annapurna.test/api/worker/drain", {
      method: "POST",
      headers: { authorization: "Bearer not-the-token-not-the-token-not-the-token" },
    }));
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(world.order).toEqual([]);
  });
});

describe("the scheduled drain leaves a trace a person can look at", () => {
  /**
   * The schedule that calls this route fired hours apart for days. Nothing showed it: the route
   * answered 200 whenever it was reached, and the only symptom was mail arriving after its link had
   * expired. `/api/health` now reports when a scheduler last got here, from the row written below.
   */
  it("records that a scheduler reached it, with counts only", async () => {
    await scheduled();
    expect(world.queries).toHaveLength(1);
    const [{ text, parameters }] = world.queries;
    expect(text).toContain("insert into public.service_health");
    expect(text).toContain("on conflict (service) do update");
    expect(parameters[0]).toBe("scheduled-drain");
    // The row is read by a public endpoint. Numbers, and nothing that could name anybody.
    const details = JSON.parse(String(parameters[1])) as Record<string, unknown>;
    expect(details).toEqual({ mailSent: 1, mailFailed: 0, pushDelivered: 1, pushFailed: 0 });
  });

  it("then asks for one more pass once it has answered, as every other request does", async () => {
    await scheduled();
    // Last, after its own work: what that pass exists to pick up is whatever the bounded passes
    // left. It is also what shows, on every scheduled call, that this host still runs work after a
    // response - the thing delivery depends on between two calls.
    expect(world.order).toEqual([
      "mail", "escalation sweep", "readiness sweep", "push", "recorded", "asked for a pass after the response",
    ]);
    expect(world.askForPassAfterResponse).toHaveBeenCalledTimes(1);
  });

  it("still answers when the trace cannot be written", async () => {
    const write = vi.spyOn((await import("pg")).Pool.prototype, "query").mockRejectedValueOnce(new Error("read-only transaction") as never);
    const response = await scheduled();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", sent: 1 });
    expect(world.askForPassAfterResponse).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });

  it("records nothing and asks for nothing when the caller is not the scheduler", async () => {
    await POST(new Request("https://annapurna.test/api/worker/drain", { method: "POST" }));
    expect(world.queries).toEqual([]);
    expect(world.askForPassAfterResponse).not.toHaveBeenCalled();
  });
});
