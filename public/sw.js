/**
 * The service worker that turns a push into something a phone shows.
 *
 * Deliberately tiny, and deliberately not a cache. This worker exists for one job: receive a push and
 * show a notification. Registering a cache-first service worker on a product where a stale page could
 * show a food offer that has already been collected would be a much larger risk than the one it solves.
 *
 * Two things it does carefully:
 *
 * 1. **The URL is resolved against this origin.** The payload carries a site-relative path, and the
 *    worker refuses anything else. A push payload is attacker-influenced in principle, and an absolute
 *    URL here is how a notification becomes a redirect to somewhere else.
 * 2. **It always shows something.** A notification event that completes without calling
 *    `showNotification` makes some browsers display a generic "this site has been updated in the
 *    background" message, which tells a person nothing and looks broken.
 */

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
    event.waitUntil(self.registration.showNotification("Annapurna Link", { body, tag: "annapurna-link" }));
    return;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
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
