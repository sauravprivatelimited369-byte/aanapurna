import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who sends a message once it has been queued.
 *
 * The outbox row is the durable part and has always been right. What was wrong was the step after it:
 * the only thing done was to queue a job for a long-lived worker, and the hosted deployment has no
 * such worker. Every job sat unconsumed, the person signing up waited on the round trips it took to put
 * it there, and the verification email left hours later - after its one-hour link had expired.
 */

const world = vi.hoisted(() => ({
  stored: [] as Record<string, unknown>[],
  /** What happened, in the order it happened. */
  events: [] as string[],
  canSendMailHere: true,
  insideRequest: true,
  workerUnavailable: false,
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: async (row: Record<string, unknown>) => { world.stored.push(row); world.events.push("stored"); },
    }),
  },
}));
vi.mock("@/security/crypto", () => ({ encryptValue: (value: string) => `encrypted(${value.length})` }));
vi.mock("@/worker/inline-delivery", () => ({
  canSendMailHere: () => world.canSendMailHere,
  requestInlineDelivery: () => {
    if (!world.insideRequest) return false;
    world.events.push("delivery requested");
    return true;
  },
}));
vi.mock("pg", () => ({ Pool: class { async end() { /* closed */ } } }));
vi.mock("graphile-worker", () => ({
  makeWorkerUtils: async () => {
    if (world.workerUnavailable) throw new Error("connection refused");
    return {
      addJob: async (name: string) => { world.events.push(`job queued: ${name}`); },
      release: async () => undefined,
    };
  },
}));

import { enqueueAuthEmail, enqueueNotificationEmail } from "@/email/outbox";

beforeEach(() => {
  world.stored.length = 0;
  world.events.length = 0;
  world.canSendMailHere = true;
  world.insideRequest = true;
  world.workerUnavailable = false;
  vi.stubEnv("WORKER_DATABASE_URL", "postgres://annapurna_worker:not-a-real-password@db.example.test:5432/annapurna_link");
  vi.stubEnv("APP_URL", "https://annapurna.example");
});

afterEach(() => vi.unstubAllEnvs());

const verification = () => enqueueAuthEmail("verification", "Person@Example.Test", "https://annapurna.example/api/auth/verify-email?token=t");

describe("a queued message is sent by whoever can send it soonest", () => {
  it("is sent by this process, after the response, when this process can send mail", async () => {
    await verification();
    expect(world.stored).toHaveLength(1);
    expect(world.stored[0]).toMatchObject({ recipient: "person@example.test", kind: "verification" });
    // Stored first, so there is always something to deliver. And no job for a worker that, on the
    // hosted deployment, does not exist: each one used to cost a new database connection inside the
    // request and then sit in the queue for good.
    expect(world.events).toEqual(["stored", "delivery requested"]);
  });

  it("wakes the worker when this process has no mail settings of its own", async () => {
    // A web tier beside a worker that holds the SMTP credentials. Draining here would defer the mail.
    world.canSendMailHere = false;
    await verification();
    expect(world.events).toEqual(["stored", "job queued: drain-email-outbox"]);
  });

  it("wakes the worker when there is no request to wait for", async () => {
    world.insideRequest = false;
    await verification();
    expect(world.events).toEqual(["stored", "job queued: drain-email-outbox"]);
  });

  it("treats a failure to wake anybody as a delay, not as a failure to queue", async () => {
    world.insideRequest = false;
    world.workerUnavailable = true;
    await expect(verification()).resolves.toBeUndefined();
    // Still stored. The scheduled drain is the recovery path.
    expect(world.events).toEqual(["stored"]);
  });

  it("takes the same path for the email that accompanies a notification", async () => {
    await enqueueNotificationEmail("member@example.test", "A Receiver accepted your offer", "Rice and dal is reserved.", "/app/offers");
    expect(world.stored[0]).toMatchObject({ recipient: "member@example.test", kind: "notification" });
    expect(world.events).toEqual(["stored", "delivery requested"]);
  });
});
