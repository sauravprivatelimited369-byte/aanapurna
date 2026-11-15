import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Delivery straight after the request that queued something.
 *
 * On a deployment with no long-lived worker this is the only thing that sends a verification email or
 * a push while it is still worth sending: the scheduled drain has been observed to run hours apart,
 * against a link that expires in one hour and a push that is only sent for fifteen minutes.
 *
 * It runs inside whatever a serverless function has left after it answered, on an instance that also
 * serves other requests, so the properties worth pinning are about restraint: one pass however many
 * callers ask, nothing left running that never ends, and no touching a queue this process cannot serve.
 */

const world = vi.hoisted(() => ({
  afterTasks: [] as (() => unknown)[],
  insideRequest: true,
  mailConfigured: true,
  pushIsConfigured: true,
  pools: [] as { options: Record<string, unknown>; end: ReturnType<typeof vi.fn> }[],
  drainMail: vi.fn(),
  drainPush: vi.fn(),
  query: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    if (!world.insideRequest) throw new Error("`after` was called outside a request scope.");
    world.afterTasks.push(task);
  },
}));

vi.mock("pg", () => ({
  Pool: class {
    end: ReturnType<typeof vi.fn>;
    query = world.query;
    constructor(options: Record<string, unknown>) {
      this.end = vi.fn(async () => undefined);
      world.pools.push({ options, end: this.end });
    }
    on() { return this; }
  },
}));

vi.mock("@/email/settings", () => ({ getEmailSettingsStatus: () => ({ configured: world.mailConfigured }) }));
vi.mock("@/push/vapid", () => ({ pushConfigured: () => world.pushIsConfigured }));
vi.mock("@/worker/outbox-drain", () => ({ drainEmailOutboxWhileDue: world.drainMail }));
vi.mock("@/worker/push-drain", () => ({ drainPushOnce: world.drainPush }));

import { canSendMailHere, deliverPendingNow, requestInlineDelivery, withWorkerPool } from "@/worker/inline-delivery";

const mailDone = { delivered: true, reserved: 0, sent: 0, failed: 0 };
const pushDone = { configured: true, considered: 0, delivered: 0, failed: 0, revoked: 0, deferred: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  world.afterTasks.length = 0;
  world.pools.length = 0;
  world.insideRequest = true;
  world.mailConfigured = true;
  world.pushIsConfigured = true;
  world.drainMail.mockReset().mockResolvedValue(mailDone);
  world.drainPush.mockReset().mockResolvedValue(pushDone);
  world.query.mockReset().mockResolvedValue({ rows: [] });
  vi.stubEnv("WORKER_DATABASE_URL", "postgres://annapurna_worker:not-a-real-password@db.example.test:5432/annapurna_link");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("asking for delivery once the request has answered", () => {
  it("registers a task with the request, and runs nothing before the response", () => {
    expect(requestInlineDelivery()).toBe(true);
    expect(world.afterTasks).toHaveLength(1);
    // Nothing has been sent, and no connection opened: the person waiting on this request is not kept
    // waiting on an SMTP conversation or a push service.
    expect(world.drainMail).not.toHaveBeenCalled();
    expect(world.drainPush).not.toHaveBeenCalled();
    expect(world.pools).toEqual([]);
  });

  it("declines where there is no request to wait for", () => {
    // A script, a test, the long-lived worker. Whatever that process already does delivers instead.
    world.insideRequest = false;
    expect(requestInlineDelivery()).toBe(false);
    expect(world.afterTasks).toEqual([]);
  });

  it("declines when this process does not hold the worker's database credentials", () => {
    // Without them nothing here could send. Saying yes would stop the caller from waking the worker.
    vi.stubEnv("WORKER_DATABASE_URL", "");
    expect(requestInlineDelivery()).toBe(false);
    expect(world.afterTasks).toEqual([]);
  });

  it("reports whether this process can send mail at all", () => {
    expect(canSendMailHere()).toBe(true);
    world.mailConfigured = false;
    expect(canSendMailHere()).toBe(false);
  });
});

describe("one pass, however many ask", () => {
  it("shares a single pass between every task one response registered", async () => {
    // One offer can notify a dozen people and queue a dozen emails. Each asks for delivery.
    for (let index = 0; index < 12; index += 1) requestInlineDelivery();
    await Promise.all(world.afterTasks.map((task) => task()));
    expect(world.drainMail).toHaveBeenCalledTimes(1);
    expect(world.drainPush).toHaveBeenCalledTimes(1);
    expect(world.pools).toHaveLength(1);
  });

  it("runs once more for a request that arrives after a pass has started reading", async () => {
    // Its rows may have been committed after that pass claimed its batch. Without the extra pass they
    // would wait for the next request, or for a scheduler that runs hours apart.
    const firstPush = deferred<typeof pushDone>();
    world.drainPush.mockReturnValueOnce(firstPush.promise);

    const early = deliverPendingNow();
    await vi.waitFor(() => expect(world.drainPush).toHaveBeenCalledTimes(1));

    let lateSettled = false;
    const late = deliverPendingNow().then(() => { lateSettled = true; });
    // Several late arrivals still cost one extra pass, not one each.
    void deliverPendingNow();
    void deliverPendingNow();

    firstPush.resolve(pushDone);
    await early;
    await late;
    // The late caller's promise is what keeps a serverless instance alive: it must not settle until
    // the pass that covers its rows has finished.
    expect(lateSettled).toBe(true);
    expect(world.drainPush).toHaveBeenCalledTimes(2);
    expect(world.drainMail).toHaveBeenCalledTimes(2);
  });

  it("starts fresh once a pass has finished", async () => {
    await deliverPendingNow();
    await deliverPendingNow();
    expect(world.drainPush).toHaveBeenCalledTimes(2);
  });

  it("lets each caller go when the pass that covers it has finished, whoever arrives later", async () => {
    // A caller's promise is what holds its function open after it has answered, and a function has
    // a time limit. On a busy instance somebody new arrives during every pass. If each arrival kept
    // everybody before it waiting, the first caller would be held until the traffic stopped - or
    // until the host cut its function off, with a pass in mid-air.
    const passes = [deferred<typeof pushDone>(), deferred<typeof pushDone>(), deferred<typeof pushDone>()];
    for (const pass of passes) world.drainPush.mockReturnValueOnce(pass.promise);
    const settled: string[] = [];

    const first = deliverPendingNow().then(() => { settled.push("first"); });
    await vi.waitFor(() => expect(world.drainPush).toHaveBeenCalledTimes(1));
    // Arrives while the first pass is reading: needs the second.
    const second = deliverPendingNow().then(() => { settled.push("second"); });

    passes[0].resolve(pushDone);
    await first;
    await vi.waitFor(() => expect(world.drainPush).toHaveBeenCalledTimes(2));
    expect(settled).toEqual(["first"]);
    // Arrives while the second pass is reading: needs the third.
    const third = deliverPendingNow().then(() => { settled.push("third"); });

    passes[1].resolve(pushDone);
    await second;
    await vi.waitFor(() => expect(world.drainPush).toHaveBeenCalledTimes(3));
    // The third pass is still running, and nobody it does not cover is waiting for it.
    expect(settled).toEqual(["first", "second"]);

    passes[2].resolve(pushDone);
    await third;
    expect(settled).toEqual(["first", "second", "third"]);
    expect(world.drainPush).toHaveBeenCalledTimes(3);
  });

  it("does not start a second pass beside one that began in the same instant", async () => {
    // A function carries on the moment its pass ends and may ask again at once - before the pass
    // that was waiting behind the first has been started. Both belong in one pass, on one connection.
    const firstPush = deferred<typeof pushDone>();
    let running = 0;
    let most = 0;
    world.drainPush.mockReturnValueOnce(firstPush.promise).mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return pushDone;
    });

    let askedAgain: Promise<void> | undefined;
    const first = deliverPendingNow().then(() => { askedAgain = deliverPendingNow(); });
    await vi.waitFor(() => expect(world.drainPush).toHaveBeenCalledTimes(1));
    const waitingBehind = deliverPendingNow();

    firstPush.resolve(pushDone);
    await first;
    await waitingBehind;
    await askedAgain;
    expect(most).toBe(1);
    expect(world.drainPush).toHaveBeenCalledTimes(2);
    expect(world.pools).toHaveLength(2);
  });

  it("never runs two passes at once, however the arrivals fall", async () => {
    let running = 0;
    let most = 0;
    world.drainPush.mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return pushDone;
    });
    const waiting: Promise<void>[] = [];
    for (let index = 0; index < 40; index += 1) {
      waiting.push(deliverPendingNow());
      // Some in the same turn as the one before, some a moment later, some mid-pass.
      if (index % 3 === 0) await new Promise((resolve) => setTimeout(resolve, index % 7));
      if (index % 5 === 0) await Promise.resolve();
    }
    await Promise.all(waiting);
    expect(most).toBe(1);
    // Everybody was covered by a pass that began after they asked, and nothing is left behind:
    // the next request starts a pass of its own straight away.
    const calls = world.drainPush.mock.calls.length;
    await deliverPendingNow();
    expect(world.drainPush).toHaveBeenCalledTimes(calls + 1);
  });
});

describe("only the queues this process can serve", () => {
  it("leaves the mail queue alone when this process cannot send mail", async () => {
    // The mail drain *defers* every queued message when SMTP is not configured. That is right for the
    // one process responsible for mail, and wrong for a web tier beside a worker that can send: it
    // would keep pushing the worker's mail into the future.
    world.mailConfigured = false;
    await deliverPendingNow();
    expect(world.drainMail).not.toHaveBeenCalled();
    expect(world.drainPush).toHaveBeenCalledTimes(1);
  });

  it("leaves notifications alone when this process has no key pair", async () => {
    world.pushIsConfigured = false;
    await deliverPendingNow();
    expect(world.drainPush).not.toHaveBeenCalled();
    expect(world.drainMail).toHaveBeenCalledTimes(1);
  });

  it("opens no connection at all when it can serve neither", async () => {
    world.mailConfigured = false;
    world.pushIsConfigured = false;
    await deliverPendingNow();
    expect(world.pools).toEqual([]);
  });

  it("asks for small, bounded work: this runs in what a function has left after answering", async () => {
    await deliverPendingNow();
    const [, mailOptions] = world.drainMail.mock.calls[0]! as [unknown, { batchSize: number; sendsAtOnce: number; budgetMs: number }];
    const [, pushOptions] = world.drainPush.mock.calls[0]! as [unknown, { budgetMs: number; requestTimeoutMs: number; retryDelayMs: number }];
    // A few at a time, so an instance stopped part-way strands a handful of reservations...
    expect(mailOptions.batchSize).toBeLessThanOrEqual(10);
    expect(mailOptions.sendsAtOnce).toBeGreaterThan(1);
    // ...and for long enough to get past older mail to the message this request queued, while
    // leaving the last batch several seconds before the pass is given up on at twenty.
    expect(mailOptions.budgetMs).toBeGreaterThanOrEqual(5_000);
    expect(mailOptions.budgetMs).toBeLessThanOrEqual(14_000);
    // Worst case for one device: a timeout, the pause, and one more timeout. Kept under ten seconds.
    expect(pushOptions.requestTimeoutMs * 2 + pushOptions.retryDelayMs).toBeLessThan(10_000);
    expect(pushOptions.budgetMs).toBeLessThanOrEqual(6_000);
  });
});

describe("nothing here may fail a request or outlive its welcome", () => {
  it("still pushes when the mail server is failing, and never rejects", async () => {
    world.drainMail.mockRejectedValueOnce(new Error("smtp connection refused"));
    await expect(deliverPendingNow()).resolves.toBeUndefined();
    expect(world.drainPush).toHaveBeenCalledTimes(1);
    world.drainPush.mockRejectedValueOnce(new Error("database went away"));
    await expect(deliverPendingNow()).resolves.toBeUndefined();
    expect(world.drainMail).toHaveBeenCalledTimes(2);
  });

  it("logs counts and never a recipient, a link or an endpoint", async () => {
    world.drainMail.mockResolvedValueOnce({ delivered: true, reserved: 2, sent: 2, failed: 0 });
    world.drainPush.mockResolvedValueOnce({ ...pushDone, considered: 3, delivered: 2, failed: 1, deferred: 1 });
    await deliverPendingNow();
    const lines = vi.mocked(console.info).mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: "info",
      event: "inline_delivery.completed",
      mail: { sent: 2, failed: 0 },
      push: { considered: 3, delivered: 2, failed: 1, revoked: 0, deferred: 1 },
    });
  });

  it("says nothing when there was nothing to do", async () => {
    // Most requests queue nothing. A log line per request would bury the ones that matter.
    await deliverPendingNow();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("closes the connection it opened, with a limit on every query", async () => {
    await deliverPendingNow();
    expect(world.pools).toHaveLength(1);
    expect(world.pools[0]!.end).toHaveBeenCalledTimes(1);
    // A serverless instance's sockets can die silently while it is frozen. Without a limit, a query on
    // one of them waits for ever, and every later request on that instance waits with it.
    expect(world.pools[0]!.options.query_timeout).toBeGreaterThan(0);
    expect(world.pools[0]!.options.max).toBeLessThanOrEqual(2);
  });

  it("returns null from the worker pool where there are no worker credentials", async () => {
    vi.stubEnv("WORKER_DATABASE_URL", "");
    const task = vi.fn(async () => "ran");
    expect(await withWorkerPool("test", task)).toBeNull();
    expect(task).not.toHaveBeenCalled();
  });

  it("does not wait for ever on a connection that never closes", async () => {
    vi.useFakeTimers();
    try {
      const outcome = withWorkerPool("test", async (pool) => {
        // A dead socket never acknowledges the close.
        (pool as unknown as { end: () => Promise<void> }).end = () => new Promise<void>(() => undefined);
        return "done";
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(outcome).resolves.toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a pass that has stopped answering, so the next request is not stuck behind it", async () => {
    vi.useFakeTimers();
    try {
      world.drainPush.mockReturnValueOnce(new Promise(() => undefined));
      world.drainMail.mockReturnValueOnce(new Promise(() => undefined));
      let settled = false;
      const stuck = deliverPendingNow().then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(19_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      await stuck;
      expect(settled).toBe(true);

      // And the instance is usable again: a later request gets its own pass.
      const next = deliverPendingNow();
      await vi.advanceTimersByTimeAsync(100);
      await next;
      expect(world.drainPush).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a pass leaves a trace a person can look at", () => {
  /**
   * Delivery here rests on the host running work after a response. If it stopped doing so, nothing
   * would fail: requests would answer, rows would queue, and the only symptom would be mail arriving
   * late again. So each pass records that it ran, and `/api/health` reports how long ago.
   */
  it("records that it ran, with counts only", async () => {
    world.drainMail.mockResolvedValueOnce({ delivered: true, reserved: 2, sent: 1, failed: 1 });
    world.drainPush.mockResolvedValueOnce({ ...pushDone, considered: 4, delivered: 3, failed: 1 });
    await deliverPendingNow();
    expect(world.query).toHaveBeenCalledTimes(1);
    const [statement, parameters] = world.query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("insert into public.service_health");
    expect(parameters[0]).toBe("after-response-delivery");
    // Read by a public endpoint: numbers, and nothing that could name a person or a device.
    expect(JSON.parse(String(parameters[1]))).toEqual({ mailSent: 1, mailFailed: 1, pushDelivered: 3, pushFailed: 1 });
  });

  it("records a pass that found nothing: that the host ran it is the point", async () => {
    await deliverPendingNow();
    expect(world.query).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((world.query.mock.calls[0] as [string, unknown[]])[1][1]))).toEqual({
      mailSent: 0, mailFailed: 0, pushDelivered: 0, pushFailed: 0,
    });
  });

  it("says which queue it did not serve, instead of reporting zero for it", async () => {
    world.mailConfigured = false;
    await deliverPendingNow();
    expect(JSON.parse(String((world.query.mock.calls[0] as [string, unknown[]])[1][1]))).toEqual({
      mailSent: null, mailFailed: null, pushDelivered: 0, pushFailed: 0,
    });
  });

  it("does not let a failure to record it disturb the pass", async () => {
    world.query.mockRejectedValueOnce(new Error("could not serialize access"));
    await expect(deliverPendingNow()).resolves.toBeUndefined();
    expect(world.drainMail).toHaveBeenCalledTimes(1);
    expect(world.drainPush).toHaveBeenCalledTimes(1);
    expect(world.pools[0]!.end).toHaveBeenCalledTimes(1);
  });

  it("writes it on the connection the pass already holds, before that is closed", async () => {
    let closedBeforeRecording: boolean | null = null;
    world.query.mockImplementationOnce(async () => {
      closedBeforeRecording = world.pools[0]!.end.mock.calls.length > 0;
      return { rows: [] };
    });
    await deliverPendingNow();
    expect(world.pools).toHaveLength(1);
    expect(closedBeforeRecording).toBe(false);
  });
});

describe("every web request that writes a notification asks for it to be delivered", () => {
  /**
   * Notifications are written by database functions, and the sender sweeps whatever was written - so
   * a new kind of notification is pushed without anybody wiring it. What does need wiring is the
   * *prompt*: on a host with no worker, a push leaves within seconds only if the request that wrote the
   * row asked for delivery. A notification helper added without that would work in every test and
   * arrive hours late, or never, on the live site. This reads the source because that is where the
   * omission would be.
   */
  const sourceFiles = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

  it("calls for delivery in each function that calls a notifying database function", () => {
    const root = resolve(process.cwd(), "src");
    // The worker and the scheduled drain send for themselves; this is about the web tier.
    const webTier = sourceFiles(root).filter((path) => !path.startsWith(join(root, "worker")));
    const callers: string[] = [];
    for (const path of webTier) {
      const source = readFileSync(path, "utf8");
      // Top-level functions, split where the next one starts.
      for (const body of source.split(/\n(?=(?:export )?(?:async )?function )/)) {
        // Called as `select public.app_notify_x(` and, in one place, without the schema.
        if (!/select\s+(?:public\.)?app_notify_[a-z_]+\(/.test(body)) continue;
        const name = /function (\w+)/.exec(body)?.[1] ?? path;
        callers.push(name);
        expect(body, `${name} writes notifications and never asks for them to be delivered`).toMatch(/pushAfterResponse\(\)/);
      }
    }
    // If this list changes, a notifying function was added or removed: look at it, then update it.
    expect(callers.sort()).toEqual(["notifyAreaHelpers", "notifyOrganization", "notifyPlatformRoles", "notifyUser"]);
  });
});
