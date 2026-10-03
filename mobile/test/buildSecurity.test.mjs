import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { inspectExport, inspectProject, parseExportArguments } from "../scripts/build-security.mjs";

const mobile = resolve(import.meta.dirname, "..");
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "openauthor-build-security-"));
  try { return run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
function project(directory, changes = {}) {
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "synthetic-security-check", version: "1.0.0" }));
  writeFileSync(join(directory, "app.json"), JSON.stringify({ expo: { name: "Synthetic", slug: "synthetic", sdkVersion: "57.0.0", ...changes } }));
  symlinkSync(join(mobile, "node_modules"), join(directory, "node_modules"), "dir");
}
function bundle(directory, platform, sources = ["/node_modules/expo/node_modules/@expo/cli/build/metro-require/require.js", "/app/index.ts"]) {
  const target = join(directory, "_expo", "static", "js", platform);
  mkdirSync(target, { recursive: true });
  const file = join(target, platform === "web" ? "index.js" : "index.hbc");
  writeFileSync(file, "synthetic bundle metadata fixture");
  writeFileSync(file + ".map", JSON.stringify({ version: 3, sources, mappings: "AAAA" }));
  return file;
}

describe("mobile build security containment", () => {
  it("checks the actual installed Expo config and all three signing-header branches offline", () => {
    const result = spawnSync(process.execPath, ["scripts/build-security.mjs", "preflight"], { cwd: mobile, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.dependency_audit_gate).toBe("open");
    expect(report.advisories).toEqual(["GHSA-86w9-cpqp-85rv", "GHSA-vfj7-8cjw-p6xm"]);
    expect(report.signing_header_checks).toBe(3);
    expect(report.network_attempts).toBe(0);
    expect(report.installed["node-forge"]).toBe("1.4.0");
    expect(report.installed.braces).toBe("3.0.3");
    expect(report.installed.micromatch).toBe("4.0.8");
  });

  it("refuses a configured certificate before reading its nonexistent key or certificate", () => fixture(directory => {
    project(directory, { updates: { codeSigningCertificate: "/nonexistent/private-certificate.pem" } });
    expect(() => inspectProject(directory)).toThrow("Signing configuration requires security review");
  }));

  it("refuses metadata-only activation and Expo-root EAS activation", () => {
    for (const changes of [{ updates: { codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" } } }, { extra: { eas: { projectId: "synthetic-project" } } }]) {
      fixture(directory => {
        project(directory, changes);
        expect(() => inspectProject(directory)).toThrow("Signing configuration requires security review");
      });
    }
  });

  it("refuses empty or malformed signing fields rather than treating them as safe absence", () => {
    for (const changes of [{ updates: { codeSigningCertificate: "" } }, { updates: { codeSigningMetadata: null } }, { extra: { eas: { projectId: null } } }]) {
      fixture(directory => {
        project(directory, changes);
        expect(() => inspectProject(directory)).toThrow("Signing configuration requires security review");
      });
    }
  });

  it("checks the fully resolved config including a plugin that activates signing", () => fixture(directory => {
    project(directory, { plugins: ["./activate-signing.cjs"] });
    writeFileSync(join(directory, "activate-signing.cjs"), "module.exports = config => ({...config, updates: {codeSigningCertificate: './not-read.pem'}});\n");
    expect(() => inspectProject(directory)).toThrow("Signing configuration requires security review");
  }));

  it("uses the export production dotenv mode for dynamic config and restores its process environment", () => fixture(directory => {
    project(directory);
    writeFileSync(join(directory, ".env.production"), "SYNTHETIC_SIGNING_PROJECT=synthetic-env-project\n");
    writeFileSync(join(directory, "app.config.js"), "module.exports = ({config}) => ({...config, extra: {eas: {projectId: process.env.SYNTHETIC_SIGNING_PROJECT}}});\n");
    const previous = process.env.SYNTHETIC_SIGNING_PROJECT;
    delete process.env.SYNTHETIC_SIGNING_PROJECT;
    try {
      expect(() => inspectProject(directory)).toThrow("Signing configuration requires security review");
      expect(process.env.SYNTHETIC_SIGNING_PROJECT).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.SYNTHETIC_SIGNING_PROJECT = previous;
    }
  }));

  it("inspects each requested platform and permits the harmless CLI Metro loader", () => fixture(directory => {
    for (const platform of ["web", "ios", "android"]) bundle(directory, platform);
    const report = inspectExport(directory, ["web", "ios", "android"]);
    expect(report.map_count).toBe(3);
    expect(report.platforms).toEqual(["web", "ios", "android"]);
    expect(report.bundles.every(item => item.source_count === 2 && /^[a-f0-9]{64}$/.test(item.bundle_sha256))).toBe(true);
  }));

  it("accepts Metro's real NUL-prefixed virtual web source identifiers", () => fixture(directory => {
    bundle(directory, "web", ["__prelude__", "\0polyfill:external-require", "/app/index.ts"]);
    expect(inspectExport(directory, ["web"]).bundles[0].source_count).toBe(3);
  }));

  it("refuses the affected verifier, helper and signing modules including Windows paths", () => {
    for (const source of ["/node_modules/node-forge/lib/rsa.js", "C:\\build\\node_modules\\node-forge\\lib\\x509.js", "/node_modules/@expo/code-signing-certificates/build/main.js", "/node_modules/expo/node_modules/@expo/cli/build/src/utils/codesigning.js", "/node_modules/@expo/cli/src/run/ios/codeSigning/Security.ts"]) {
      fixture(directory => {
        bundle(directory, "web", [source]);
        expect(() => inspectExport(directory, ["web"])).toThrow("Affected signing module entered export");
      });
    }
  });

  it.each([
    "/node_modules/braces/lib/compile.js",
    "C:\\build\\node_modules\\braces\\lib\\expand.js",
    "/node_modules/micromatch/index.js",
    "/node_modules/resolve-workspace-root/build/index.js",
    "/node_modules/expo-doctor/build/index.js",
    "/node_modules/expo/node_modules/resolve-workspace-root/build/index.js",
    "C:\\build\\node_modules\\expo-doctor\\build\\index.js",
    "C:\\build\\node_modules\\expo\\node_modules\\micromatch\\index.js",
  ])("refuses pattern tooling in an app export: %s", source => fixture(directory => {
    bundle(directory, "web", [source]);
    expect(() => inspectExport(directory, ["web"])).toThrow("Pattern tooling module entered export");
  }));

  it("permits distinct pattern libraries and similarly named application sources", () => fixture(directory => {
    const sources = [
      "/node_modules/picomatch/lib/parse.js",
      "/node_modules/brace-expansion/dist/commonjs/index.js",
      "/node_modules/micromatch-tools/index.js",
      "/app/braces.css",
      "/app/index.ts",
    ];
    bundle(directory, "web", sources);
    expect(inspectExport(directory, ["web"]).bundles[0].source_count).toBe(sources.length);
  }));

  it("refuses an embedded pattern-tooling module hidden in nested source-map sections", () => fixture(directory => {
    const file = bundle(directory, "ios");
    writeFileSync(file + ".map", JSON.stringify({
      version: 3,
      sections: [{ offset: { line: 0, column: 0 }, map: {
        version: 3,
        sections: [{ offset: { line: 0, column: 0 }, map: {
          version: 3, sources: ["/node_modules/resolve-workspace-root/build/index.js"], mappings: "AAAA",
        } }],
      } }],
    }));
    expect(() => inspectExport(directory, ["ios"])).toThrow("Pattern tooling module entered export");
  }));

  it("resolves sourceRoot before refusing a relative Braces module", () => fixture(directory => {
    const file = bundle(directory, "android");
    writeFileSync(file + ".map", JSON.stringify({ version: 3, sourceRoot: "C:\\build\\node_modules\\braces", sources: ["lib/compile.js"], mappings: "AAAA" }));
    expect(() => inspectExport(directory, ["android"])).toThrow("Pattern tooling module entered export");
  }));

  it("requires every bundle map and every requested platform, with valid nonempty maps", () => {
    fixture(directory => {
      const file = bundle(directory, "web");
      expect(() => inspectExport(directory, ["web", "ios"])).toThrow("Export inspection incomplete");
      rmSync(file + ".map");
      expect(() => inspectExport(directory, ["web"])).toThrow("Export inspection incomplete");
    });
    for (const contents of ["{", JSON.stringify({ version: 3, sources: [] }), JSON.stringify({ version: 2, sources: ["/app/index.ts"] }), JSON.stringify({ version: 3, sources: [null] })]) fixture(directory => {
      const file = bundle(directory, "web");
      writeFileSync(file + ".map", contents);
      expect(() => inspectExport(directory, ["web"])).toThrow("Export inspection incomplete");
    });
  });

  it("checks nested source-map sections and refuses a hidden affected section", () => fixture(directory => {
    const file = bundle(directory, "web");
    const section = sources => ({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: { version: 3, sources, mappings: "AAAA" } }] });
    writeFileSync(file + ".map", JSON.stringify(section(["/app/index.ts"])));
    expect(inspectExport(directory, ["web"]).bundles[0].source_count).toBe(1);
    writeFileSync(file + ".map", JSON.stringify(section(["/node_modules/node-forge/lib/rsa.js"])));
    expect(() => inspectExport(directory, ["web"])).toThrow("Affected signing module entered export");
  }));

  it("resolves sourceRoot before checking relative source names", () => fixture(directory => {
    const file = bundle(directory, "web");
    writeFileSync(file + ".map", JSON.stringify({ version: 3, sourceRoot: "/node_modules/node-forge", sources: ["lib/rsa.js"], mappings: "AAAA" }));
    expect(() => inspectExport(directory, ["web"])).toThrow("Affected signing module entered export");
  }));

  it("refuses symlinked inspection artifacts", () => fixture(directory => {
    const file = bundle(directory, "web");
    const original = readFileSync(file + ".map");
    writeFileSync(join(directory, "source.map"), original);
    rmSync(file + ".map");
    symlinkSync(join(directory, "source.map"), file + ".map");
    expect(() => inspectExport(directory, ["web"])).toThrow("Export inspection incomplete");
  }));

  it("permits only reviewed export arguments and never a private signing-key option", () => {
    expect(parseExportArguments(["--platform", "all", "--output-dir", "dist"])).toEqual({ platforms: ["web", "ios", "android"], output: "dist", platform: "all" });
    for (const args of [["--private-key-path", "private.pem"], ["--platform", "unknown"], ["--platform", "web", "--platform", "ios"], ["--output-dir"], ["--no-source-maps"]]) {
      expect(() => parseExportArguments(args)).toThrow("Unsupported guarded export arguments");
    }
  });
});
