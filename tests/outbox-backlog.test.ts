import { randomBytes, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase, workerPool } from "./support/migrated-database";

/**
 * A new message behind older mail.
 *
 * The queue is served oldest first, a batch at a time. For a long-lived worker that wakes every
 * second that is all there is to say. For a web request that sends what it queued and is then the
 * last sender for hours, one batch is a trap: with a batch's worth of older messages waiting, the
 * message the person has just asked for is not attempted at all.
 *
 * This was found, not foreseen. The end-to-end check of the worker-less deployment was run against a
 * database in which another check had left twenty-nine messages that could never be sent. A person
 * signed up, the pass after that request took the six oldest, failed them, and stopped; the
 * verification email stayed in the queue with nothing left to send it.
 *
 * These run against the real migrations, as the worker role, because the property rests on what the
 * reservation does with a message that failed: it is not due again for half a minute.
 */

const world = vi.hoisted(() => ({ sendMail: vi.fn(), transports: 0 }));

vi.mock("nodemailer", () => ({
  createTransport: () => {
    world.transports += 1;
    return { sendMail: world.sendMail };
  },
}));

import { encryptValue } from "@/security/crypto";
import { drainEmailOutboxOnce, drainEmailOutboxWhileDue } from "@/worker/outbox-drain";

const APP_ORIGIN = "https://annapurna.example";
/** The pass after a web request: six at a time, three conversations at once. */
const requestPass = { batchSize: 6, sendsAtOnce: 3 };

let database: PGlite;
let statements: string[];
let pool: Pick<Pool, "query">;
const asPool = () => pool as Pool;

type Stored = { recipient: string; status: string; attempts: number; due: boolean; last_error: string | null };

async function stored(): Promise<Stored[]> {
  const result = await database.query<Stored>(`
    SELECT recipient, status::text AS status, attempts, available_at <= clock_timestamp() AS due, last_error
    FROM public.email_outbox ORDER BY created_at
  `);
  return result.rows;
}

/** Queue a message `minutesAgo`. One that `canBeSent` carries a real, encrypted, on-origin link. */
async function queue(recipient: string, minutesAgo: number, canBeSent: boolean): Promise<void> {
  const payload = canBeSent
    ? encryptValue(JSON.stringify({
        url: `${APP_ORIGIN}/api/auth/verify-email?token=${randomUUID()}`,
        heading: "Confirm your email",
        description: "Use the secure link below.",
        buttonLabel: "Confirm email",
      }), "EMAIL_ENCRYPTION_KEY")
    // What a message looks like once its link can no longer be validated: a key that was rotated,
    // or an origin that changed. It fails before any SMTP conversation, and on every later try.
    : "v1.not.a.ciphertext";
  await database.query(
    `INSERT INTO public.email_outbox (recipient, kind, encrypted_payload, message_id, created_at, available_at)
     VALUES ($1, 'verification', $2, $3, clock_timestamp() - make_interval(mins => $4), clock_timestamp() - make_interval(mins => $4))`,
    [recipient, payload, `<${randomUUID()}@annapurna-link.local>`, minutesAgo],
  );
}

const sentTo = () => world.sendMail.mock.calls.map((call) => (call[0] as { to: string }).to);
const reservations = () => statements.filter((text) => text.includes("app_worker_reserve_outbox_batch")).length;

beforeAll(async () => {
  database = await createMigratedDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.exec("DELETE FROM public.email_outbox");
  statements = [];
  const worker = workerPool(database);
  pool = {
    query: (async (text: string, params?: unknown[]) => {
      statements.push(text);
      return worker.query(text, params as never);
    }) as Pool["query"],
  };
  world.sendMail.mockReset().mockResolvedValue({ messageId: "accepted" });
  vi.stubEnv("SMTP_URL", "smtp://mail.example.test:587");
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("SMTP_FROM", "Annapurna Link <no-reply@example.test>");
  vi.stubEnv("APP_URL", APP_ORIGIN);
  vi.stubEnv("EMAIL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a message a person has just asked for, behind older mail", () => {
  it("is not reached by one batch: that is the six oldest, and nothing else", async () => {
    for (let index = 0; index < 14; index += 1) await queue(`stuck-${index}@example.test`, 120 - index, false);
    await queue("new-person@example.test", 0, true);

    const batch = await drainEmailOutboxOnce(asPool(), requestPass);

    expect(batch).toEqual({ delivered: true, reserved: 6, sent: 0, failed: 6 });
    expect(sentTo()).toEqual([]);
    // Never tried. On a host with no worker, this is where it stayed until a scheduler ran.
    expect((await stored()).at(-1)).toMatchObject({ recipient: "new-person@example.test", status: "pending", attempts: 0 });
  });

  it("is reached by the sweep, past older mail that can never be sent", async () => {
    for (let index = 0; index < 14; index += 1) await queue(`stuck-${index}@example.test`, 120 - index, false);
    await queue("new-person@example.test", 0, true);

    const sweep = await drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 10_000 });

    expect(sweep).toEqual({ delivered: true, reserved: 15, sent: 1, failed: 14 });
    expect(sentTo()).toEqual(["new-person@example.test"]);
    const after = await stored();
    expect(after.at(-1)).toMatchObject({ recipient: "new-person@example.test", status: "sent", attempts: 1 });
    // The older ones were each tried once and put back to wait their turn, not dropped and not marked sent.
    for (const row of after.slice(0, 14)) {
      expect(row).toMatchObject({ status: "pending", attempts: 1, due: false, last_error: "SMTP_OR_PAYLOAD_ERROR" });
    }
  });

  it("is reached past older mail that can be sent, which goes first", async () => {
    for (let index = 0; index < 13; index += 1) await queue(`waiting-${index}@example.test`, 60 - index, true);
    await queue("new-person@example.test", 0, true);

    const sweep = await drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 10_000 });

    expect(sweep).toEqual({ delivered: true, reserved: 14, sent: 14, failed: 0 });
    const order = sentTo();
    expect(new Set(order).size).toBe(14);
    // Oldest first, a batch at a time: the first six sent are the six that had waited longest, and
    // the newest message leaves in the last batch.
    expect(order.slice(0, 6).sort()).toEqual(Array.from({ length: 6 }, (_, index) => `waiting-${index}@example.test`).sort());
    expect(order.indexOf("new-person@example.test")).toBeGreaterThanOrEqual(12);
    expect((await stored()).every((row) => row.status === "sent")).toBe(true);
  });

  it("sends each message once, whatever the batches were", async () => {
    for (let index = 0; index < 12; index += 1) await queue(`waiting-${index}@example.test`, 60 - index, true);

    // Exactly two full batches: the sweep has to ask a third time to learn that nothing is left.
    const sweep = await drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 10_000 });

    expect(sweep).toMatchObject({ reserved: 12, sent: 12, failed: 0 });
    expect(world.sendMail).toHaveBeenCalledTimes(12);
    expect(new Set(sentTo()).size).toBe(12);
    expect(reservations()).toBe(3);
  });
});

describe("a sweep always ends", () => {
  it("ends when nothing in the queue can be sent, having tried each message once", async () => {
    for (let index = 0; index < 20; index += 1) await queue(`stuck-${index}@example.test`, 90 - index, false);

    const sweep = await drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 10_000 });

    expect(sweep).toEqual({ delivered: true, reserved: 20, sent: 0, failed: 20 });
    // Six, six, six, and a short batch of two that says the queue is done.
    expect(reservations()).toBe(4);
    for (const row of await stored()) expect(row).toMatchObject({ status: "pending", attempts: 1, due: false });
  });

  it("takes no new batch once its time is up, and leaves the rest for the next sender", async () => {
    for (let index = 0; index < 20; index += 1) await queue(`stuck-${index}@example.test`, 90 - index, false);

    const outOfTime = await drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 0 });

    // The batch that was taken is finished; nothing more is started.
    expect(outOfTime).toEqual({ delivered: true, reserved: 6, sent: 0, failed: 6 });
    expect(reservations()).toBe(1);
    const untouched = (await stored()).filter((row) => row.attempts === 0);
    expect(untouched).toHaveLength(14);
    expect(untouched.every((row) => row.status === "pending" && row.due)).toBe(true);

    // The next sender carries on from there, and does not take the six that have just failed.
    const next = await drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 10_000 });
    expect(next).toEqual({ delivered: true, reserved: 14, sent: 0, failed: 14 });
    expect((await stored()).every((row) => row.attempts === 1)).toBe(true);
  });

  it("stops at once where this process cannot send mail, with the queue intact", async () => {
    vi.stubEnv("SMTP_URL", "");
    for (let index = 0; index < 9; index += 1) await queue(`waiting-${index}@example.test`, 30 - index, true);

    const sweep = await drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 10_000 });

    expect(sweep).toEqual({ delivered: false, reserved: 0, sent: 0, failed: 0 });
    expect(reservations()).toBe(0);
    expect(statements.filter((text) => text.includes("app_worker_defer_outbox"))).toHaveLength(1);
    expect(world.sendMail).not.toHaveBeenCalled();
    // Deferred, not consumed: no attempt was spent on a process that could never have sent them.
    for (const row of await stored()) expect(row).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("stops when the database stops answering, instead of going round", async () => {
    for (let index = 0; index < 20; index += 1) await queue(`waiting-${index}@example.test`, 90 - index, true);
    const working = pool.query;
    let reserved = 0;
    pool = {
      query: (async (text: string, params?: unknown[]) => {
        if (text.includes("app_worker_reserve_outbox_batch") && (reserved += 1) === 2) throw new Error("Connection terminated unexpectedly");
        return (working as (text: string, params?: unknown[]) => Promise<unknown>)(text, params);
      }) as Pool["query"],
    };

    await expect(drainEmailOutboxWhileDue(asPool(), { ...requestPass, budgetMs: 10_000 })).rejects.toThrow("Connection terminated");

    // The first batch went out and is recorded; nothing was taken that was not sent.
    expect(world.sendMail).toHaveBeenCalledTimes(6);
    const after = await stored();
    expect(after.filter((row) => row.status === "sent")).toHaveLength(6);
    expect(after.filter((row) => row.status === "pending" && row.attempts === 0)).toHaveLength(14);
  });
});
