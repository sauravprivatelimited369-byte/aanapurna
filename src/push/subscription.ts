import { createHash } from "node:crypto";

/**
 * What a browser hands over when it subscribes, and the checks that decide whether to keep it.
 *
 * Kept free of the database and the framework so the rules can be tested as plain functions.
 */

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** A short, human label. Not the raw user agent: that is a fingerprint and a long one. */
export function deviceLabelOf(raw: unknown): string {
  const value = typeof raw === "string" ? raw.slice(0, 200) : "";
  const browser = /firefox/i.test(value) ? "Firefox"
    : /edg/i.test(value) ? "Edge"
    : /chrome|chromium/i.test(value) ? "Chrome"
    : /safari/i.test(value) ? "Safari"
    : "Browser";
  const platform = /android/i.test(value) ? "Android"
    : /iphone|ipad|ios/i.test(value) ? "iOS"
    : /windows/i.test(value) ? "Windows"
    : /mac os|macintosh/i.test(value) ? "macOS"
    : /linux/i.test(value) ? "Linux"
    : "device";
  return `${browser} on ${platform}`;
}

/**
 * Whether this server is willing to send signed requests to the address a browser handed it.
 *
 * Every browser's push service is a public DNS name, on https, on the default port, with no
 * credentials in the URL. An endpoint that is anything else was not produced by a browser: it is this
 * server being pointed somewhere - a loopback service, a neighbour on the same network, a port that is
 * not a web server. Refusing those shapes costs no real device anything.
 *
 * It is not an allowlist of push services, deliberately: a browser nobody listed would be told its
 * subscription is unusable, and nothing here would say why.
 */
export function isUsableEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 8 || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "" || url.port !== "") return false;
  // The URL parser has already rewritten every spelling of an IPv4 address (decimal, hex, short
  // forms) to dotted quads, and brackets an IPv6 one, so these two shapes are all there is to check.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return false;
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost")) return false;
  return true;
}

// Browsers serialise both keys as unpadded base64url. Standard base64 is tolerated because nothing is
// gained by refusing it, and the lengths bracket what a P-256 point and a 16-byte secret encode to.
const KEY_MATERIAL = /^[A-Za-z0-9_\-+/]+={0,2}$/;

/**
 * Read a subscription out of a request body, or return null.
 *
 * Refusing a malformed key here matters more than it looks: the table has length constraints, and a
 * value that trips one surfaces as a database error - a 500 with a request reference - when the truth
 * is that the browser sent something unusable.
 */
export function parseSubscription(body: unknown): SubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (!isUsableEndpoint(endpoint)) return null;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (p256dh.length < 40 || p256dh.length > 200 || !KEY_MATERIAL.test(p256dh)) return null;
  if (auth.length < 8 || auth.length > 100 || !KEY_MATERIAL.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/**
 * A stable, non-reversible name for an endpoint.
 *
 * The endpoint is a credential and never goes back to a browser. But a browser does need to answer one
 * question - "is the subscription I am holding registered to the account that is signed in?" - and it
 * can, by hashing its own endpoint and comparing. The client computes the same value with WebCrypto.
 */
export function endpointFingerprint(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("base64url");
}

/** Which push service a device is registered with. The first label of the host, never the path. */
export function pushServiceOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}
