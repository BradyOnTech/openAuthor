// Byte-bound local Expo mitigation; version-based npm audit remains unchanged.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const mobile = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(mobile, "security/forge-backport-1.4.0.json"), "utf8"));
const fail = reason => { throw new Error(`Forge backport refused: ${reason}`); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function regularFile(root, name) {
  const path = resolve(root, name);
  if (relative(root, path).startsWith(".." + sep) || path === root || !path.startsWith(root + sep)) fail("path outside package");
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail("symlinked package content");
  }
  if (!lstatSync(path).isFile()) fail("non-file package content");
  return path;
}

function packageFiles(root, allFiles) {
  const files = {};
  const walk = (directory, depth = 0) => {
    if (depth > 32) fail("package traversal limit");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("symlinked package content");
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() && (allFiles || /\.(?:js|json|cjs|mjs)$/.test(entry.name) || entry.name === "cli")) files[relative(root, path)] = hash(readFileSync(path));
      else if (!entry.isFile()) fail("non-file package content");
    }
  };
  walk(root);
  return files;
}

function exactFiles(actual, expected) {
  const names = Object.keys(actual).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(expected).sort())) fail("unexpected package file inventory");
  for (const name of names) if (actual[name] !== expected[name]) fail(`source bytes changed: ${name}`);
}

function forgeCopies(projectRoot) {
  const found = [];
  const seen = new Set();
  let packages = 0;
  const scan = (nodeModules, depth = 0) => {
    if (depth > 32) fail("dependency traversal limit");
    if (!existsSync(nodeModules)) return;
    const canonical = realpathSync(nodeModules);
    if (seen.has(canonical)) return;
    seen.add(canonical);
    const inspect = (path, folderName) => {
      if (++packages > 10000) fail("dependency package limit");
      const metadata = join(path, "package.json");
      let name;
      if (existsSync(metadata)) name = JSON.parse(readFileSync(metadata, "utf8")).name;
      if (name === "node-forge" || folderName === "node-forge") found.push(path);
      scan(join(path, "node_modules"), depth + 1);
    };
    for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(nodeModules, entry.name);
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith("@")) {
        for (const child of readdirSync(path, { withFileTypes: true })) {
          if (child.isDirectory() || child.isSymbolicLink()) inspect(join(path, child.name), child.name);
        }
      } else inspect(path, entry.name);
    }
  };
  scan(join(projectRoot, "node_modules"));
  return found;
}

function inspect(projectRoot) {
  const root = realpathSync(projectRoot);
  const lock = JSON.parse(readFileSync(regularFile(root, "package-lock.json"), "utf8"));
  const lockedCopies = Object.entries(lock.packages ?? {}).filter(([name, value]) => name.endsWith("/node-forge") || value.name === "node-forge");
  if (lockedCopies.length !== 1 || lockedCopies[0][0] !== manifest.forge.path) fail("unknown locked Forge copy");
  for (const [name, expected] of Object.entries(manifest.lock_packages)) {
    if (JSON.stringify(lock.packages?.[name]) !== JSON.stringify(expected)) fail(`locked dependency changed: ${name}`);
  }
  const copies = forgeCopies(root);
  const forgeRoot = resolve(root, manifest.forge.path);
  if (copies.length !== 1 || copies[0] !== forgeRoot) fail("unknown installed Forge copy");
  regularFile(root, manifest.forge.path + "/package.json");
  const actual = packageFiles(forgeRoot, true);
  const patch = manifest.forge.patch;
  const rsaHash = actual[patch.path];
  if (![patch.original_sha256, patch.patched_sha256].includes(rsaHash)) fail("unknown RSA source bytes");
  const expected = { ...manifest.forge.files, [patch.path]: rsaHash };
  exactFiles(actual, expected);
  if (JSON.parse(readFileSync(join(forgeRoot, "package.json"), "utf8")).version !== manifest.forge.version) fail("unexpected Forge version");
  const expoMetadata = regularFile(root, manifest.expo_package_json.path);
  if (hash(readFileSync(expoMetadata)) !== manifest.expo_package_json.sha256) fail("Expo package changed");
  const expoEntrypoint = regularFile(root, manifest.expo_entrypoint.path);
  if (hash(readFileSync(expoEntrypoint)) !== manifest.expo_entrypoint.sha256) fail("Expo entry point changed");
  if (createRequire(expoEntrypoint).resolve("@expo/cli") !== resolve(root, manifest.expo_entrypoint.cli_path)) fail("Expo resolves another CLI entry point");
  for (const callerPackage of manifest.caller_packages) {
    regularFile(root, callerPackage.path + "/package.json");
    exactFiles(packageFiles(resolve(root, callerPackage.path), false), callerPackage.files);
  }
  const expectedResolution = join(forgeRoot, "package.json");
  const resolutions = manifest.callers.map(name => {
    const caller = regularFile(root, name);
    if (createRequire(caller).resolve("node-forge/package.json") !== expectedResolution) fail("caller resolves another Forge copy");
    return name;
  });
  return { root, forgeRoot, rsaHash, resolutions };
}

function writeAtomically(file, bytes) {
  const temporary = join(dirname(file), `.openauthor-forge-${randomUUID()}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", lstatSync(file).mode & 0o777);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function maintainForgeBackport(projectRoot = mobile, mode = "check") {
  if (!["check", "apply"].includes(mode)) fail("unsupported mode");
  let checked = inspect(projectRoot);
  const patch = manifest.forge.patch;
  let applied = false;
  if (checked.rsaHash === patch.original_sha256) {
    if (mode === "check") fail("reviewed backport not applied");
    const file = regularFile(checked.root, manifest.forge.path + "/" + patch.path);
    const original = readFileSync(file, "utf8");
    if (hash(original) !== patch.original_sha256 || original.split(patch.before).length !== 2) fail("patch preimage changed");
    const patched = original.replace(patch.before, patch.after);
    if (hash(patched) !== patch.patched_sha256) fail("patch postimage mismatch");
    writeAtomically(file, patched);
    applied = true;
    checked = inspect(projectRoot);
  }
  if (checked.rsaHash !== patch.patched_sha256) fail("backport verification failed");
  return {
    advisory: manifest.advisory,
    forge_version: manifest.forge.version,
    rsa_sha256: checked.rsaHash,
    status: "pinned_local_node_backport_verified",
    applied,
    callers: checked.resolutions,
    unmodified_distribution_files: manifest.forge.unmodified_distribution_files,
    dependency_audit_gate: "open",
    scope: manifest.scope,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail("use apply or check without extra arguments");
    console.log(JSON.stringify(maintainForgeBackport(mobile, process.argv[2])));
  } catch (error) {
    console.error(error.message.startsWith("Forge backport refused:") ? error.message : "Forge backport refused: incomplete package inspection");
    process.exitCode = 1;
  }
}
