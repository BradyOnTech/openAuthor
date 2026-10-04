import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "e2e/.e2e");
const [browser, ...extra] = process.argv.slice(2);
if (!["chromium", "webkit"].includes(browser) || extra.length) {
  throw new Error("Usage: node e2e/scripts/archive.mjs chromium|webkit");
}
const receipt = JSON.parse(await readFile(resolve(output, "verification.json"), "utf8"));
if (receipt.stage !== "complete" || !receipt.requested.includes("--all")
    || receipt.requested.includes("--webkit") !== (browser === "webkit")) {
  throw new Error("Archive requires a completed full run for the selected browser");
}
const destination = resolve(output, `evidence-${browser}`);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(resolve(output, "verification.json"), resolve(destination, "verification.json"));
for (const report of receipt.reports.filter(row => row.report)) {
  const source = resolve(output, report.report);
  if (!source.startsWith(output + sep)) throw new Error("Report path escaped the evidence directory");
  const relative = report.runner === "playwright" ? report.report : dirname(report.report);
  await cp(resolve(output, relative), resolve(destination, relative), { recursive: true });
}
for (const [source, relative] of [
  ["desktop/test-results", "legacy/desktop"],
  ["mobile/test-results", "legacy/mobile"],
  ["mobile/dist/security-build.json", "build/mobile-preview-security.json"],
  ["mobile/.expo/hosted-e2e/security-build.json", "build/mobile-hosted-security.json"],
]) {
  const path = resolve(root, source);
  try { await stat(path); }
  catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  await mkdir(dirname(resolve(destination, relative)), { recursive: true });
  await cp(path, resolve(destination, relative), { recursive: true });
}
console.log(`Archived ${receipt.status} ${browser} evidence in ${destination}`);
