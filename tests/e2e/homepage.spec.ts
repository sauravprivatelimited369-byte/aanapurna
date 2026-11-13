import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

const endpoint = "**/api/public/impact";
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

async function fulfill(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("homepage labels verified impact and gives an honest empty state", async ({ page }) => {
  await page.route(endpoint, (route) => fulfill(route, emptyImpact));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /good food deserves a destination/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /impact that can be accounted for/i })).toBeVisible();
  await expect(page.getByText("No verified impact figures yet.")).toBeVisible();
  await expect(page.locator(".impact-card")).toHaveCount(0);
  await expect(page.getByText(/no counts are being estimated/i)).toHaveCount(0);
});

test("local database returns its real empty impact state without a browser mock", async ({ page }) => {
  test.skip(process.env.RUN_DATABASE_IMPACT_E2E !== "true", "Requires the isolated migrated PostgreSQL test database.");
  const response = await page.request.get("/api/public/impact");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(emptyImpact);
  await page.goto("/");
  await expect(page.getByText("No verified impact figures yet.")).toBeVisible();
});

test("impact failure is clear and can be retried", async ({ page }) => {
  let requests = 0;
  let allowSuccess = false;
  await page.route(endpoint, async (route) => {
    requests += 1;
    if (!allowSuccess) {
      await fulfill(route, { status: "unavailable" }, 503);
      return;
    }
    await fulfill(route, emptyImpact);
  });

  await page.goto("/");
  await expect(page.getByText("Verified figures are temporarily unavailable.")).toBeVisible();
  allowSuccess = true;
  await page.getByRole("button", { name: "Retry figures" }).click();
  await expect(page.getByText("No verified impact figures yet.")).toBeVisible();
  await expect(page.locator(".impact-card")).toHaveCount(0);
  expect(requests).toBeGreaterThanOrEqual(2);
});

test("homepage meets automated WCAG A/AA checks with verified figures unavailable", async ({ page }) => {
  await page.route(endpoint, (route) => fulfill(route, emptyImpact));
  await page.goto("/");
  await expect(page.getByText("No verified impact figures yet.")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })), null, 2)).toEqual([]);
});

test("role-specific signup links preserve the selected request without granting approval", async ({ page }) => {
  await page.goto("/signup?role=helper");
  await expect(page.getByLabel("I am registering as")).toHaveValue("helper");
  await expect(page.getByText(/it does not approve your role/i)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })), null, 2)).toEqual([]);
});

test("expired-session messaging and password visibility are accessible", async ({ page }) => {
  await page.goto("/login?reason=session-expired");
  await expect(page.getByRole("status")).toContainText(/session may have expired/i);
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  const showPassword = page.getByRole("button", { name: "Show password" });
  await showPassword.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })), null, 2)).toEqual([]);
});

test("skip navigation, keyboard menu and reduced-motion preference are respected", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();

  const toggle = page.locator(".mobile-menu-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  const animationDuration = await page.locator(".art-bowl").evaluate((element) => getComputedStyle(element).animationDuration);
  expect(parseFloat(animationDuration)).toBeLessThan(0.01);
});

test("public navigation works on narrow viewports without horizontal overflow", async ({ page }) => {
  await page.route(endpoint, (route) => fulfill(route, emptyImpact));
  for (const width of [320, 390, 760, 1024, 1440]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /good food deserves a destination/i })).toBeVisible();
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    if (width <= 1120) {
      const toggle = page.locator(".mobile-menu-toggle");
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Food safety", exact: true })).toBeVisible();
    }
  }
});
