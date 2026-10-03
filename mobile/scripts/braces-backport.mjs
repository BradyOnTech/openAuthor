// Maintain byte-bound local Braces copies; raw dependency audit remains open.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const mobile = resolve(import.meta.dirname, "..");
const fail = reason => { throw new Error(`Braces backport refused: ${reason}`); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const moduleIds = { "index.js": 610, "lib/compile.js": 9434, "lib/constants.js": 8774, "lib/expand.js": 5873, "lib/parse.js": 6477, "lib/stringify.js": 8750, "lib/utils.js": 5207 };

export function buildBracesModuleEntry(sourceName, sourceText) {
  if (!Object.hasOwn(moduleIds, sourceName) || typeof sourceText !== "string") fail("unknown embedded source");
  const dependencies = { "fill-range": 6330 };
  for (const [name, id] of Object.entries(moduleIds)) {
    const path = posix.relative(posix.dirname(sourceName), name).replace(/\.js$/, "");
    dependencies[path.startsWith(".") ? path : "./" + path] = id;
  }
  return `${moduleIds[sourceName]}:(module,exports,__webpack_require__)=>{\n"use strict";\nconst dependencies = ${JSON.stringify(dependencies)};\nconst require = name => {\n  if (!Object.hasOwn(dependencies, name)) throw new Error("Unsupported embedded Braces dependency");\n  return __webpack_require__(dependencies[name]);\n};\n${sourceText}\n}`;
}

function regularFile(root, name) {
  const path = resolve(root, name);
  if (path === root || !path.startsWith(root + sep)) fail("path outside project");
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail("symlinked package content");
  }
  if (!lstatSync(path).isFile()) fail("non-file package content");
  return path;
}

function inventory(root) {
  const files = {};
  const walk = (directory, depth = 0) => {
    if (depth > 32) fail("package traversal limit");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("symlinked package content");
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile()) files[relative(root, path).split(sep).join("/")] = hash(readFileSync(path));
      else fail("non-file package content");
    }
  };
  walk(root);
  return files;
}

function installedCopies(root, names) {
  const found = Object.fromEntries(names.map(name => [name, []]));
  const seen = new Set();
  let count = 0;
  const scan = (nodeModules, depth = 0) => {
    if (depth > 32) fail("dependency traversal limit");
    if (!existsSync(nodeModules)) return;
    const canonical = realpathSync(nodeModules);
    if (seen.has(canonical)) return;
    seen.add(canonical);
    const inspect = (path, folderName) => {
      if (++count > 10000) fail("dependency package limit");
      const metadata = join(path, "package.json");
      const name = existsSync(metadata) ? JSON.parse(readFileSync(metadata, "utf8")).name : undefined;
      for (const expected of names) if (name === expected || folderName === expected) found[expected].push(path);
      scan(join(path, "node_modules"), depth + 1);
    };
    for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const path = join(nodeModules, entry.name);
      if (entry.name.startsWith("@")) {
        for (const child of readdirSync(path, { withFileTypes: true })) {
          if (child.isDirectory() || child.isSymbolicLink()) inspect(join(path, child.name), child.name);
        }
      } else inspect(path, entry.name);
    }
  };
  scan(join(root, "node_modules"));
  return found;
}

function replaceUnique(text, before, after) {
  const position = text.indexOf(before);
  if (position < 0 || text.indexOf(before, position + before.length) >= 0) fail("embedded module inventory changed");
  return text.slice(0, position) + after + text.slice(position + before.length);
}

function embeddedTarget(bytes, patch, sources) {
  const currentHash = hash(bytes);
  if (![patch.original_sha256, patch.patched_sha256].includes(currentHash)) fail("unknown embedded bundle bytes");
  const entries = patch.modules.map(item => {
    if (moduleIds[item.source] !== item.module_id || hash(item.original_entry) !== item.original_entry_sha256) fail("embedded module pin changed");
    const entry = buildBracesModuleEntry(item.source, sources[item.source]);
    if (hash(entry) !== item.patched_entry_sha256) fail("embedded postimage changed");
    return { original: item.original_entry, patched: entry };
  });
  if (entries.length !== 7 || new Set(patch.modules.map(item => item.source)).size !== 7) fail("embedded module inventory changed");
  let original = bytes.toString("utf8");
  if (currentHash === patch.patched_sha256) {
    for (const entry of entries) original = replaceUnique(original, entry.patched, entry.original);
  }
  if (hash(original) !== patch.original_sha256) fail("embedded preimage mismatch");
  let patched = original;
  for (const entry of entries) patched = replaceUnique(patched, entry.original, entry.patched);
  if (hash(patched) !== patch.patched_sha256) fail("embedded postimage mismatch");
  return { original: Buffer.from(original), patched: Buffer.from(patched) };
}

function inspect(projectRoot) {
  const root = realpathSync(projectRoot);
  const manifest = JSON.parse(readFileSync(join(mobile, "security/braces-backport-3.0.3.json"), "utf8"));
  const sources = {};
  if (Object.keys(manifest.sources).sort().join("|") !== Object.keys(moduleIds).sort().join("|")) fail("readable source inventory changed");
  for (const [name, pin] of Object.entries(manifest.sources)) {
    const bytes = readFileSync(regularFile(root, pin.path));
    if (hash(bytes) !== pin.sha256) fail(`readable source changed: ${name}`);
    sources[name] = bytes.toString("utf8");
  }
  const sourceFiles = {};
  for (const pin of [...Object.values(manifest.sources), ...Object.values(manifest.source_material)]) {
    if (!pin.path.startsWith(manifest.source_root + "/")) fail("readable material outside source inventory");
    if (hash(readFileSync(regularFile(root, pin.path))) !== pin.sha256) fail("readable source material changed");
    sourceFiles[pin.path.slice(manifest.source_root.length + 1)] = pin.sha256;
  }
  const actualSources = inventory(resolve(root, manifest.source_root));
  if (JSON.stringify(Object.entries(actualSources).sort()) !== JSON.stringify(Object.entries(sourceFiles).sort())) fail("readable source file inventory changed");
  const lock = JSON.parse(readFileSync(regularFile(root, "package-lock.json"), "utf8"));
  const names = manifest.packages.map(item => item.name);
  const copies = installedCopies(root, names);
  for (const item of manifest.packages) {
    const locked = Object.entries(lock.packages ?? {}).filter(([path, value]) => path.endsWith("/" + item.name) || value.name === item.name);
    if (locked.length !== 1 || locked[0][0] !== item.path) fail("unknown locked package copy");
    if (copies[item.name].length !== 1 || copies[item.name][0] !== resolve(root, item.path)) fail("unknown installed package copy");
    const metadata = JSON.parse(readFileSync(regularFile(root, item.path + "/package.json"), "utf8"));
    if (metadata.name !== item.name || metadata.version !== item.version) fail("installed package identity changed");
  }
  for (const [name, expected] of Object.entries(manifest.lock_packages)) {
    if (JSON.stringify(lock.packages?.[name]) !== JSON.stringify(expected)) fail(`locked dependency changed: ${name}`);
  }
  const targets = manifest.patches.map(patch => {
    const path = regularFile(root, patch.path);
    const bytes = readFileSync(path);
    const currentHash = hash(bytes);
    if (![patch.original_sha256, patch.patched_sha256].includes(currentHash)) fail(`unknown target bytes: ${patch.path}`);
    const planned = patch.source ? { original: Buffer.from(patch.original_text), patched: Buffer.from(sources[patch.source]) } : embeddedTarget(bytes, patch, sources);
    if (hash(planned.original) !== patch.original_sha256 || hash(planned.patched) !== patch.patched_sha256) fail("target preimage/postimage mismatch");
    return { path: patch.path, ...planned, state: currentHash === patch.patched_sha256 ? "patched" : "original" };
  });
  if (targets.length !== 9 || new Set(targets.map(target => target.path)).size !== 9) fail("target inventory changed");
  const states = Object.fromEntries(targets.map(target => [target.path, hash(readFileSync(regularFile(root, target.path)))]));
  for (const item of manifest.packages) {
    const expected = { ...item.files };
    for (const target of targets) {
      if (target.path.startsWith(item.path + "/")) expected[target.path.slice(item.path.length + 1)] = states[target.path];
    }
    const actual = inventory(resolve(root, item.path));
    if (Object.keys(actual).sort().join("|") !== Object.keys(expected).sort().join("|")) fail("unexpected package file inventory");
    for (const [name, digest] of Object.entries(expected)) if (actual[name] !== digest) fail(`package bytes changed: ${item.name}/${name}`);
  }
  for (const [name, digest] of Object.entries(manifest.caller_files)) {
    if (hash(readFileSync(regularFile(root, name))) !== digest) fail(`caller bytes changed: ${name}`);
  }
  for (const item of manifest.resolutions) {
    const caller = regularFile(root, item.caller);
    regularFile(root, item.resolved);
    if (createRequire(caller).resolve(item.specifier) !== resolve(root, item.resolved)) fail("caller resolves another package copy");
  }
  return { root, manifest, targets, states };
}

export function expectedBracesTargets(projectRoot = mobile) {
  return inspect(projectRoot).targets.map(({ path, original, patched }) => ({ path, original, patched }));
}

function writeAtomically(root, target) {
  const file = regularFile(root, target.path);
  const temporary = join(root, "node_modules", `.openauthor-braces-${randomUUID()}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", lstatSync(file).mode & 0o777);
    writeFileSync(descriptor, target.patched);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function maintainBracesBackport(projectRoot = mobile, mode = "check") {
  if (!["apply", "check"].includes(mode)) fail("unsupported mode");
  let checked = inspect(projectRoot);
  const remaining = checked.targets.filter(target => target.state === "original");
  if (mode === "check" && remaining.length) fail("reviewed backport not fully applied");
  // Validate all targets/callers before the first replacement. A killed apply
  // leaves only known pre/postimages; apply can complete that mixed state.
  const applied = [];
  if (mode === "apply" && remaining.length) {
    checked = inspect(projectRoot);
    for (const target of checked.targets.sort((a, b) => a.path.localeCompare(b.path))) {
      if (target.state === "patched") continue;
      if (hash(readFileSync(regularFile(checked.root, target.path))) !== checked.states[target.path]) fail("target changed during application");
      writeAtomically(checked.root, target);
      applied.push(target.path);
    }
    checked = inspect(projectRoot);
  }
  if (checked.targets.some(target => target.state !== "patched")) fail("backport verification failed");
  return { advisory: checked.manifest.advisory, status: "pinned_local_three_copy_backport_verified", applied,
    targets: Object.fromEntries(checked.targets.map(target => [target.path, hash(target.patched)])),
    package_versions: Object.fromEntries(checked.manifest.packages.map(item => [item.name, item.version])),
    dependency_audit_gate: "open", scope: checked.manifest.scope };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail("use apply or check without extra arguments");
    console.log(JSON.stringify(maintainBracesBackport(mobile, process.argv[2])));
  } catch (error) {
    console.error(error.message?.startsWith("Braces backport refused:") ? error.message : "Braces backport refused: incomplete package inspection");
    process.exitCode = 1;
  }
}
