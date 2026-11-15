"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The control that asks a person whether notifications may reach this device.
 *
 * Three states matter and they are not the same thing:
 *
 * - **unsupported** — the browser has no Push API, or the page is not on https. Saying "enable" would
 *   be a button that cannot work.
 * - **blocked** — the person said no, at the browser level. A page cannot undo that; only the browser
 *   settings can. Telling somebody to press a button that silently does nothing is the worst option,
 *   so this says where to change it.
 * - **off / on** — permission granted or not yet asked.
 *
 * The subscription key travels from the server (`publicKey`) rather than being baked into the bundle,
 * so rotating the key pair is a configuration change rather than a redeploy.
 */

type State = "loading" | "unsupported" | "blocked" | "off" | "on" | "denied-server";

function base64ToBytes(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalised = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [configured, setConfigured] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supported = useCallback(() => {
    return typeof window !== "undefined"
      && "serviceWorker" in navigator
      && "PushManager" in window
      && "Notification" in window
      && window.isSecureContext;
  }, []);

  const refresh = useCallback(async () => {
    // Everything below resolves through an await before it sets state, so the first paint is never a
    // synchronous cascade from this effect. The `queueMicrotask` wrapper is what makes the capability
    // check asynchronous too — without it the unsupported branch sets state during the effect body.
    await Promise.resolve();
    if (!supported()) { setState("unsupported"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    try {
      const response = await fetch("/api/account/push", { cache: "no-store" });
      if (!response.ok) { setState("denied-server"); return; }
      const body = await response.json() as { configured: boolean; publicKey: string | null; devices: unknown[] };
      setConfigured(body.configured);
      setPublicKey(body.publicKey);
      if (!body.configured) { setState("unsupported"); return; }
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const existing = await registration?.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    } catch {
      setState("denied-server");
    }
  }, [supported]);

  useEffect(() => {
    // Deferred by a task rather than called inline: the rule against setting state synchronously in an
    // effect is about the cascade on first paint, and reading the browser's push state is genuinely an
    // external-system query that must happen after mount.
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true); setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Required by every browser: the push must result in something the person can see.
        applicationServerKey: base64ToBytes(publicKey) as BufferSource,
      });
      const keys = subscription.toJSON().keys ?? {};
      const response = await fetch("/api/account/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, keys, deviceLabel: navigator.userAgent }),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
        setMessage(body.error?.message ?? "This device could not be registered.");
        setState("off");
        return;
      }
      setState("on");
      setMessage("This device will now show notifications, even when the site is closed.");
    } catch {
      // A failed subscribe is usually a permission race or a service worker that did not activate.
      // It is reported plainly rather than as a stack trace.
      setMessage("This device could not be registered for notifications. Try again, or check the browser's notification settings.");
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true); setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;
      await subscription?.unsubscribe();
      await fetch("/api/account/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      setState("off");
      setMessage("This device will no longer receive notifications.");
    } catch {
      setMessage("This device could not be unsubscribed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="push-toggle" aria-labelledby="push-toggle-heading">
      <div className="push-toggle__text">
        <h2 id="push-toggle-heading">Notifications on this device</h2>
        <p>
          An offer that expires within the hour is no use if nobody is looking at a screen. Turning this
          on makes this browser or phone show a notification when something happens on your account — a
          new offer, an accepted claim, a delivery to collect — including while the site is closed.
        </p>
      </div>

      <div className="push-toggle__action">
        {state === "loading" && <span className="push-toggle__note">Checking…</span>}

        {state === "unsupported" && (
          <span className="push-toggle__note">
            {configured
              ? "This browser cannot receive notifications."
              : "Notifications to your device are not configured on this deployment."}
          </span>
        )}

        {state === "blocked" && (
          <span className="push-toggle__note">
            Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload this page.
          </span>
        )}

        {state === "denied-server" && (
          <span className="push-toggle__note">Notification settings could not be read. Reload to try again.</span>
        )}

        {(state === "off" || state === "on") && (
          <button
            type="button"
            className={state === "on" ? "button button--secondary" : "button button--primary"}
            onClick={() => (state === "on" ? void disable() : void enable())}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Working…" : state === "on" ? "Turn off on this device" : "Turn on for this device"}
          </button>
        )}
      </div>

      {message && <p className="push-toggle__message" role="status">{message}</p>}
    </section>
  );
}
