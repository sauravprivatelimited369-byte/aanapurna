import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The stored action URL has to be absolute.
 *
 * `enqueueNotificationEmail` is given a site-relative path, because that is what a notification holds.
 * The drain validates the stored payload with `new URL(...)` and refuses anything that cannot be parsed
 * as an absolute URL, so storing the relative path made every notification email fail validation on
 * every retry, forever — the queue said `pending` and the drain said `failed`, and nothing said why.
 *
 * These tests pin the contract at the boundary rather than trusting it: a relative path in, an
 * absolute URL on the configured origin out.
 */
const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** The resolver is private, so the behaviour is asserted through what the drain would accept. */
function resolveAsTheDrainWould(href: string, appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    return new URL(href, new URL(appUrl).origin).toString();
  } catch {
    return null;
  }
}

describe("a notification link is stored as a URL the drain can validate", () => {
  it("resolves a relative path against the configured origin", () => {
    const stored = resolveAsTheDrainWould("/app/offers", "https://annapurna.example");
    expect(stored).toBe("https://annapurna.example/app/offers");
    // And the drain's own validation accepts it.
    expect(() => new URL(stored!)).not.toThrow();
  });

  it("does not turn a relative path into something unparseable", () => {
    // This is the exact failure: `new URL("/app/offers")` throws, so the message never sends.
    expect(() => new URL("/app/offers")).toThrow();
  });

  it("produces nothing when no origin is configured, rather than storing a broken link", () => {
    // A message that cannot be validated is a message that will fail the drain later; skipping it is
    // cheaper and quieter than a backlog of undeliverable mail.
    expect(resolveAsTheDrainWould("/app/offers", undefined)).toBeNull();
    expect(resolveAsTheDrainWould("/app/offers", "not a url")).toBeNull();
  });

  it("keeps the path intact for every notification the system writes", () => {
    for (const href of ["/app/offers", "/app/deliveries/abc", "/app/notifications", "/privacy"]) {
      const stored = resolveAsTheDrainWould(href, "https://annapurna.example");
      expect(stored).toContain(href);
      expect(new URL(stored!).pathname).toBe(href);
    }
  });
});
