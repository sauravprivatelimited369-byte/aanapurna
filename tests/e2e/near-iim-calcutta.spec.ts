import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

const endpoint = "**/api/public/restaurant-directory";
const publicRecord = {
  name: "Halla Bowl",
  address: "Aristro Club, 680, Diamond Harbour Rd, Joka, Kolkata, West Bengal, 700104",
  locality: "Joka",
  city: "Kolkata",
  cuisines: ["Bengali", "North Indian", "Chinese"],
  directoryUrl: "https://indiarestros.com/r/halla-bowl-joka-nz0p6wdrgs",
  observedAt: "2026-10-25T08:17:44Z",
  sources: [
    { name: "overture", url: null },
    { name: "google", url: "https://www.google.com/maps?cid=6947617791363582730" },
    { name: "magicpin", url: "https://magicpin.in/Kolkata/Joka/Restaurant/Halla-Bowl/store/3b3ac3" },
  ],
  website: null,
};

async function fulfill(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("loads the attributed live record in a browser without implying partnership", async ({ page }) => {
  let requestCount = 0;
  await page.route(endpoint, async (route) => {
    requestCount += 1;
    expect(route.request().method()).toBe("GET");
    const headers = await route.request().allHeaders();
    expect(headers.accept).toContain("application/json");
    expect(headers.authorization).toBeUndefined();
    await fulfill(route, { status: "live", listing: publicRecord });
  });

  await page.goto("/near-iim-calcutta");
  await expect(page.getByRole("heading", { name: "Halla Bowl" })).toBeVisible();
  await expect(page.getByText("Live public-directory lookup")).toBeVisible();
  await expect(page.getByText("Not an Annapurna Link partner.")).toBeVisible();
  await expect(page.getByText(/has no current food offer/i)).toBeVisible();
  await expect(page.getByText("Bengali · North Indian · Chinese")).toBeVisible();
  await expect(page.getByRole("link", { name: "View source listing" }))
    .toHaveAttribute("href", publicRecord.directoryUrl);
  await expect(page.getByRole("link", { name: "Open map search" }))
    .toHaveAttribute("href", /openstreetmap\.org\/search\?query=/);
  await expect.poll(() => requestCount).toBeGreaterThan(0);
});

test("shows a clearly dated saved record and retries the live lookup", async ({ page }) => {
  let requestCount = 0;
  let allowLive = false;
  await page.route(endpoint, async (route) => {
    requestCount += 1;
    if (!allowLive) {
      await fulfill(route, {
        status: "snapshot",
        listing: publicRecord,
        snapshotCapturedOn: "2026-11-12",
        warning: "The live directory lookup is unavailable. This saved public-directory record was captured on 12 November 2026; IndiaRestros lists its last update as 25 October 2026. Details may have changed.",
      });
      return;
    }
    await fulfill(route, { status: "live", listing: publicRecord });
  });

  await page.goto("/near-iim-calcutta");
  await expect(page.getByRole("heading", { name: "Halla Bowl" })).toBeVisible();
  await expect(page.getByText("Saved public-directory record", { exact: true })).toBeVisible();
  await expect(page.getByText(/details may have changed/i)).toBeVisible();
  allowLive = true;
  const retry = page.getByRole("button", { name: "Retry live lookup" });
  await retry.click();
  await expect(page.getByText("Live public-directory lookup")).toBeVisible();
  expect(requestCount).toBeGreaterThanOrEqual(2);
});

test("loads a sourced listing through the real app endpoint with upstream fallback", async ({ page }) => {
  await page.goto("/near-iim-calcutta");
  await expect(page.getByRole("heading", { name: "Halla Bowl" })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("Not an Annapurna Link partner.")).toBeVisible();
  await expect(page.getByRole("link", { name: "View source listing" }))
    .toHaveAttribute("href", publicRecord.directoryUrl);
  await expect(page.locator(".nearby-public-badge"))
    .toContainText(/Live public-directory lookup|Saved public-directory record/);
});
