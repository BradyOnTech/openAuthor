import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "companion.spec.ts",
  outputDir: "test-results/preview",
  timeout: 30_000,
  workers: 1,
  use: {
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    baseURL: "http://127.0.0.1:4175",
    launchOptions: process.env.OPENAUTHOR_BROWSER_EXECUTABLE ? { executablePath: process.env.OPENAUTHOR_BROWSER_EXECUTABLE } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "python3 -m http.server 4175 --bind 127.0.0.1 --directory dist",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
  },
});
