import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testEnvironment } from "./environment.mjs";
import { playwrightVerification, sdkVerification } from "./reports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const startedAt = new Date().toISOString();
const reports = [];
const receiptPath = resolve(root, "e2e/.e2e/verification.json");
await mkdir(dirname(receiptPath), { recursive: true });
async function receipt(status, stage, exitCode = null) {
  await writeFile(receiptPath, JSON.stringify({ startedAt, updatedAt: new Date().toISOString(),
    status, stage, exitCode, requested: args, reports,
  }, null, 2) + "\n");
}
await receipt("running", "arguments");
const suites = args.filter((arg) => !arg.startsWith("--"));
const invalid = args.find((arg) => !["desktop", "mobile", "backend", "database", "--webkit", "--all"].includes(arg));
if (invalid || new Set(suites).size !== suites.length || (suites.length > 0 && args.includes("--all"))) {
  console.error("Usage: npm test -- [desktop|mobile|backend|database] [--webkit], or npm test -- --all [--webkit]");
  await receipt("failed", "arguments", 2);
  process.exit(2);
}
const selected = suites.length ? suites : ["backend", "desktop", "mobile", ...(args.includes("--all") ? ["database"] : [])];
if (selected.includes("database") && !process.env.OPENAUTHOR_TEST_PG_BIN) {
  console.error("Database flows require OPENAUTHOR_TEST_PG_BIN pointing to the PostgreSQL bin directory. See e2e/README.md.");
  await receipt("failed", "database-prerequisite", 2);
  process.exit(2);
}
const browsers = args.includes("--webkit") ? ["webkit"] : ["chromium"];
const env = testEnvironment();

let child;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}
async function command(label, executable, commandArgs, cwd, extraEnv = {}) {
  if (interrupted) return 130;
  console.log(`\n${label}`);
  return new Promise((resolveResult) => {
    child = spawn(executable, commandArgs, { cwd, env: { ...env, ...extraEnv }, stdio: "inherit" });
    child.on("error", (error) => { console.error(error.message); resolveResult(3); });
    child.on("close", (code, signal) => { child = undefined; resolveResult(signal ? 130 : code ?? 3); });
  });
}

let exitCode = 0;
const npmExecutable = process.env.npm_execpath ? process.execPath : "npm";
const npmArgs = (...commandArgs) => process.env.npm_execpath ? [process.env.npm_execpath, ...commandArgs] : commandArgs;
if (selected.includes("mobile")) {
  await receipt("running", "mobile-export");
  const result = await command("Build guarded mobile web app", npmExecutable,
    npmArgs("run", "build:web"), resolve(root, "mobile"));
  reports.push({ suite: "mobile-export", exitCode: result });
  if (result !== 0) {
    await receipt("failed", "mobile-export", result);
    process.exit(result);
  }
}
for (const suite of selected) {
  const backend = suite === "backend" || suite === "database";
  for (const browser of backend ? ["none"] : browsers) {
    const output = backend ? suite : `${suite}-${browser}`;
    await receipt("running", output);
    await rm(resolve(root, "e2e", ".e2e", output, "report.json"), { force: true });
    const result = await command(`tester-army/e2e: ${suite}${browser === "none" ? "" : ` (${browser})`}`,
      process.execPath, ["node_modules/e2e/dist/cli/bin.js", "run"], resolve(root, "e2e"),
      { OPENAUTHOR_E2E_SUITE: suite, OPENAUTHOR_E2E_BROWSER: browser === "none" ? "chromium" : browser });
    exitCode = Math.max(exitCode, result);
    try {
      const report = JSON.parse(await readFile(resolve(root, "e2e", ".e2e", output, "report.json"), "utf8"));
      const verification = sdkVerification(report);
      reports.push({ suite, browser, exitCode: result, report: `${output}/report.json`, ...verification });
      if (!verification.verified) exitCode = Math.max(exitCode, 1);
    } catch (error) {
      console.error(`No usable ${suite} report: ${error.message}`);
      reports.push({ suite, browser, exitCode: result, verified: false, error: error.message });
      exitCode = Math.max(exitCode, 3);
    }
  }
}

if (args.includes("--all") && !interrupted) {
  for (const [name, project, script] of [
    ["Desktop native-transport browser journeys", "desktop", "test:e2e"],
    ["Mobile offline app-shell browser journeys", "mobile", "test:e2e"],
    ["Mobile encrypted hosted companion journeys", "mobile", "test:e2e:hosted"],
  ]) {
    const output = `playwright-${project}-${browsers[0]}-${script.replaceAll(":", "-")}.json`;
    const reportPath = resolve(root, "e2e/.e2e", output);
    await receipt("running", output);
    await rm(reportPath, { force: true });
    const result = await command(name, npmExecutable, npmArgs("run", script, "--", "--reporter=list,json", "--forbid-only"), resolve(root, project),
      { OPENAUTHOR_TEST_BROWSER: browsers[0], PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath });
    exitCode = Math.max(exitCode, result);
    try {
      const verification = playwrightVerification(JSON.parse(await readFile(reportPath, "utf8")));
      reports.push({ suite: script, project, runner: "playwright", exitCode: result, report: output, ...verification });
      if (!verification.verified) exitCode = Math.max(exitCode, 1);
    } catch (error) {
      console.error(`No usable ${project}/${script} report: ${error.message}`);
      reports.push({ suite: script, project, runner: "playwright", exitCode: result, verified: false, error: error.message });
      exitCode = Math.max(exitCode, 3);
    }
  }
}
process.exitCode = interrupted ? 130 : exitCode;
await receipt(process.exitCode === 0 ? "passed" : "failed", "complete", process.exitCode);
