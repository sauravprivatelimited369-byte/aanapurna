/**
 * Browser-side helpers for device notifications. No server imports: this file ships to the browser.
 */

export const SERVICE_WORKER_URL = "/sw.js";

export function pushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
    && window.isSecureContext;
}

/**
 * An iPhone or iPad, including an iPad that introduces itself as a Mac.
 *
 * Matters because Safari on these devices only offers notifications to a site that has been added to
 * the Home Screen. In a normal tab the Push API is simply absent, and "this browser cannot receive
 * notifications" would send somebody away from a device that can.
 */
export function looksLikeAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(agent)) return true;
  return /Macintosh/i.test(agent) && navigator.maxTouchPoints > 1;
}

/** Opened from the Home Screen icon rather than in a browser tab. */
export function runningAsInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
}

function toBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The same value the server computes for a registered endpoint.
 *
 * The server never sends an endpoint back - it is a credential - so this is how a browser finds its own
 * subscription in the list of devices on the account: by hashing what it holds and comparing.
 */
export async function fingerprintOf(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return toBase64Url(new Uint8Array(digest));
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalised = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** The subscription this browser profile is holding for this site, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Settle with `fallback` if `task` has not settled in time. Never rejects. */
export function withinTime<T>(task: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    task.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/**
 * Stop this browser receiving notifications for the account that is about to sign out.
 *
 * A push subscription belongs to the browser, not to the session. Left alone, a phone that somebody
 * signed out of keeps showing that person's notifications on its lock screen - to whoever holds it
 * next. So signing out retires the device on the server, while the session can still say whose it is,
 * and then drops the browser's subscription so the endpoint stops working altogether.
 *
 * Bounded and silent. Signing out is the thing the person asked for; nothing here may delay it by more
 * than a moment or stop it. If the server call does not land, dropping the subscription still ends
 * delivery: the push service refuses the old endpoint and the server retires it on the next attempt.
 */
export async function releaseDeviceOnSignOut(): Promise<void> {
  await withinTime((async () => {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await withinTime(fetch("/api/account/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      keepalive: true,
    }).then(() => undefined), 2_500, undefined);
    await subscription.unsubscribe();
  })(), 4_000, undefined);
}
