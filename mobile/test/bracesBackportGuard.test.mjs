import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBracesModuleEntry, expectedBracesTargets, maintainBracesBackport } from "../scripts/braces-backport.mjs";

const mobile = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(mobile, "security/braces-backport-3.0.3.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "openauthor-braces-guard-"));
  const copied = new Set();
  const copy = name => {
    if (copied.has(name)) return;
    const destination = join(root, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(mobile, name), destination);
    copied.add(name);
  };
  try {
    copy("package.json");
    copy("package-lock.json");
    for (const pin of [...Object.values(manifest.sources), ...Object.values(manifest.source_material)]) copy(pin.path);
    for (const item of manifest.packages) for (const name of Object.keys(item.files)) copy(item.path + "/" + name);
    for (const name of Object.keys(manifest.caller_files)) copy(name);
    for (const item of manifest.resolutions) { copy(item.caller); copy(item.resolved); }
    // Reconstruct known original bytes in this private fixture after postinstall,
    // without loading Braces, resolver, Doctor, Metro or any dependency module.
    const targets = expectedBracesTargets(root);
    for (const target of targets) writeFileSync(join(root, target.path), target.original);
    return run(root, targets);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const targetHashes = root => Object.fromEntries(manifest.patches.map(item => [item.path,
  existsSync(join(root, item.path)) ? hash(readFileSync(join(root, item.path))) : null]));
function refusedUnchanged(root, pattern) {
  const before = targetHashes(root);
  expect(() => maintainBracesBackport(root, "apply")).toThrow(pattern);
  expect(targetHashes(root)).toEqual(before);
}
function changeLock(root, edit) {
  const file = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(file, "utf8"));
  edit(lock);
  writeFileSync(file, JSON.stringify(lock));
}

// These tests inspect and replace data bytes only. Behavioral execution of the
// patched copies and small ordinary baseline controls has separate ownership.
describe("three-copy Braces delivery guard", () => {
  it("check refuses original bytes without writing any target", () => fixture(root => {
    const before = targetHashes(root);
    expect(() => maintainBracesBackport(root)).toThrow("reviewed backport not fully applied");
    expect(targetHashes(root)).toEqual(before);
  }));

  it("applies each changed file once and verifies all three pinned copies", () => fixture((root, targets) => {
    const result = maintainBracesBackport(root, "apply");
    const changed = targets.filter(target => !target.original.equals(target.patched)).map(target => target.path).sort();
    expect(result.applied).toEqual(changed);
    expect(result.targets).toEqual(Object.fromEntries(manifest.patches.map(item => [item.path, item.patched_sha256])));
    expect(result.package_versions).toEqual({ braces: "3.0.3-openauthor.1", "resolve-workspace-root": "2.0.1", "expo-doctor": "1.20.4" });
    expect(result.dependency_audit_gate).toBe("separate_raw_audit_required");
    expect(maintainBracesBackport(root, "apply").applied).toEqual([]);
    expect(maintainBracesBackport(root, "check").targets).toEqual(result.targets);
  }));

  it("completes exact mixed pre/postimages left by an interrupted apply", () => fixture((root, targets) => {
    const changed = targets.filter(target => !target.original.equals(target.patched));
    for (const target of changed.slice(0, 3)) writeFileSync(join(root, target.path), target.patched);
    const before = targetHashes(root);
    expect(() => maintainBracesBackport(root)).toThrow("reviewed backport not fully applied");
    expect(targetHashes(root)).toEqual(before);
    expect(maintainBracesBackport(root, "apply").applied).toEqual(changed.slice(3).map(target => target.path).sort());
    expect(maintainBracesBackport(root).targets).toEqual(Object.fromEntries(targets.map(target => [target.path, hash(target.patched)])));
  }));

  it("retains an unrelated interrupted temporary file while completing known targets", () => fixture((root, targets) => {
    writeFileSync(join(root, targets[0].path), targets[0].patched);
    const temporary = join(root, "node_modules/.openauthor-braces-interrupted-fixture");
    writeFileSync(temporary, "private partial temporary data");
    maintainBracesBackport(root, "apply");
    expect(readFileSync(temporary, "utf8")).toBe("private partial temporary data");
    expect(maintainBracesBackport(root).dependency_audit_gate).toBe("separate_raw_audit_required");
  }));

  it("refuses an unknown target in a mixed state before changing any remaining original", () => fixture((root, targets) => {
    writeFileSync(join(root, targets[0].path), targets[0].patched);
    writeFileSync(join(root, targets.at(-1).path), "private unknown partial bundle");
    refusedUnchanged(root, "unknown target bytes");
  }));

  it.each(manifest.patches.map(patch => patch.path))("refuses unknown target bytes: %s", name => fixture(root => {
    writeFileSync(join(root, name), "private unknown source bytes");
    refusedUnchanged(root, "unknown target bytes");
  }));

  it("refuses a missing owned file before replacement", () => fixture(root => {
    rmSync(join(root, "node_modules/resolve-workspace-root/LICENSE.md"));
    refusedUnchanged(root, "unexpected package file inventory");
  }));

  it("refuses an added owned file before replacement", () => fixture(root => {
    writeFileSync(join(root, "node_modules/braces/private-extra.js"), "private unknown file");
    refusedUnchanged(root, "unexpected package file inventory");
  }));

  it("refuses changed untouched owner bytes before replacement", () => fixture(root => {
    writeFileSync(join(root, "node_modules/braces/LICENSE"), "private license drift");
    refusedUnchanged(root, "package bytes changed");
  }));

  it("refuses relevant caller or range dependency drift before replacement", () => {
    for (const name of ["node_modules/micromatch/index.js", "node_modules/@expo/config/build/paths/paths.js", "node_modules/fill-range/index.js"]) {
      fixture(root => {
        writeFileSync(join(root, name), "private caller drift");
        refusedUnchanged(root, "caller bytes changed");
      });
    }
  });

  it("refuses readable implementation, oracle and license drift before replacement", () => {
    for (const name of ["security/braces/lib/utils.js", "security/braces/originals.json", "security/braces/LICENSE"]) {
      fixture(root => {
        writeFileSync(join(root, name), "private readable material drift");
        refusedUnchanged(root, /readable source changed|readable source material changed/);
      });
    }
  });

  it("refuses extra readable source files before replacement", () => fixture(root => {
    writeFileSync(join(root, "security/braces/lib/private-extra.js"), "private extra source");
    refusedUnchanged(root, "readable source file inventory changed");
  }));

  it("refuses changed or duplicate reviewed lock entries before replacement", () => {
    for (const edit of [
      lock => { lock.packages["node_modules/braces"].version = "private-drift"; },
      lock => { lock.packages["node_modules/fill-range"].integrity = "private-drift"; },
      lock => { lock.packages["node_modules/private-alias"] = { name: "braces", version: "3.0.3" }; },
      lock => { lock.packages["node_modules/private-alias"] = { name: "@openauthor/braces", version: "3.0.3-openauthor.1" }; },
      lock => { lock.packages["node_modules/parent/node_modules/resolve-workspace-root"] = { version: "2.0.1" }; },
    ]) fixture(root => { changeLock(root, edit); refusedUnchanged(root, /locked dependency changed|unknown locked package copy/); });
  });

  it.each(["braces", "resolve-workspace-root", "expo-doctor"])("refuses a nested or aliased %s copy before replacement", name => {
    for (const identity of new Set([name, manifest.packages.find(item => item.name === name).installed_name ?? name])) for (const destination of ["node_modules/private-alias", "node_modules/private-parent/node_modules/" + name]) fixture(root => {
      mkdirSync(dirname(join(root, destination)), { recursive: true });
      cpSync(join(root, "node_modules", name), join(root, destination), { recursive: true });
      const metadataFile = join(root, destination, "package.json");
      const metadata = JSON.parse(readFileSync(metadataFile));
      metadata.name = identity;
      writeFileSync(metadataFile, JSON.stringify(metadata));
      refusedUnchanged(root, "unknown installed package copy");
    });
  });

  it("refuses nested caller resolution shadowing before replacement", () => fixture(root => {
    const destination = join(root, "node_modules/micromatch/node_modules/braces");
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, "node_modules/braces"), destination, { recursive: true });
    refusedUnchanged(root, "unknown installed package copy");
  }));

  it("refuses symlinked relevant files and package directories before replacement", () => {
    for (const name of ["node_modules/braces/lib/compile.js", "node_modules/resolve-workspace-root", "security/braces/originals.json"]) fixture(root => {
      const source = join(root, name);
      const destination = join(root, "private-link-target");
      cpSync(source, destination, { recursive: true });
      rmSync(source, { recursive: true });
      symlinkSync(destination, source);
      refusedUnchanged(root, "symlinked package content");
    });
  });

  it("builds the fixed embedded adapters without changing surrounding bundle bytes", () => fixture((root, targets) => {
    for (const patch of manifest.patches.filter(patch => patch.modules)) {
      const target = targets.find(target => target.path === patch.path);
      let reconstructed = target.original.toString("utf8");
      for (const item of patch.modules) {
        const source = readFileSync(join(root, manifest.sources[item.source].path), "utf8");
        const entry = buildBracesModuleEntry(item.source, source);
        expect(hash(entry)).toBe(item.patched_entry_sha256);
        expect(entry).toContain('"fill-range":6330');
        expect(reconstructed.split(item.original_entry)).toHaveLength(2);
        reconstructed = reconstructed.replace(item.original_entry, () => entry);
      }
      expect(target.patched.equals(Buffer.from(reconstructed))).toBe(true);
      expect(hash(reconstructed)).toBe(patch.patched_sha256);
    }
  }));

  it("checks both maintained backports before each supported tooling command", () => {
    const scripts = JSON.parse(readFileSync(join(mobile, "package.json"), "utf8")).scripts;
    expect(scripts.postinstall).toBe("node scripts/verify-security-forks.mjs && node scripts/forge-backport.mjs apply && node scripts/braces-backport.mjs apply");
    expect(scripts["security:braces"]).toBe("node scripts/braces-backport.mjs check");
    for (const command of ["start", "web", "android", "ios", "prebuild", "doctor", "build:web", "build:export", "build:security", "build:test-hosted"]) {
      expect(scripts["pre" + command], command).toBe("node scripts/forge-backport.mjs check && node scripts/braces-backport.mjs check");
    }
    const build = readFileSync(join(mobile, "scripts/build-security.mjs"), "utf8");
    expect(build.match(/maintainBracesBackport\(mobile\)/g)).toHaveLength(2);
    expect(() => maintainBracesBackport(mobile, "unknown")).toThrow("unsupported mode");
    expect(() => buildBracesModuleEntry("unknown.js", "")).toThrow("unknown embedded source");
  });
});
