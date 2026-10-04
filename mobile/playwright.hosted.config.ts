import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "hosted-companion.spec.ts",
  outputDir: "test-results/hosted",
  timeout: 60_000,
  use: { ...base.use, baseURL: "http://127.0.0.1:4176", serviceWorkers: "block", actionTimeout: 10_000 },
  webServer: {
    command: "npm run build:test-hosted && python3 -m http.server 4176 --bind 127.0.0.1 --directory .expo/hosted-e2e",
    url: "http://127.0.0.1:4176", reuseExistingServer: false, timeout: 120_000,
  },
});
