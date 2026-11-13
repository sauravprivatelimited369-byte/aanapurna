import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const enabled = process.env.RUN_LOCAL_AUTH_E2E === "true";
const inboxPath = process.env.LOCAL_SMTP_INBOX_PATH;

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

async function waitForVerificationUrl(filePath: string, email: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inbox = await readFile(filePath, "utf8").catch(() => "");
    const matchedMessage = inbox.split(/--- MESSAGE ---/i)
      .map(decodeQuotedPrintable)
      .find((message) => message.toLowerCase().includes(email.toLowerCase()));
    if (matchedMessage) {
      const candidates = matchedMessage.match(/https?:\/\/[^\s<>"']+/g) ?? [];
      for (const candidate of candidates) {
        try {
          const url = new URL(candidate.replace(/[),.;]+$/, ""));
          if (url.pathname.endsWith("/api/auth/verify-email")) return url.toString();
        } catch {
          // Keep searching this isolated test mailbox for the action URL.
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("The local verification message did not arrive at the isolated test sink.");
}

test("real local signup, email verification, Helper request and permission denial", async ({ page }) => {
  test.skip(!enabled, "Requires the explicitly enabled isolated PostgreSQL, SMTP sink and worker integration environment.");
  test.skip(!inboxPath, "Set LOCAL_SMTP_INBOX_PATH to the isolated local mail sink file.");
  test.setTimeout(120_000);

  const email = `local-ui-${randomBytes(8).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("base64url");
  await page.goto("/signup?role=helper");
  await page.getByLabel("Full name").fill("Local integration test account");
  await expect(page.getByLabel("I am registering as")).toHaveValue("helper");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Phone number").fill("+91 90000 00001");
  await page.getByLabel("Address").fill("12 Local Test Street");
  await page.getByLabel("Location / area").fill("Rourkela");
  await page.getByLabel("Profile information").fill("Fictional automated Helper account for local integration testing.");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("checkbox", { name: /I have read the/ }).check();
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByRole("status")).toContainText(/account created/i);

  const verificationUrl = await waitForVerificationUrl(inboxPath!, email, 30_000);
  await page.goto(verificationUrl);
  await expect(page.getByRole("status")).toContainText(/your email has been verified/i);

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // /auth/continue resolves the trusted backend role; a pending Helper has no approved role yet.
  await expect(page).toHaveURL(/\/account\/pending(?:\?|$)/);
  await expect(page.getByText(/waiting for review/i)).toBeVisible();

  await page.goto("/app/onboarding");
  await expect(page.getByLabel("I am requesting to join as")).toHaveValue("helper");
  await page.getByRole("checkbox", { name: /this request is not Helper approval or safety training/i }).check();
  const onboardingResponse = page.waitForResponse((response) => response.url().endsWith("/api/onboarding") && response.request().method() === "POST");
  await page.getByRole("button", { name: /submit for human review/i }).click();
  expect((await onboardingResponse).status()).toBe(201);
  await expect(page.getByRole("status")).toContainText(/pending human review/i);
  await expect(page.getByText("Helper profile", { exact: true })).toBeVisible();
  await expect(page.locator(".status-pill--pending")).toBeVisible();

  const adminStatus = await page.evaluate(async () => (await fetch("/api/admin/overview")).status);
  expect(adminStatus).toBe(403);
  await page.goto("/app/operations");
  await expect(page).toHaveURL(/\/app(?:\?|$)/);
  const health = await page.request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ realOperationsEnabled: false });
});
