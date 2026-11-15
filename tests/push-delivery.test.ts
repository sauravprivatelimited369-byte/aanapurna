import { describe, expect, it } from "vitest";
import { buildPushPayload, classifyPushFailure } from "@/push/deliver";
import { deviceLabelOf, isUsableEndpoint } from "@/app/api/account/push/route";

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
});
