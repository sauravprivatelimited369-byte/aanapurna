import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { asRole, createMigratedDatabase, workerPool } from "./support/migrated-database";

/**
 * Device notifications from the button to the phone, against a real PostgreSQL with every migration
 * applied and the same roles the deployment connects with.
 *
 * The feature shipped with tests for its pure functions, and every one of them passed while nobody
 * could turn notifications on. Three things were wrong, and each was only visible where the pieces
 * meet:
 *
 * - the route sent its statements without saying who was asking, so row-level security refused every
 *   registration;
 * - nothing on a deployment without a long-lived worker ever sent a push;
 * - a send that failed was recorded as delivered.
 *
 * So these tests run the shipped route handlers and the shipped sender against the shipped schema. The
 * only things replaced are the ones that are not this application: the session lookup, the rate
 * limiter's storage, and the push service on the other end.
 */

const world = vi.hoisted(() => ({
  database: null as unknown,
  signedInAs: null as string | null,
  rateLimit: vi.fn<(options: { bucket: string; userId: string; userMax?: number; ipMax?: number }) => Promise<void>>(async () => undefined),
  sender: null as unknown,
}));

vi.mock("@/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { asRole: runAs } = await import("./support/migrated-database");
  const dialect = new PgDialect();
  const transaction = {
    execute: async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      try {
        const result = await (world.database as PGlite).query(text, params);
        return { rows: result.rows };
      } catch (error) {
        // The query layer wraps what the driver throws, so the SQLSTATE is on the cause. Reproduced
        // here because code that looks for it in the wrong place works in a test and not in production.
        throw Object.assign(new Error("Failed query"), { cause: error });
      }
    },
  };
  return {
    // Exactly what the real one does: a transaction as the web role, with the session user set in it.
    withUserContext: <T>(userId: string, callback: (tx: typeof transaction) => Promise<T>) =>
      runAs(world.database as PGlite, "annapurna_app", userId, () => callback(transaction)),
    // And what the first version of the route used instead: the same role with nothing saying who is
    // asking. Kept so that a route which goes back to it fails here the way it failed on the live site.
    db: {
      execute: (query: SQL) => runAs(world.database as PGlite, "annapurna_app", null, () => transaction.execute(query)),
    },
  };
});

vi.mock("@/lib/identity", async () => {
  const { HttpError } = await import("@/lib/http");
  return {
    requireIdentity: async () => {
      if (!world.signedInAs) throw new HttpError(401, "Sign in with a verified account to continue.", "AUTHENTICATION_REQUIRED");
      return { id: world.signedInAs };
    },
  };
});

vi.mock("@/security/rate-limit", () => ({ enforceMutationRateLimit: world.rateLimit }));

vi.mock("@/worker/inline-delivery", async () => {
  const { workerPool: pool } = await import("./support/migrated-database");
  return {
    withWorkerPool: async <T>(_name: string, task: (connection: unknown) => Promise<T>) => task(pool(world.database as PGlite)),
  };
});

vi.mock("@/push/deliver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/push/deliver")>()),
  createPushSender: async () => world.sender,
}));

import { DELETE, GET, POST } from "@/app/api/account/push/route";
import { POST as SEND_TEST } from "@/app/api/account/push/test/route";
import { HttpError } from "@/lib/http";
import type { PushSender } from "@/push/deliver";
import { endpointFingerprint } from "@/push/subscription";
import { drainPushOnce } from "@/worker/push-drain";

const ORIGIN = "https://annapurna.test";
const KEY = "BPm3n1rYtJ8sQf0aXc2dLw7eVh4uKz9oGi6yTb5NjR1pSx3CqWm8ZvEa0DlHgUkFyOs2IrAeBn4Mt7Jc6Xd9Lw";
const AUTH = "c2VjcmV0LWF1dGgtMDE";
const OTHER_KEY = "BQz8k2sWuK9tRg1bYd3eMx8fWi5vLa0pHj7zUc6OkS2qTy4DrXn9AwFb1EmIhVlGzPt3JsBfCo5Nu8Kd7Ye0Mx";
const OTHER_AUTH = "b3RoZXItYXV0aC0wMDI";

let database: PGlite;
let people = 0;
let endpoints = 0;

const savedEnvironment = {
  WEB_PUSH_PUBLIC_KEY: process.env.WEB_PUSH_PUBLIC_KEY,
  WEB_PUSH_PRIVATE_KEY: process.env.WEB_PUSH_PRIVATE_KEY,
  WEB_PUSH_SUBJECT: process.env.WEB_PUSH_SUBJECT,
};

function configurePush() {
  process.env.WEB_PUSH_PUBLIC_KEY = KEY;
  process.env.WEB_PUSH_PRIVATE_KEY = "dGVzdC1vbmx5LXByaXZhdGUta2V5LW5vdC1yZWFs";
  process.env.WEB_PUSH_SUBJECT = "https://annapurna.test";
}

beforeAll(async () => {
  database = await createMigratedDatabase();
  world.database = database;
  configurePush();
}, 60_000);

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await database?.close();
});

beforeEach(async () => {
  world.signedInAs = null;
  world.sender = null;
  world.rateLimit.mockReset();
  world.rateLimit.mockImplementation(async () => undefined);
  configurePush();
  // Each test starts with nothing waiting to be sent: a sender claims whatever is pending, whoever wrote it.
  await database.exec("UPDATE public.notifications SET push_delivered_at = clock_timestamp() WHERE push_delivered_at IS NULL");
});

async function someone(): Promise<string> {
  people += 1;
  const id = `pipeline-${people}`;
  await database.query(
    `INSERT INTO public."user" (id, name, email, email_verified) VALUES ($1, $2, $3, true)`,
    [id, `Person ${people}`, `${id}@example.test`],
  );
  return id;
}

/** What `pushManager.subscribe()` hands a page. The word in the path decides how the stand-in push service answers. */
function browserSubscription(behaviour = "ok") {
  endpoints += 1;
  return { endpoint: `https://push.example.test/${behaviour}-${endpoints}`, expirationTime: null, keys: { p256dh: KEY, auth: AUTH } };
}

function call(method: "GET" | "POST" | "DELETE", body?: unknown, headers: Record<string, string> = {}, path = "/api/account/push") {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function turnOn(userId: string, behaviour = "ok") {
  world.signedInAs = userId;
  const subscription = browserSubscription(behaviour);
  const response = await POST(call("POST", subscription));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return subscription;
}

const notify = (userId: string, title: string, body = "Collect within 45 minutes.") =>
  asRole(database, "annapurna_app", userId, () =>
    database.query("SELECT public.app_notify_user($1, NULL, 'test.pipeline', $2, $3, '/app/offers')", [userId, title, body]));

const devicesOf = (userId: string) => database.query<{ endpoint: string; revoked: boolean; last_error: string | null; delivered: boolean }>(
  `SELECT endpoint, revoked_at IS NOT NULL AS revoked, last_error, last_delivered_at IS NOT NULL AS delivered
   FROM public.push_subscriptions WHERE user_id = $1 ORDER BY created_at, endpoint`, [userId],
).then((result) => result.rows);

const notificationsOf = (userId: string) => database.query<{ title: string; outcome: string | null; finished: boolean; attempts: number }>(
  `SELECT title, push_outcome AS outcome, push_delivered_at IS NOT NULL AS finished, push_attempts AS attempts
   FROM public.notifications WHERE user_id = $1 ORDER BY created_at, title`, [userId],
).then((result) => result.rows);

const makeDue = () => database.exec(
  "UPDATE public.notifications SET push_next_attempt_at = clock_timestamp() - interval '1 second' WHERE push_delivered_at IS NULL",
);

type Sent = { endpoint: string; title: string; body: string; href: string };

/** The other end of the wire. Answers by the word in the endpoint, the way a real push service answers by its own state. */
function pushService() {
  const sent: Sent[] = [];
  const attempts = new Map<string, number>();
  const send: PushSender = async (target, message) => {
    const attempt = (attempts.get(target.endpoint) ?? 0) + 1;
    attempts.set(target.endpoint, attempt);
    sent.push({ endpoint: target.endpoint, ...(JSON.parse(message) as Omit<Sent, "endpoint">) });
    const answer = (statusCode?: number) => {
      throw Object.assign(new Error("push service said no"), statusCode === undefined ? {} : { statusCode });
    };
    if (target.endpoint.includes("/gone-")) answer(410);
    if (target.endpoint.includes("/down-")) answer(503);
    if (target.endpoint.includes("/refused-")) answer(403);
    if (target.endpoint.includes("/unreachable-")) answer();
    if (target.endpoint.includes("/flaky-") && attempt === 1) answer(503);
  };
  return { send, sent };
}

const drain = (service: { send: PushSender }, options: { budgetMs?: number } = {}) =>
  drainPushOnce(workerPool(database), { sender: service.send, retryDelayMs: 0, ...options });

describe("turning notifications on stores the device of the person who is signed in", () => {
  it("registers the caller's browser and lists it back without its secrets", async () => {
    const person = await someone();
    world.signedInAs = person;
    const subscription = browserSubscription();

    // The request that returned 500 for everybody. The database was refusing the insert, correctly:
    // nothing in the statement's transaction said who was asking.
    const registered = await POST(call("POST", subscription));
    expect(registered.status).toBe(201);
    expect(await registered.json()).toEqual({
      registered: true,
      label: "Chrome on Android",
      fingerprint: endpointFingerprint(subscription.endpoint),
    });
    expect(await devicesOf(person)).toEqual([
      { endpoint: subscription.endpoint, revoked: false, last_error: null, delivered: false },
    ]);

    const listed = await GET(call("GET"));
    expect(listed.status).toBe(200);
    const body = await listed.json() as { configured: boolean; publicKey: string; devices: Record<string, unknown>[] };
    expect(body.configured).toBe(true);
    expect(body.publicKey).toBe(KEY);
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({
      label: "Chrome on Android",
      service: "push",
      fingerprint: endpointFingerprint(subscription.endpoint),
    });
    // The endpoint and keys are what let anybody holding them push to that device. They go in, and
    // never come back out.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(subscription.endpoint);
    expect(raw).not.toContain(AUTH);
    expect(Object.keys(body.devices[0]!).sort()).toEqual(["addedAt", "fingerprint", "label", "service"]);
  });

  it("shows a person only their own devices", async () => {
    const owner = await someone();
    const stranger = await someone();
    await turnOn(owner);
    world.signedInAs = stranger;
    const body = await (await GET(call("GET"))).json() as { devices: unknown[] };
    expect(body.devices).toEqual([]);
  });

  it("waits for the rate limiter's answer before it does anything", async () => {
    // The limiter is asynchronous and the route once called it without waiting, so a refusal arrived
    // after the work was done and was dropped. Here it refuses, and nothing may be stored.
    const person = await someone();
    world.signedInAs = person;
    world.rateLimit.mockRejectedValueOnce(new HttpError(429, "Too many attempts. Wait a little and try again.", "RATE_LIMITED"));
    const response = await POST(call("POST", browserSubscription()));
    expect(response.status).toBe(429);
    expect(await devicesOf(person)).toEqual([]);
    expect(world.rateLimit).toHaveBeenCalledWith(expect.objectContaining({ bucket: "push-subscribe", userId: person, userMax: 20 }));

    world.rateLimit.mockRejectedValueOnce(new HttpError(429, "Too many attempts. Wait a little and try again.", "RATE_LIMITED"));
    const removal = await DELETE(call("DELETE", { all: true }));
    expect(removal.status).toBe(429);
  });

  it("refuses an address or a key that no browser would have produced", async () => {
    const person = await someone();
    world.signedInAs = person;
    const good = browserSubscription();
    const unusable = [
      { ...good, endpoint: "http://push.example.test/plain" },
      { ...good, endpoint: "https://127.0.0.1/push/x" },
      { ...good, endpoint: "https://localhost/push/x" },
      { ...good, endpoint: "https://push.example.test:8443/x" },
      { ...good, keys: { p256dh: "short", auth: AUTH } },
      { ...good, keys: { p256dh: KEY } },
      { endpoint: good.endpoint },
      null,
      "not an object",
    ];
    for (const body of unusable) {
      const response = await POST(call("POST", body));
      // 400, not 500: the browser sent something unusable, and the answer should say that rather than
      // surface whichever database constraint it happened to trip.
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("PUSH_SUBSCRIPTION_INVALID");
    }
    expect(await devicesOf(person)).toEqual([]);
  });

  it("says so when this deployment has no key pair", async () => {
    const person = await someone();
    world.signedInAs = person;
    delete process.env.WEB_PUSH_PRIVATE_KEY;
    const listed = await (await GET(call("GET"))).json() as { configured: boolean; publicKey: string | null };
    expect(listed).toMatchObject({ configured: false, publicKey: null });
    const response = await POST(call("POST", browserSubscription()));
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("PUSH_NOT_CONFIGURED");
  });

  it("refuses a request that is not signed in, or does not come from this site", async () => {
    world.signedInAs = null;
    expect((await GET(call("GET"))).status).toBe(401);
    expect((await POST(call("POST", browserSubscription()))).status).toBe(401);

    world.signedInAs = await someone();
    expect((await POST(call("POST", browserSubscription(), { origin: "https://evil.example" }))).status).toBe(403);
    expect((await DELETE(call("DELETE", { all: true }, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("will not hand a browser to somebody who cannot show its keys, and moves it to somebody who can", async () => {
    const first = await someone();
    const second = await someone();
    const shared = await turnOn(first);

    // Knowing where a device is, is not holding it.
    world.signedInAs = second;
    const forged = await POST(call("POST", { ...shared, keys: { p256dh: OTHER_KEY, auth: OTHER_AUTH } }));
    expect(forged.status).toBe(409);
    expect((await forged.json() as { error: { code: string } }).error.code).toBe("PUSH_SUBSCRIPTION_CONFLICT");
    expect((await devicesOf(first))[0]).toMatchObject({ revoked: false });

    // The same browser, with the subscription only that browser holds: a shared phone the first person
    // never signed out of. It becomes the second person's, and the first is told nothing more on it.
    const moved = await POST(call("POST", shared));
    expect(moved.status).toBe(201);
    expect(await devicesOf(first)).toEqual([
      { endpoint: shared.endpoint, revoked: true, last_error: "registered_by_another_account", delivered: false },
    ]);
    expect(await devicesOf(second)).toEqual([
      { endpoint: shared.endpoint, revoked: false, last_error: null, delivered: false },
    ]);
  });

  it("continues a registration the browser replaced by itself, and never starts one that way", async () => {
    const person = await someone();
    const bystander = await someone();
    const original = await turnOn(person);
    const replacement = browserSubscription();

    // What the service worker reports when the browser rotates a subscription with no page open.
    const continued = await POST(call("POST", { ...replacement, replaces: original.endpoint }));
    expect(continued.status).toBe(201);
    expect(await devicesOf(person)).toEqual([
      { endpoint: original.endpoint, revoked: true, last_error: "replaced_by_browser", delivered: false },
      { endpoint: replacement.endpoint, revoked: false, last_error: null, delivered: false },
    ]);

    // Somebody else is signed in on that browser when it happens. Nobody pressed a button for them, so
    // a background event must not enrol them - and must not disturb the registration it names.
    world.signedInAs = bystander;
    const uninvited = await POST(call("POST", { ...browserSubscription(), replaces: replacement.endpoint }));
    expect(uninvited.status).toBe(409);
    expect((await uninvited.json() as { error: { code: string } }).error.code).toBe("PUSH_SUBSCRIPTION_NOT_CONTINUED");
    expect(await devicesOf(bystander)).toEqual([]);
    expect((await devicesOf(person))[1]).toMatchObject({ endpoint: replacement.endpoint, revoked: false });
  });

  it("turns off the device that was named, and every device only when asked in so many words", async () => {
    const person = await someone();
    const neighbour = await someone();
    const theirs = await turnOn(neighbour);
    const phone = await turnOn(person);
    const laptop = await turnOn(person);

    // No device named. This used to mean "all of them", so a browser that had lost its own
    // subscription and pressed "turn off" silenced the person's other phone.
    const vague = await DELETE(call("DELETE", {}));
    expect(vague.status).toBe(400);
    expect((await devicesOf(person)).filter((row) => !row.revoked)).toHaveLength(2);

    // Somebody else's device: nothing happens, and nothing is revealed about whether it exists.
    expect(await (await DELETE(call("DELETE", { endpoint: theirs.endpoint }))).json()).toEqual({ revoked: true, devices: 0 });
    expect((await devicesOf(neighbour))[0]).toMatchObject({ revoked: false });

    expect(await (await DELETE(call("DELETE", { endpoint: phone.endpoint }))).json()).toEqual({ revoked: true, devices: 1 });
    expect(await devicesOf(person)).toEqual([
      // Revoked, not deleted: the record that it was once registered is what somebody will ask for.
      { endpoint: phone.endpoint, revoked: true, last_error: "unsubscribed_by_owner", delivered: false },
      { endpoint: laptop.endpoint, revoked: false, last_error: null, delivered: false },
    ]);

    await turnOn(person);
    expect(await (await DELETE(call("DELETE", { all: true }))).json()).toEqual({ revoked: true, devices: 2 });
    expect((await devicesOf(person)).filter((row) => !row.revoked)).toEqual([]);
    expect((await devicesOf(neighbour))[0]).toMatchObject({ revoked: false });
  });
});

describe("the test button says what the push service answered", () => {
  const test = (endpoint: unknown) => SEND_TEST(call("POST", { endpoint }, {}, "/api/account/push/test"));

  it("sends fixed text to the caller's own device, and records that it arrived", async () => {
    const person = await someone();
    const phone = await turnOn(person);
    const service = pushService();
    world.sender = service.send;

    const response = await test(phone.endpoint);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(service.sent).toEqual([{
      endpoint: phone.endpoint,
      title: "Annapurna Link",
      body: "Test notification. This device is set up to receive updates from your account.",
      href: "/app/notifications",
    }]);
    expect((await devicesOf(person))[0]).toMatchObject({ revoked: false, delivered: true });
    // A test is not an event. It must not appear in anybody's list or reach their email.
    expect(await notificationsOf(person)).toEqual([]);
    expect(world.rateLimit).toHaveBeenCalledWith(expect.objectContaining({ bucket: "push-test", userId: person, userMax: 5 }));
  });

  it("cannot be pointed at somebody else's device", async () => {
    const owner = await someone();
    const stranger = await someone();
    const phone = await turnOn(owner);
    const service = pushService();
    world.sender = service.send;

    world.signedInAs = stranger;
    const response = await test(phone.endpoint);
    expect(await response.json()).toEqual({ status: "not_registered" });
    expect(service.sent).toEqual([]);
  });

  it("retires a device whose subscription the push service no longer knows, and keeps one that is merely unreachable", async () => {
    const person = await someone();
    const expired = await turnOn(person, "gone");
    const unlucky = await turnOn(person, "down");
    world.sender = pushService().send;

    expect(await (await test(expired.endpoint)).json()).toEqual({ status: "gone" });
    expect(await (await test(unlucky.endpoint)).json()).toEqual({ status: "failed" });
    expect(await devicesOf(person)).toEqual([
      { endpoint: expired.endpoint, revoked: true, last_error: "push_service_410", delivered: false },
      { endpoint: unlucky.endpoint, revoked: false, last_error: "push_service_503", delivered: false },
    ]);
  });

  it("refuses when the limiter refuses, when nothing is named, and when nobody is signed in", async () => {
    const person = await someone();
    const phone = await turnOn(person);
    const service = pushService();
    world.sender = service.send;

    world.rateLimit.mockRejectedValueOnce(new HttpError(429, "Too many attempts. Wait a little and try again.", "RATE_LIMITED"));
    expect((await test(phone.endpoint)).status).toBe(429);
    expect((await test(undefined)).status).toBe(400);
    world.signedInAs = null;
    expect((await test(phone.endpoint)).status).toBe(401);
    expect(service.sent).toEqual([]);
  });
});

describe("what was written gets sent, once, to the person it was written for", () => {
  it("pushes to the person with a device and finishes the notification of the person without one", async () => {
    const withPhone = await someone();
    const withoutPhone = await someone();
    const phone = await turnOn(withPhone);
    await notify(withPhone, "A Receiver accepted your offer");
    await notify(withoutPhone, "A delivery needs a Helper");
    const service = pushService();

    const result = await drain(service);
    expect(result).toEqual({ configured: true, considered: 2, delivered: 1, failed: 0, revoked: 0, deferred: 0 });
    expect(service.sent).toEqual([{
      endpoint: phone.endpoint,
      title: "A Receiver accepted your offer",
      body: "Collect within 45 minutes.",
      href: "/app/offers",
    }]);
    expect(await notificationsOf(withPhone)).toEqual([
      { title: "A Receiver accepted your offer", outcome: "delivered", finished: true, attempts: 1 },
    ]);
    // Finished, and honestly labelled. Left pending it would be claimed again on every pass for a
    // quarter of an hour, and turning push on would replay it onto the new device.
    expect(await notificationsOf(withoutPhone)).toEqual([
      { title: "A delivery needs a Helper", outcome: "no_device", finished: true, attempts: 1 },
    ]);

    // Nothing is sent twice.
    expect(await drain(service)).toMatchObject({ considered: 0 });
    expect(service.sent).toHaveLength(1);
  });

  it("delivers to the device that still works and retires the one that is gone", async () => {
    const person = await someone();
    const reinstalled = await turnOn(person, "gone");
    const working = await turnOn(person, "ok");
    await notify(person, "Food has been collected");
    const service = pushService();

    expect(await drain(service)).toMatchObject({ considered: 1, delivered: 1, revoked: 1, failed: 0, deferred: 0 });
    expect(await devicesOf(person)).toEqual([
      { endpoint: reinstalled.endpoint, revoked: true, last_error: "push_service_410", delivered: false },
      { endpoint: working.endpoint, revoked: false, last_error: null, delivered: true },
    ]);
    expect((await notificationsOf(person))[0]).toMatchObject({ outcome: "delivered", finished: true });
  });

  it("leaves a notification pending while the push service is down, and sends it when it recovers", async () => {
    const person = await someone();
    const phone = await turnOn(person, "down");
    await notify(person, "A Helper is assigned");
    const down = pushService();

    // Tried, and tried once more straight away. Neither was accepted.
    expect(await drain(down)).toEqual({ configured: true, considered: 1, delivered: 0, failed: 1, revoked: 0, deferred: 1 });
    expect(down.sent).toHaveLength(2);
    // This is the case that used to be written down as delivered: the notification was marked whatever
    // the push service said, so a bad minute lost it for good.
    expect(await notificationsOf(person)).toEqual([
      { title: "A Helper is assigned", outcome: null, finished: false, attempts: 1 },
    ]);
    // And a bad minute is not a dead device.
    expect(await devicesOf(person)).toEqual([
      { endpoint: phone.endpoint, revoked: false, last_error: "push_service_503", delivered: false },
    ]);

    // Not hammered: until its retry time nobody picks it up.
    expect(await drain(down)).toMatchObject({ considered: 0 });

    // The push service is back by the time it is due.
    await makeDue();
    const recovered: PushSender = async () => undefined;
    expect(await drainPushOnce(workerPool(database), { sender: recovered, retryDelayMs: 0 }))
      .toMatchObject({ considered: 1, delivered: 1, deferred: 0 });
    expect(await notificationsOf(person)).toEqual([
      { title: "A Helper is assigned", outcome: "delivered", finished: true, attempts: 2 },
    ]);
    expect((await devicesOf(person))[0]).toMatchObject({ last_error: null, delivered: true });
  });

  it("asks once more after a passing failure, and does not repeat a request that was refused", async () => {
    const lucky = await someone();
    const refused = await someone();
    const cutOff = await someone();
    const flaky = await turnOn(lucky, "flaky");
    const rejecting = await turnOn(refused, "refused");
    const silent = await turnOn(cutOff, "unreachable");
    await notify(lucky, "First");
    await notify(refused, "Second");
    await notify(cutOff, "Third");
    const service = pushService();

    expect(await drain(service)).toMatchObject({ considered: 3, delivered: 1, failed: 2, revoked: 0, deferred: 2 });
    const tries = (endpoint: string) => service.sent.filter((entry) => entry.endpoint === endpoint).length;
    // 503, then accepted: one bad moment costs nothing.
    expect(tries(flaky.endpoint)).toBe(2);
    // A rejected signature will be rejected identically a second later. Asked once.
    expect(tries(rejecting.endpoint)).toBe(1);
    // No answer at all is a network failure, which is worth one more try.
    expect(tries(silent.endpoint)).toBe(2);
    expect((await devicesOf(refused))[0]).toMatchObject({ revoked: false, last_error: "push_service_403" });
    expect((await devicesOf(cutOff))[0]).toMatchObject({ revoked: false, last_error: "push_service_unreachable" });
  });

  it("turns several notifications for one person into one push", async () => {
    const person = await someone();
    await turnOn(person);
    await notify(person, "A Helper claimed your donation", "Rice and dal has an assigned Helper.");
    await notify(person, "Your donation has been collected", "Rice and dal is on the way.");
    await notify(person, "Delivery verified", "Rice and dal has been received.");
    const service = pushService();

    expect(await drain(service)).toMatchObject({ considered: 3, delivered: 1 });
    // Three entries on a lock screen for one afternoon's delivery is how people turn notifications off.
    expect(service.sent).toHaveLength(1);
    expect(service.sent[0]).toMatchObject({
      title: "A Helper claimed your donation",
      body: "Rice and dal has an assigned Helper. (+2 more)",
    });
    expect((await notificationsOf(person)).map((row) => row.outcome)).toEqual(["delivered", "delivered", "delivered"]);
  });

  it("claims nothing when this process has no key pair, so a process that has one still can", async () => {
    const person = await someone();
    await turnOn(person);
    await notify(person, "Waiting for a sender");

    expect(await drainPushOnce(workerPool(database), { sender: null }))
      .toEqual({ configured: false, considered: 0, delivered: 0, failed: 0, revoked: 0, deferred: 0 });
    expect(await notificationsOf(person)).toEqual([
      { title: "Waiting for a sender", outcome: null, finished: false, attempts: 0 },
    ]);
    const service = pushService();
    expect(await drain(service)).toMatchObject({ considered: 1, delivered: 1 });
  });

  it("stops hammering after five tries", async () => {
    const person = await someone();
    await turnOn(person, "down");
    await notify(person, "Push service never came back");
    const service = pushService();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await makeDue();
      expect(await drain(service)).toMatchObject({ considered: 1, deferred: 1 });
    }
    const state = await database.query<{ attempts: number; retry_in: number; finished: boolean }>(`
      SELECT push_attempts AS attempts, push_delivered_at IS NOT NULL AS finished,
        round(extract(epoch FROM push_next_attempt_at - clock_timestamp()))::int AS retry_in
      FROM public.notifications WHERE user_id = $1
    `, [person]);
    // Pushed out past the end of the fifteen-minute window. It was never called delivered; it simply
    // stays in the list and the email, which were always the record.
    expect(state.rows[0]).toMatchObject({ attempts: 5, finished: false });
    expect(state.rows[0]!.retry_in).toBeGreaterThan(3_000);
  });

  it("hands back what it did not get to when it runs out of time", async () => {
    const person = await someone();
    await turnOn(person);
    await notify(person, "Reached on the next pass");
    const service = pushService();

    // A budget that is already spent: a serverless function near its limit.
    expect(await drain(service, { budgetMs: -1 })).toMatchObject({ considered: 1, delivered: 0, deferred: 1 });
    expect(service.sent).toEqual([]);
    // Straight back - no lease to wait out - and not counted as a try, because it was not one.
    expect(await notificationsOf(person)).toEqual([
      { title: "Reached on the next pass", outcome: null, finished: false, attempts: 0 },
    ]);
    expect(await drain(service)).toMatchObject({ considered: 1, delivered: 1 });
    expect(service.sent).toHaveLength(1);
  });

  it("does not send twice when two senders overlap", async () => {
    const person = await someone();
    const phone = await turnOn(person);
    await notify(person, "Only once");

    // The hosted site sends from whichever requests happen to finish, so two senders overlapping is
    // the normal case, not the rare one. The second starts while the first is in the middle of its
    // send - the moment at which "read what is unsent, mark it afterwards" hands both the same row.
    const second = pushService();
    let overlapping: Awaited<ReturnType<typeof drain>> | null = null;
    const sentByFirst: string[] = [];
    const first: PushSender = async (target) => {
      sentByFirst.push(target.endpoint);
      overlapping = await drain(second);
    };

    expect(await drainPushOnce(workerPool(database), { sender: first, retryDelayMs: 0 }))
      .toMatchObject({ considered: 1, delivered: 1 });
    expect(overlapping).toMatchObject({ considered: 0, delivered: 0 });
    expect(sentByFirst).toEqual([phone.endpoint]);
    expect(second.sent).toEqual([]);
  });
});
