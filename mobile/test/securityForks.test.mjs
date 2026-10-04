import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySecurityForks } from "../scripts/verify-security-forks.mjs";

const mobile = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(mobile, "security/forks.json"), "utf8"));
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "openauthor-security-forks-"));
  try {
    for (const name of ["package.json", "package-lock.json", ...manifest.packages.flatMap(spec => [spec.archive, spec.upstream_archive])]) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      cpSync(join(mobile, name), join(root, name));
    }
    return run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("modified security fork delivery", () => {
  it("requires independently pinned modified archives and honest lock identities", () => {
    const report = verifySecurityForks();
    expect(report.packages).toEqual(["@openauthor/braces", "@openauthor/node-forge"]);
    expect(report.upstream_advisory_gate).toBe("open");
    expect(report.dependency_audit_gate).toBe("separate_raw_audit_required");
  });

  it.each(manifest.packages)("refuses original, changed or symlinked $upstream_name distributions", spec => {
    for (const replace of [
      root => cpSync(join(root, spec.upstream_archive), join(root, spec.archive)),
      root => writeFileSync(join(root, spec.archive), Buffer.concat([readFileSync(join(root, spec.archive)), Buffer.from([1])])),
      root => { rmSync(join(root, spec.archive)); symlinkSync(join(mobile, spec.archive), join(root, spec.archive)); },
    ]) fixture(root => {
      replace(root);
      expect(() => verifySecurityForks(root)).toThrow(/modified archive integrity changed|symlinked archive content/);
    });
  });

  it.each(manifest.packages)("refuses $upstream_name provenance, override and lock drift", spec => {
    fixture(root => {
      writeFileSync(join(root, spec.upstream_archive), Buffer.from("synthetic altered upstream distribution"));
      expect(() => verifySecurityForks(root)).toThrow("upstream archive integrity changed");
    });
    fixture(root => {
      const file = join(root, "package.json");
      const metadata = JSON.parse(readFileSync(file));
      metadata.overrides[spec.upstream_name] = "*";
      writeFileSync(file, JSON.stringify(metadata));
      expect(() => verifySecurityForks(root)).toThrow("fork dependency override changed");
    });
    for (const edit of [entry => { entry.name = spec.upstream_name; }, entry => { entry.link = true; }, entry => { entry.integrity = "synthetic drift"; }]) fixture(root => {
      const file = join(root, "package-lock.json");
      const lock = JSON.parse(readFileSync(file));
      edit(lock.packages["node_modules/" + spec.upstream_name]);
      writeFileSync(file, JSON.stringify(lock));
      expect(() => verifySecurityForks(root)).toThrow("fork lock identity changed");
    });
  });

  it("omits every old Forge browser/Flash distribution from the installed fork", () => {
    const forge = manifest.packages.find(spec => spec.upstream_name === "node-forge");
    expect(Object.keys(forge.files).some(name => /^(dist|flash)\//.test(name))).toBe(false);
    for (const name of Object.keys(forge.upstream_files).filter(name => /^(dist|flash)\//.test(name))) {
      expect(() => readFileSync(join(mobile, "node_modules/node-forge", name))).toThrow();
    }
    const metadata = JSON.parse(readFileSync(join(mobile, "node_modules/node-forge/package.json")));
    expect(metadata.openauthorSecurityFork.advisory).toBe("GHSA-86w9-cpqp-85rv");
    expect(metadata.files).toEqual(["lib/*.js", "LICENSE", "README.md", "SECURITY-FORK.md"]);
  });
});
