import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    actionTimeout: 10_000,
    baseURL: "http://127.0.0.1:4173",
    defaultBrowserType: process.env.OPENAUTHOR_TEST_BROWSER === "webkit" ? "webkit" : "chromium",
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.OPENAUTHOR_TEST_BROWSER === "webkit" ? {} : { executablePath: process.env.OPENAUTHOR_BROWSER_EXECUTABLE },
  },
  webServer: {
    command: process.env.OPENAUTHOR_TEST_PREVIEW === "1"
      ? "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort"
      : "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_PROJECT_REGISTRY: "local" },
  },
});
