import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPushPayload,
  classifyPushFailure,
  sendToDevices,
  worthRetryingNow,
  type PushSender,
  type PushTarget,
} from "@/push/deliver";
import { fingerprintOf } from "@/lib/push-client";
import { deviceLabelOf, endpointFingerprint, isUsableEndpoint, parseSubscription, pushServiceOf } from "@/push/subscription";
import { pushConfigured, vapidKeys } from "@/push/vapid";

/**
 * The rules that decide whether a device keeps getting notifications.
 *
 * These are pure functions on purpose: the interesting decisions here are about *when to stop* pushing
 * to a device, and that is the part worth pinning without a browser or a push service.
 */
describe("a dead device is revoked, a bad minute is not", () => {
  it("treats 404 and 410 as gone", () => {
    // 404: the push service has no such subscription. 410: the browser explicitly unsubscribed.
    expect(classifyPushFailure(404)).toBe("gone");
    expect(classifyPushFailure(410)).toBe("gone");
  });

  it("treats rate limiting and server errors as transient", () => {
    // Revoking on these would silently unsubscribe somebody because a push service had a bad minute.
    expect(classifyPushFailure(429)).toBe("retry");
    expect(classifyPushFailure(500)).toBe("retry");
    expect(classifyPushFailure(503)).toBe("retry");
    // A failure with no status at all (a network error) must not be read as "device is dead".
    expect(classifyPushFailure(undefined)).toBe("retry");
  });

  it("asks again straight away only when the answer could be different", () => {
    // The push service could not take the message right now, or never answered.
    for (const status of [undefined, 408, 429, 500, 502, 503, 504]) expect(worthRetryingNow(status), String(status)).toBe(true);
    // A rejected signature, a malformed request, a payload that is too large: the same answer a second
    // later. Asking twice only doubles the load on a push service that already said no.
    for (const status of [400, 401, 403, 413]) expect(worthRetryingNow(status), String(status)).toBe(false);
  });
});

describe("every device gets its own answer", () => {
  const device = (name: string): PushTarget => ({ id: name, endpoint: `https://push.example.test/${name}`, p256dh: "key", auth: "auth" });
  const payload = { title: "Offer expiring", body: "Collect within 45 minutes.", href: "/app/offers" };
  const refuse = (statusCode?: number) => Object.assign(new Error("push service"), statusCode === undefined ? {} : { statusCode });

  it("reports delivered, gone and failed separately, and one bad device never stops the others", async () => {
    const send: PushSender = async (target) => {
      if (target.id === "reinstalled") throw refuse(410);
      if (target.id === "never-existed") throw refuse(404);
      if (target.id === "bad-minute") throw refuse(503);
      if (target.id === "cut-off") throw refuse();
      if (target.id === "bad-signature") throw refuse(403);
    };
    const answers = await sendToDevices(
      send,
      ["phone", "reinstalled", "never-existed", "bad-minute", "cut-off", "bad-signature"].map(device),
      payload,
      { retryDelayMs: 0 },
    );
    expect(answers).toEqual([
      { id: "phone", outcome: "delivered", reason: null },
      { id: "reinstalled", outcome: "gone", reason: "push_service_410" },
      { id: "never-existed", outcome: "gone", reason: "push_service_404" },
      // Not "delivered". This is the answer the old sender threw away: it returned normally whatever
      // happened, and the notification was then recorded as sent.
      { id: "bad-minute", outcome: "failed", reason: "push_service_503" },
      { id: "cut-off", outcome: "failed", reason: "push_service_unreachable" },
      { id: "bad-signature", outcome: "failed", reason: "push_service_403" },
    ]);
  });

  it("tries a passing failure once more, and a refusal only once", async () => {
    const tries = new Map<string, number>();
    const send: PushSender = async (target) => {
      const attempt = (tries.get(target.id) ?? 0) + 1;
      tries.set(target.id, attempt);
      if (target.id === "recovers" && attempt === 1) throw refuse(503);
      if (target.id === "stays-down") throw refuse(503);
      if (target.id === "refused") throw refuse(400);
    };
    const answers = await sendToDevices(send, ["recovers", "stays-down", "refused"].map(device), payload, { retryDelayMs: 0 });
    expect(answers.map((answer) => answer.outcome)).toEqual(["delivered", "failed", "failed"]);
    expect(Object.fromEntries(tries)).toEqual({ recovers: 2, "stays-down": 2, refused: 1 });

    // The immediate retry can be turned off by a caller with no time for it.
    tries.clear();
    await sendToDevices(send, [device("stays-down")], payload, { retryDelayMs: -1 });
    expect(tries.get("stays-down")).toBe(1);
  });

  it("sends the same bounded, site-relative message to each device and never throws", async () => {
    const seen: string[] = [];
    const send: PushSender = async (_target, message) => {
      seen.push(message);
      throw new TypeError("something unexpected inside the sender");
    };
    const answers = await sendToDevices(send, [device("a"), device("b")], { title: "t".repeat(400), body: "b", href: "https://evil.example" }, { retryDelayMs: 0 });
    // An unexpected error is a failure to report, not an exception to leak: the caller is in the
    // middle of a batch and has other people's notifications to record.
    expect(answers.map((answer) => answer.outcome)).toEqual(["failed", "failed"]);
    expect(new Set(seen).size).toBe(1);
    expect(JSON.parse(seen[0]!)).toEqual({ title: "t".repeat(120), body: "b", href: "/app" });
    expect(await sendToDevices(send, [], payload)).toEqual([]);
  });

  it("never puts the endpoint, or anything the push service said, in a reason", async () => {
    const send: PushSender = async () => {
      throw Object.assign(new Error("Received unexpected response code"), {
        statusCode: 500,
        endpoint: "https://push.example.test/secret-token",
        body: "<html>internal push service error page</html>",
      });
    };
    const [answer] = await sendToDevices(send, [device("secret-token")], payload, { retryDelayMs: 0 });
    // The reason is stored beside the device and may be shown to an operator.
    expect(answer!.reason).toBe("push_service_500");
  });
});

describe("the payload a lock screen will show", () => {
  it("carries a site-relative path and falls back rather than trusting the input", () => {
    expect(JSON.parse(buildPushPayload("Offer", "Expiring", "/app/offers")).href).toBe("/app/offers");
    // An absolute URL in a push payload is how a notification becomes a redirect somewhere else.
    expect(JSON.parse(buildPushPayload("Offer", "Expiring", "https://evil.example")).href).toBe("/app");
    expect(JSON.parse(buildPushPayload("Offer", "Expiring", "//evil.example")).href).toBe("/app");
    expect(JSON.parse(buildPushPayload("Offer", "Expiring", null)).href).toBe("/app");
  });

  it("bounds what a lock screen has to hold", () => {
    const payload = JSON.parse(buildPushPayload("t".repeat(400), "b".repeat(900), "/app"));
    expect(payload.title.length).toBe(120);
    expect(payload.body.length).toBe(240);
  });
});

describe("counting devices without fingerprinting people", () => {
  it("labels a device coarsely, never with the raw user agent", () => {
    expect(deviceLabelOf("Mozilla/5.0 (Linux; Android 14) Chrome/120")).toBe("Chrome on Android");
    expect(deviceLabelOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605")).toBe("Safari on iOS");
    expect(deviceLabelOf("Mozilla/5.0 (Windows NT 10.0) Firefox/120")).toBe("Firefox on Windows");
    expect(deviceLabelOf(undefined)).toBe("Browser on device");
    // Whatever it is, it is short: the raw header is a long fingerprint and is never stored.
    expect(deviceLabelOf("x".repeat(400)).length).toBeLessThanOrEqual(30);
  });
});

describe("the endpoint this server will POST to", () => {
  it("accepts only a real https URL", () => {
    expect(isUsableEndpoint("https://fcm.googleapis.com/fcm/send/abc123")).toBe(true);
    // Anything else is an SSRF primitive: this server sends signed requests to whatever it is given.
    expect(isUsableEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isUsableEndpoint("/relative")).toBe(false);
    expect(isUsableEndpoint("file:///etc/passwd")).toBe(false);
    expect(isUsableEndpoint("not a url")).toBe(false);
    expect(isUsableEndpoint(null)).toBe(false);
    expect(isUsableEndpoint(42)).toBe(false);
  });

  it("accepts the address every mainstream browser's push service hands out", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/dGhpcyBpcyBhIHRva2Vu:APA91b",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl",
      "https://web.push.apple.com/QGuOvMzRkT",
      "https://wns2-pn1p.notify.windows.com/w/?token=BQYAAAD",
      "https://FCM.googleapis.com./fcm/send/abc",
    ]) expect(isUsableEndpoint(endpoint), endpoint).toBe(true);
  });

  it("refuses an address that is https and still not a push service", () => {
    // With a test button, sending to a registered endpoint is something a signed-in person can ask
    // for on demand. A browser's push service is always a public name on the default port; these are
    // this server being pointed at itself, at a neighbour, or at a port that is not a web server.
    for (const endpoint of [
      "https://127.0.0.1/push/x",
      "https://2130706433/push/x",          // the same address, written as one number
      "https://0x7f.1/push/x",              // and in hex
      "https://[::1]/push/x",
      "https://[fd00::1]/push/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/push/x",
      "https://LOCALHOST./push/x",
      "https://app.localhost/push/x",
      "https://intranet/push/x",
      "https://fcm.googleapis.com:8443/fcm/send/x",
      "https://user:secret@fcm.googleapis.com/fcm/send/x",
    ]) expect(isUsableEndpoint(endpoint), endpoint).toBe(false);
    expect(isUsableEndpoint(`https://fcm.googleapis.com/${"x".repeat(2100)}`)).toBe(false);
  });
});

describe("what a browser hands over when it subscribes", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
  const p256dh = "BPm3n1rYtJ8sQf0aXc2dLw7eVh4uKz9oGi6yTb5NjR1pSx3CqWm8ZvEa0DlHgUkFyOs2IrAeBn4Mt7Jc6Xd9Lw";
  const auth = "c2VjcmV0LWF1dGgtMDE";

  it("reads exactly what PushSubscription.toJSON() produces", () => {
    expect(parseSubscription({ endpoint, expirationTime: null, keys: { p256dh, auth } })).toEqual({ endpoint, p256dh, auth });
    // Padded, standard base64 is the same key written differently. Nothing is gained by refusing it.
    expect(parseSubscription({ endpoint, keys: { p256dh: `${p256dh}=`, auth: "c2VjcmV0+XV0aC0wMDE/" } })).not.toBeNull();
  });

  it("returns null rather than letting a malformed key reach the database", () => {
    // The table has length constraints. A value that trips one comes back as a database error - a 500
    // with a request reference - when the truth is simply that the browser sent something unusable.
    for (const body of [
      null,
      "text",
      {},
      { endpoint },
      { endpoint, keys: null },
      { endpoint, keys: { p256dh } },
      { endpoint, keys: { p256dh: "short", auth } },
      { endpoint, keys: { p256dh, auth: "x" } },
      { endpoint, keys: { p256dh: `${p256dh} `, auth } },
      { endpoint, keys: { p256dh: "x".repeat(201), auth } },
      { endpoint, keys: { p256dh, auth: 42 } },
      { endpoint: "http://fcm.googleapis.com/x", keys: { p256dh, auth } },
    ]) expect(parseSubscription(body), JSON.stringify(body)).toBeNull();
  });

  it("names a registered endpoint the same way on the server and in the browser", async () => {
    // The server never sends an endpoint back, so the page finds its own subscription in the device
    // list by hashing what it holds. If the two sides ever disagree, a browser that is registered
    // shows "off" - and pressing the button registers it again, for ever.
    for (const value of [endpoint, "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl-ünïcödé?x=1"]) {
      expect(await fingerprintOf(value)).toBe(endpointFingerprint(value));
    }
    expect(endpointFingerprint(endpoint)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(endpointFingerprint(endpoint)).not.toContain("abc123");
    // And the part of an endpoint that is shown is the push service, never the device's token.
    expect(pushServiceOf(endpoint)).toBe("fcm");
    expect(pushServiceOf("not a url")).toBe("");
  });
});

describe("a key pair that cannot sign is not a configured deployment", () => {
  afterEach(() => vi.unstubAllEnvs());

  const configure = (subject: string | undefined) => {
    vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "B".repeat(87));
    vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "p".repeat(43));
    if (subject === undefined) vi.stubEnv("WEB_PUSH_SUBJECT", "");
    else vi.stubEnv("WEB_PUSH_SUBJECT", subject);
  };

  it("accepts a contact a push service will accept", () => {
    configure("https://annapurna-link.vercel.app");
    expect(pushConfigured()).toBe(true);
    configure("mailto:operations@annapurna.example");
    expect(vapidKeys()?.subject).toBe("mailto:operations@annapurna.example");
    configure(undefined);
    expect(vapidKeys()?.subject).toMatch(/^mailto:/);
  });

  it("is off, rather than failing on every send, when the contact is not a mailto: or https: address", () => {
    // The signing step refuses anything else. A bare email address here left the button looking live
    // while every single push failed before it left this server.
    for (const subject of ["operations@annapurna.example", "http://annapurna.example", "annapurna.example"]) {
      configure(subject);
      expect(pushConfigured(), subject).toBe(false);
    }
  });
});

describe("the security policy allows the worker that shows a notification", () => {
  it("names worker-src explicitly rather than relying on default-src", async () => {
    // `navigator.serviceWorker.register("/sw.js")` is governed by worker-src. It happens to be covered
    // by `default-src 'self'` today, which is exactly why it needs naming: a future tightening of the
    // default would silently switch off device notifications, and nothing would fail until somebody
    // noticed they were not arriving.
    const { buildCsp, buildPreRenderedCsp } = await import("@/proxy");
    expect(buildCsp("test-nonce", { upgradeInsecureRequests: false })).toContain("worker-src 'self'");
    expect(buildPreRenderedCsp({ upgradeInsecureRequests: false })).toContain("worker-src 'self'");
  });

  it("names manifest-src too: on an iPhone the installed app is the only place notifications exist", async () => {
    // Apple offers web notifications only to a site that was added to the Home Screen, and it is the
    // manifest that makes the site installable as an app. Covered by the default today, for the same
    // reason worth naming.
    const { buildCsp, buildPreRenderedCsp } = await import("@/proxy");
    expect(buildCsp("test-nonce", { upgradeInsecureRequests: false })).toContain("manifest-src 'self'");
    expect(buildPreRenderedCsp({ upgradeInsecureRequests: false })).toContain("manifest-src 'self'");
  });
});
