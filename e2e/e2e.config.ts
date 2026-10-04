import type { E2EConfig, Target } from "e2e";
import { web } from "@e2e-dev/web";

const suite = process.env.OPENAUTHOR_E2E_SUITE ?? "desktop";
if (!["desktop", "mobile", "backend", "database"].includes(suite)) {
  throw new Error(`Unknown openAuthor E2E suite: ${suite}`);
}
const browser = process.env.OPENAUTHOR_E2E_BROWSER ?? "chromium";
if (browser !== "chromium" && browser !== "webkit") {
  throw new Error(`Unsupported openAuthor E2E browser: ${browser}`);
}

const backend = suite === "backend" || suite === "database";
const targets: Target[] = backend ? [{ name: suite, platform: "backend" }] : [{
  name: `${suite}-${browser}`,
  engine: web({
    browser,
    viewport: suite === "mobile" ? { width: 390, height: 844 } : { width: 1400, height: 900 },
  }),
  app: {
    url: "http://127.0.0.1:0",
    identity: `openauthor-${suite}-local`,
    environment: "test",
    command: suite === "desktop" ? {
      executable: process.execPath,
      args: ["../desktop/node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "{port}", "--strictPort"],
      cwd: "../desktop",
      env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_PROJECT_REGISTRY: "local" },
      log: `.e2e/${suite}-${browser}/app.log`,
    } : {
      executable: process.env.OPENAUTHOR_TEST_PYTHON ?? "python3",
      args: ["-m", "http.server", "{port}", "--bind", "127.0.0.1", "--directory", "../mobile/dist"],
      log: `.e2e/${suite}-${browser}/app.log`,
    },
  },
}];

export default {
  projectId: "openauthor-public-workflows",
  tests: suite === "database" ? "tests/backend-database.e2e.ts" : suite === "backend"
    ? ["tests/backend*.e2e.ts", "!tests/backend-database.e2e.ts"] : `tests/${suite}*.e2e.ts`,
  targets,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  actionTimeout: 15_000,
  assertionTimeout: 10_000,
  cleanupTimeout: 30_000,
  cache: "off",
  trace: backend ? "off" : "retain-on-failure",
  reporters: ["list", "junit", "markdown"],
  output: `.e2e/${backend ? suite : `${suite}-${browser}`}`,
} satisfies E2EConfig;
