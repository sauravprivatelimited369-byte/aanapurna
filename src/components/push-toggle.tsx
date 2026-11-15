"use client";

import { useCallback, useEffect, useState } from "react";
import {
  base64UrlToBytes,
  currentSubscription,
  fingerprintOf,
  looksLikeAppleMobile,
  pushSupported,
  runningAsInstalledApp,
  SERVICE_WORKER_URL,
  withinTime,
} from "@/lib/push-client";

/**
 * The control that asks a person whether notifications may reach this device.
 *
 * The states are not interchangeable, and each one has to say something a person can act on:
 *
 * - **unsupported** — the browser has no Push API, or the page is not on https. Saying "enable" would
 *   be a button that cannot work. An in-app browser (a link opened inside a chat app) is the common
 *   case, so the note says to open the site in a real browser.
 * - **needs-install** — an iPhone or iPad in a Safari tab. Notifications exist there only for a site
 *   that was added to the Home Screen, so the note says how, instead of "cannot".
 * - **not-configured** — this deployment has no key pair. Nothing the person does will change that.
 * - **blocked** — the person said no, at the browser level. A page cannot undo that; only the browser
 *   settings can. Telling somebody to press a button that silently does nothing is the worst option,
 *   so this says where to change it.
 * - **off / on** — whether *this browser is registered to the account that is signed in*, according to
 *   the server. Not whether the browser happens to hold a subscription: a subscription the server does
 *   not have - left by another account on a shared phone, or retired because the push service said it
 *   was gone - receives nothing, and showing "on" for it would be a promise nobody keeps.
 *
 * The subscription key travels from the server (`publicKey`) rather than being baked into the bundle,
 * so rotating the key pair is a configuration change rather than a redeploy.
 */

type State = "loading" | "unsupported" | "needs-install" | "not-configured" | "blocked" | "off" | "on" | "denied-server";
type Device = { label: string | null; service: string; fingerprint: string };
type Status = { configured: boolean; publicKey: string | null; devices: Device[] };
type Failure = { error?: { message?: string } };

const JSON_HEADERS = { "Content-Type": "application/json" };

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [mine, setMine] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // Everything below resolves through an await before it sets state, so the first paint is never a
    // synchronous cascade from the effect that calls this.
    await Promise.resolve();
    if (!pushSupported()) {
      setState(looksLikeAppleMobile() && !runningAsInstalledApp() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    try {
      const response = await fetch("/api/account/push", { cache: "no-store" });
      if (!response.ok) { setState("denied-server"); return; }
      const body = await response.json() as Status;
      const registered = Array.isArray(body.devices) ? body.devices : [];
      setPublicKey(body.publicKey);
      setDevices(registered);
      if (!body.configured || !body.publicKey) { setState("not-configured"); return; }
      const subscription = await currentSubscription();
      const fingerprint = subscription ? await fingerprintOf(subscription.endpoint) : null;
      const known = fingerprint !== null && registered.some((device) => device.fingerprint === fingerprint);
      setMine(known ? fingerprint : null);
      setState(known ? "on" : "off");
    } catch {
      setState("denied-server");
    }
  }, []);

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
      const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
      // A worker that never activates would otherwise leave this button saying "Working…" for ever.
      const active = await withinTime(navigator.serviceWorker.ready.then(() => true), 15_000, false);
      if (!active) throw new Error("The service worker did not activate.");

      // "Off" means the server does not have this browser registered to this account. So whatever the
      // browser is still holding is somebody else's, or expired, or was made with a key pair that has
      // since been rotated - and subscribing again would hand that same one back, or fail outright on
      // the key mismatch. Start clean: a new subscription has a new endpoint and cannot be any of those.
      const leftover = await registration.pushManager.getSubscription();
      if (leftover) await leftover.unsubscribe().catch(() => false);

      const subscription = await registration.pushManager.subscribe({
        // Required by every browser: the push must result in something the person can see.
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey) as BufferSource,
      });
      const response = await fetch("/api/account/push", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        // Keep the browser and the server in agreement: neither has this device.
        await subscription.unsubscribe().catch(() => false);
        const body = await response.json().catch(() => ({})) as Failure;
        setMessage(body.error?.message ?? "This device could not be registered.");
        setState("off");
        return;
      }
      await refresh();
      setMessage("This device will now show notifications, even when the site is closed. Send a test to watch one arrive.");
    } catch {
      // A failed subscribe is usually a permission race or a service worker that did not activate.
      // It is reported plainly rather than as a stack trace.
      setMessage("This device could not be registered for notifications. Try again, or check the browser's notification settings.");
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable(everywhere: boolean) {
    setBusy(true); setMessage(null);
    try {
      const subscription = await currentSubscription();
      if (everywhere || subscription) {
        // The server first, while the endpoint still identifies the row. If this does not land the
        // device still stops: the browser drops the subscription below, the push service refuses the
        // old endpoint, and the server retires it the next time it tries.
        await fetch("/api/account/push", {
          method: "DELETE",
          headers: JSON_HEADERS,
          body: JSON.stringify(everywhere ? { all: true } : { endpoint: subscription!.endpoint }),
        }).catch(() => null);
      }
      if (subscription) await subscription.unsubscribe();
      await refresh();
      setMessage(everywhere
        ? "Notifications are now off on every device registered to your account."
        : "This device will no longer receive notifications.");
    } catch {
      setMessage("This device could not be unsubscribed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true); setMessage(null);
    try {
      const subscription = await currentSubscription();
      if (!subscription) {
        await refresh();
        setMessage("This device is no longer registered. Turn it on again to receive notifications.");
        return;
      }
      const response = await fetch("/api/account/push/test", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const body = await response.json().catch(() => ({})) as Failure & { status?: string };
      if (!response.ok) {
        setMessage(body.error?.message ?? "The test could not be sent. Try again.");
        return;
      }
      if (body.status === "delivered") {
        setMessage("Sent. A notification should appear on this device within a few seconds. If nothing appears, check that notifications from this browser are allowed in the device's own settings and that Do Not Disturb is off.");
      } else if (body.status === "gone") {
        // The push service no longer knows this subscription. The server has retired it; drop the
        // browser's copy too, so that turning it on again starts from a new one.
        await subscription.unsubscribe().catch(() => false);
        await refresh();
        setMessage("This device's registration had expired, so it has been turned off. Turn it on again to receive notifications.");
      } else if (body.status === "not_registered") {
        await refresh();
        setMessage("This device is not registered to your account. Turn it on to receive notifications.");
      } else {
        setMessage("The notification service could not be reached just now. This device is still registered; try again in a minute.");
      }
    } catch {
      setMessage("The test could not be sent. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const thisDevice = mine ? devices.find((device) => device.fingerprint === mine) : undefined;
  const others = devices.filter((device) => device.fingerprint !== mine);

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
            This browser cannot receive notifications. If this page was opened from inside another app,
            open it in Chrome, Firefox, Edge or Samsung Internet instead.
          </span>
        )}

        {state === "needs-install" && (
          <span className="push-toggle__note">
            On an iPhone or iPad, notifications work only once this site is on the Home Screen. In Safari,
            tap Share, then “Add to Home Screen”, open Annapurna Link from the new icon and turn this on
            there. Needs iOS 16.4 or later.
          </span>
        )}

        {state === "not-configured" && (
          <span className="push-toggle__note">Notifications to your device are not configured on this deployment.</span>
        )}

        {state === "blocked" && (
          <span className="push-toggle__note">
            Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload this page.
          </span>
        )}

        {state === "denied-server" && (
          <span className="push-toggle__note">Notification settings could not be read. Reload to try again.</span>
        )}

        {state === "off" && (
          <button type="button" className="button button--primary" onClick={() => void enable()} disabled={busy} aria-busy={busy}>
            {busy ? "Working…" : "Turn on for this device"}
          </button>
        )}

        {state === "on" && (
          <>
            <button type="button" className="button button--primary" onClick={() => void sendTest()} disabled={busy} aria-busy={busy}>
              {busy ? "Working…" : "Send a test notification"}
            </button>
            <button type="button" className="button button--secondary" onClick={() => void disable(false)} disabled={busy}>
              Turn off on this device
            </button>
          </>
        )}
      </div>

      {(state === "on" || state === "off") && devices.length > 0 && (
        <p className="push-toggle__devices">
          {state === "on" ? "On for this device" : "Off for this device"}
          {thisDevice?.label ? ` (${thisDevice.label})` : ""}
          {others.length > 0 && (
            <>
              {". Also on for your account: "}
              {others.map((device) => device.label ?? "Browser on device").join(", ")}
              {". "}
              <button type="button" className="push-toggle__link" onClick={() => void disable(true)} disabled={busy}>
                Turn off on every device
              </button>
            </>
          )}
          {others.length === 0 && "."}
        </p>
      )}

      {message && <p className="push-toggle__message" role="status">{message}</p>}
    </section>
  );
}
