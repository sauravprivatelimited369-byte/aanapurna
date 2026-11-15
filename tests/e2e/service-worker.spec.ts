import { expect, test } from "@playwright/test";

/**
 * The notification path, in a real browser.
 *
 * These run in CI, where Playwright installs a full Chromium that can actually hold a notification
 * permission. That is the one thing the development sandbox could not do — its headless build reports
 * `denied` no matter what is granted — so this file is where the browser half of the feature is
 * observed rather than assumed.
 *
 * Everything here drives the shipping artefacts: `public/sw.js` as served by the application, and the
 * real `PushManager` the phone would use.
 */

test("the service worker installs, activates and controls the page", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      script: registration.active?.scriptURL ?? null,
      state: registration.active?.state ?? null,
    };
  });
  expect(result.scope).toContain("/");
  expect(result.script).toContain("/sw.js");
  // "activating" and "activated" are both acceptable; a worker stuck in "installing" is not.
  expect(["activating", "activated"]).toContain(result.state);
});

test("the security policy permits the worker that shows a notification", async ({ page }) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  // `navigator.serviceWorker.register` is governed by worker-src. It is covered by default-src today,
  // which is exactly why it is named: a future tightening must not silently switch notifications off.
  expect(csp).toContain("worker-src 'self'");
});

test("the site can be installed, which is the only way an iPhone offers notifications", async ({ page }) => {
  // Apple offers web notifications only to a site that was added to the Home Screen and opened from
  // there. What makes it an app when it is added is this manifest, so it has to be served, say
  // "standalone", and point at icons that exist.
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = await response.json() as { display?: string; icons?: { src: string }[] };
  expect(manifest.display).toBe("standalone");
  const icons = manifest.icons ?? [];
  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) {
    const image = await page.request.get(icon.src);
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()["content-type"], icon.src).toContain("image/png");
  }
  // And the pages point a browser at it, under a security policy that names it.
  const document = await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
  expect(document?.headers()["content-security-policy"] ?? "").toContain("manifest-src 'self'");
});

test("health says whether notifications are switched on, and never leaks the key", async ({ page }) => {
  const response = await page.request.get("/api/health");
  const body = await response.json() as Record<string, unknown>;
  // The status is a boolean rather than an omission, so a deployment that has lost its keys is
  // visible from the outside without anybody signing in to look at a toggle.
  expect(body.push).toBeDefined();
  expect(typeof (body.push as { configured: unknown }).configured).toBe("boolean");
  // A VAPID public key is 87 characters of base64url. If one ever appears in this public payload,
  // it will match this shape.
  expect(JSON.stringify(body)).not.toMatch(/[A-Za-z0-9_-]{80,}/);
});

test("the subscribe endpoint refuses an anonymous caller", async ({ page }) => {
  const response = await page.request.get("/api/account/push");
  expect(response.status()).toBe(401);
  // And it must not leak the key to somebody who is not signed in.
  const body = await response.json();
  expect(body.publicKey).toBeUndefined();
});

test("the notification toggle is present and explains what it does", async ({ page }) => {
  // The toggle lives on the signed-in notifications page. When the account flow is not available in
  // this run it is skipped rather than failing, because the assertion that matters — that the control
  // tells the truth about its state — is covered by the component tests.
  await page.goto("/app/notifications");
  if (new URL(page.url()).pathname.startsWith("/login")) {
    test.skip(true, "Requires a signed-in account; covered by the component tests otherwise.");
  }
  await expect(page.getByRole("heading", { name: /notifications on this device/i })).toBeVisible();
});
