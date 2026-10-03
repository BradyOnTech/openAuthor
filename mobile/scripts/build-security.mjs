// Contain unpatched tooling modules in exports; dependency remediation remains open.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { maintainForgeBackport } from "./forge-backport.mjs";
import { maintainBracesBackport } from "./braces-backport.mjs";

const mobile = resolve(import.meta.dirname, "..");
const advisory = "GHSA-86w9-cpqp-85rv";
const advisories = [advisory, "GHSA-vfj7-8cjw-p6xm"];
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const owns = (value, key) => object(value) && Object.hasOwn(value, key);
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");

function offlineProbe() {
  const savedEnvironment = { ...process.env };
  const connect = net.Socket.prototype.connect;
  const fetch = globalThis.fetch;
  let attempts = 0;
  const blocked = () => { attempts++; fail("Network access refused during signing inspection"); };
  process.env.NODE_ENV = "production";
  process.env.EXPO_OFFLINE = "1";
  process.env.EXPO_NO_TELEMETRY = "1";
  net.Socket.prototype.connect = blocked;
  globalThis.fetch = blocked;
  return {
    attempts: () => attempts,
    restore() {
      net.Socket.prototype.connect = connect;
      globalThis.fetch = fetch;
      for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
      Object.assign(process.env, savedEnvironment);
    },
  };
}

function resolveProject(projectRoot) {
  const projectRequire = createRequire(join(projectRoot, "package.json"));
  const require = createRequire(projectRequire.resolve("expo/package.json"));
  // Match Expo export's production dotenv environment and config-plugin resolution.
  require("@expo/env").load(projectRoot, { silent: true, force: true });
  const { exp } = require("@expo/config").getConfig(projectRoot);
  if (!object(exp) || (exp.updates !== undefined && !object(exp.updates))) fail("Signing configuration requires security review");
  if (owns(exp.updates, "codeSigningCertificate") || exp.updates?.codeSigningCertificate !== undefined ||
    owns(exp.updates, "codeSigningMetadata") || exp.updates?.codeSigningMetadata !== undefined ||
    owns(exp.extra?.eas, "projectId") || exp.extra?.eas?.projectId !== undefined) {
    fail("Signing configuration requires security review");
  }
  const installed = Object.fromEntries(["expo", "@expo/cli", "@expo/code-signing-certificates", "node-forge", "braces", "micromatch"].map(name => [name, require(`${name}/package.json`).version]));
  return { exp, require, installed };
}

export function inspectProject(projectRoot = mobile) {
  const probe = offlineProbe();
  try {
    const { installed } = resolveProject(projectRoot);
    if (probe.attempts() !== 0) fail("Network access refused during signing inspection");
    return { advisory, advisories, dependency_audit_gate: "open", installed };
  } finally { probe.restore(); }
}

export async function preflight(projectRoot = mobile) {
  const probe = offlineProbe();
  try {
    const { exp, require, installed } = resolveProject(projectRoot);
    const cli = dirname(require.resolve("@expo/cli/package.json"));
    const signing = require(join(cli, "build/src/utils/codesigning.js"));
    for (const header of [undefined, 'keyid="expo-root"', 'keyid="synthetic-project", alg="rsa-v1_5-sha256"']) {
      assert.equal(await signing.getCodeSigningInfoAsync(exp, header), null);
    }
    assert.equal(probe.attempts(), 0);
    return { advisory, advisories, dependency_audit_gate: "open", installed, signing_header_checks: 3, network_attempts: 0 };
  } finally { probe.restore(); }
}

export function parseExportArguments(args) {
  const values = { platform: "web", output: "dist" };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!["--platform", "--output-dir"].includes(option) || seen.has(option) || typeof value !== "string" || !value || value.startsWith("--")) {
      fail("Unsupported guarded export arguments");
    }
    seen.add(option);
    values[option === "--platform" ? "platform" : "output"] = value;
  }
  if (!["web", "ios", "android", "all"].includes(values.platform)) fail("Unsupported guarded export arguments");
  return { ...values, platforms: values.platform === "all" ? ["web", "ios", "android"] : [values.platform] };
}

function sourceNames(map, depth = 0) {
  if (!object(map) || map.version !== 3 || depth > 16) fail("Export inspection incomplete");
  if (Array.isArray(map.sections)) {
    if (!map.sections.length || map.sources !== undefined) fail("Export inspection incomplete");
    return map.sections.flatMap(section => sourceNames(section?.map, depth + 1));
  }
  // Metro uses NUL-prefixed virtual identifiers; these are never filesystem paths.
  if (!Array.isArray(map.sources) || !map.sources.length || map.sources.some(source => typeof source !== "string" || !source || source.length > 8192)) {
    fail("Export inspection incomplete");
  }
  if (map.sourceRoot !== undefined && typeof map.sourceRoot !== "string") fail("Export inspection incomplete");
  return map.sources.map(source => `${map.sourceRoot ? map.sourceRoot.replace(/\/$/, "") + "/" : ""}${source}`.replaceAll("\\", "/"));
}

function exportModuleRejection(source) {
  if (/(?:^|\/)node-forge(?:\/|$)|(?:^|\/)@expo\/code-signing-certificates(?:\/|$)|(?:^|\/)@expo\/cli\/(?:build\/)?src\/(?:utils\/codesigning(?:\.|\/)|run\/ios\/codeSigning\/)/.test(source)) {
    return "Affected signing module entered export";
  }
  // Micromatch imports Braces; workspace-root and doctor embed copies in compiled modules.
  // Exclusion is an export boundary, not proof that every matcher invokes a vulnerable walker.
  if (/(?:^|\/)(?:braces|micromatch|resolve-workspace-root|expo-doctor)(?:\/|$)/.test(source)) {
    return "Pattern tooling module entered export";
  }
  return null;
}

export function inspectExport(output, platforms) {
  const bundles = [];
  const walk = (directory, depth = 0) => {
    if (depth > 32) fail("Export inspection incomplete");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail("Export inspection incomplete");
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (entry.isFile() && /\.(?:js|hbc)$/.test(entry.name)) {
        const name = relative(output, file).replaceAll("\\", "/");
        const platform = /^_expo\/static\/js\/(web|ios|android)\//.exec(name)?.[1];
        if (!platform) continue;
        if (!platforms.includes(platform) || bundles.length >= 1000) fail("Export inspection incomplete");
        const mapFile = file + ".map";
        const mapStat = lstatSync(mapFile);
        if (!mapStat.isFile() || mapStat.size > 64 * 1024 * 1024) fail("Export inspection incomplete");
        const sources = sourceNames(JSON.parse(readFileSync(mapFile, "utf8")));
        for (const source of sources) {
          const rejection = exportModuleRejection(source);
          if (rejection) fail(rejection);
        }
        bundles.push({ file: name, platform, source_count: sources.length, bundle_sha256: hash(file), map_sha256: hash(mapFile) });
      }
    }
  };
  try { walk(output); } catch (error) {
    if (["Affected signing module entered export", "Pattern tooling module entered export"].includes(error.message)) throw error;
    fail("Export inspection incomplete");
  }
  if (!bundles.length || platforms.some(platform => !bundles.some(bundle => bundle.platform === platform))) fail("Export inspection incomplete");
  return { platforms, map_count: bundles.length, bundles };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "preflight" && args.length === 0) {
    const forge_backport = maintainForgeBackport(mobile);
    const braces_backport = maintainBracesBackport(mobile);
    console.log(JSON.stringify({ ...await preflight(), forge_backport, braces_backport }));
    return;
  }
  if (mode !== "export") fail("Unsupported guarded export arguments");
  const options = parseExportArguments(args);
  const forge_backport = maintainForgeBackport(mobile);
  const braces_backport = maintainBracesBackport(mobile);
  const config = { ...await preflight(), forge_backport, braces_backport };
  const require = createRequire(join(mobile, "package.json"));
  const cli = join(dirname(require.resolve("expo/package.json")), "bin/cli");
  const result = spawnSync(process.execPath, [cli, "export", "--clear", "--source-maps", "--platform", options.platform, "--output-dir", options.output], {
    cwd: mobile, env: { ...process.env, NODE_ENV: "production", EXPO_OFFLINE: "1", EXPO_NO_TELEMETRY: "1" }, stdio: "inherit",
  });
  if (result.error || result.status !== 0) fail("Guarded export failed");
  const output = resolve(mobile, options.output);
  const report = { ...config, scope: "Metro export module containment; dependency remediation, exposed developer tooling, signing and native acceptance unverified", ...inspectExport(output, options.platforms) };
  writeFileSync(join(output, "security-build.json"), JSON.stringify(report, null, 2) + "\n");
  // Inspect maps before removing them from public app-shell assets.
  for (const bundle of report.bundles) unlinkSync(join(output, bundle.file) + ".map");
  console.log(`Mobile export containment passed (${report.map_count} maps); dependency remediation remains open for ${advisories.join(", ")}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const allowed = ["Signing configuration requires security review", "Affected signing module entered export", "Pattern tooling module entered export", "Export inspection incomplete", "Unsupported guarded export arguments", "Guarded export failed"];
    console.error(allowed.includes(error.message) || error.message.startsWith("Forge backport refused:") || error.message.startsWith("Braces backport refused:") ? error.message : "Mobile build security inspection failed");
    process.exitCode = 1;
  });
}
