import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const launchArgs = process.env.PLAYWRIGHT_CHROMIUM_ARGS
  ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) as string[]
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  webServer: {
    command: "npm run dev",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    headless: true,
    trace: process.env.RUN_LOCAL_AUTH_E2E === "true" ? "off" : "retain-on-failure",
    launchOptions: executablePath ? { executablePath, ...(launchArgs ? { args: launchArgs } : {}) } : undefined,
  },
});
