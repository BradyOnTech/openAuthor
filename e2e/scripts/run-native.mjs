import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testEnvironment } from "./environment.mjs";
import { sdkVerification } from "./reports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--list")) {
  console.error("Usage: npm run test:native (or npm run list:native)");
  process.exit(2);
}
const platform = process.env.OPENAUTHOR_E2E_NATIVE_PLATFORM;
if (platform !== "ios" && platform !== "android") {
  console.error("Set OPENAUTHOR_E2E_NATIVE_PLATFORM=ios or android for a dedicated native test target.");
  process.exit(2);
}
const list = args[0] === "--list";
const reportPath = resolve(root, `.e2e/mobile-native-${platform}/report.json`);
if (!list) await rm(reportPath, { force: true });
const child = spawn(process.execPath, ["node_modules/e2e/dist/cli/bin.js", list ? "list" : "run", "--config", "native.config.ts"],
  { cwd: root, env: testEnvironment(), stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
const code = await new Promise((resolveResult) => {
  child.on("error", error => { console.error(error.message); resolveResult(3); });
  child.on("close", (exitCode, signal) => resolveResult(signal ? 130 : exitCode ?? 3));
});
let status = code;
if (!list && code === 0) {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    if (!sdkVerification(report).verified) status = 1;
  } catch (error) {
    console.error(`No usable native execution report: ${error.message}`);
    status = 3;
  }
}
process.exitCode = status;
