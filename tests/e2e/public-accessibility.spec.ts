import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

const impactEndpoint = "**/api/public/impact";
const directoryEndpoint = "**/api/public/restaurant-directory";
const emptyImpact = {
  status: "empty",
  metrics: {
    verifiedServings: 0,
    verifiedDeliveries: 0,
    verifiedOrganizations: 0,
    activeHelpers: 0,
    verifiedGenerators: 0,
  },
};
const directoryFixture = {
  name: "Synthetic directory test listing",
  address: "Public test fixture only",
  locality: "Test locality",
  city: "Test city",
  cuisines: ["Test cuisine"],
  directoryUrl: "https://example.test/directory-fixture",
  observedAt: "2026-11-12T00:00:00Z",
  sources: [{ name: "test fixture", url: null }],
  website: null,
};
const routes = [
  "/",
  "/about",
  "/accessibility",
  "/contact",
  "/food-safety",
  "/how-it-works",
  "/near-iim-calcutta",
  "/privacy",
  "/terms",
  "/signup?role=helper",
  "/login?reason=session-expired",
  "/verify-email?result=verified",
  "/forgot-password",
  "/reset-password",
];

async function fulfill(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test("public and authentication pages pass selected axe checks without viewport overflow", async ({ page }) => {
  await page.route(impactEndpoint, (route) => fulfill(route, emptyImpact));
  await page.route(directoryEndpoint, (route) => fulfill(route, {
    status: "snapshot",
    listing: directoryFixture,
    snapshotCapturedOn: "2026-11-12",
    warning: "Test fixture only; no live listing was requested.",
  }));

  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 840 });
    for (const path of routes) {
      await page.goto(path);
      await expect(page.locator("main").first(), `main content on ${path}`).toBeVisible();
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth, `horizontal overflow on ${path} at ${width}px`).toBeLessThanOrEqual(width);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations,
        `${path} at ${width}px: ${JSON.stringify(results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })), null, 2)}`,
      ).toEqual([]);
    }
  }
});
