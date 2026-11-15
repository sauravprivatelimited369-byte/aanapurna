/**
 * The service worker that turns a push into something a phone shows.
 *
 * Deliberately tiny, and deliberately not a cache. This worker exists for one job: receive a push and
 * show a notification. Registering a cache-first service worker on a product where a stale page could
 * show a food offer that has already been collected would be a much larger risk than the one it solves.
 *
 * Three things it does carefully:
 *
 * 1. **The URL is resolved against this origin.** The payload carries a site-relative path, and the
 *    worker refuses anything else. A push payload is attacker-influenced in principle, and an absolute
 *    URL here is how a notification becomes a redirect to somewhere else.
 * 2. **It always shows something.** A notification event that completes without calling
 *    `showNotification` makes some browsers display a generic "this site has been updated in the
 *    background" message, which tells a person nothing and looks broken.
 * 3. **It keeps a registration current, and never starts one.** A browser may replace a subscription
 *    by itself, with no page open. The worker tells the server about the replacement only when it can
 *    name the subscription being replaced, and the server accepts it only if that one belongs to the
 *    account signed in on this browser. Turning notifications on remains something a person does with
 *    a button; this only stops them from quietly turning themselves off.
 *
 * It never intercepts a request from a page. The one request it makes is its own, to the server.
 */

// Shown beside the text on Android and desktop. A path on this origin, never a value from the payload.
const ICON = "/icons/icon-192.png";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Annapurna Link";
  const body = typeof data.body === "string" ? data.body.slice(0, 240) : "There is an update on your account.";
  const href = typeof data.href === "string" && data.href.startsWith("/") && !data.href.startsWith("//") ? data.href : "/app";

  const url = new URL(href, self.location.origin);
  // Belt and braces: whatever the path looked like, only this origin may be opened.
  if (url.origin !== self.location.origin) {
    event.waitUntil(self.registration.showNotification("Annapurna Link", { body, icon: ICON, tag: "annapurna-link" }));
    return;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      tag: "annapurna-link",
      renotify: true,
      data: { url: url.toString() },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url ? event.notification.data.url : "/app";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open tab rather than opening a fifth one. Somebody who tapped a notification about a
      // delivery wants that delivery, not another copy of the app.
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const previous = event.oldSubscription || null;
        // Without the old subscription there is nothing to prove this continues a registration somebody
        // chose to make. The Notifications page compares what the browser holds with what the server
        // has each time it is opened, and offers the button again if they differ.
        if (!previous || !previous.endpoint) return;

        let next = event.newSubscription || null;
        if (!next) {
          // Not every browser supplies the replacement. Make one with the key the old one was made with.
          const key = previous.options ? previous.options.applicationServerKey : null;
          if (!key) return;
          next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        }

        const subscription = next.toJSON();
        await self.fetch("/api/account/push", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys, replaces: previous.endpoint }),
        });
      } catch {
        // Nobody is looking and there is nothing useful to show. The page is the recovery path.
      }
    })(),
  );
});
