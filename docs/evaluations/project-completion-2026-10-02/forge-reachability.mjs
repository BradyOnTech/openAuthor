// Read installed tools and offline exports; synthetic keys stay in memory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const folder = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(folder, "../../..");
const mobile = path.join(repository, "mobile");
const require = createRequire(path.join(mobile, "node_modules/expo/package.json"));
const cliRoot = path.dirname(require.resolve("@expo/cli/package.json"));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const relative = file => path.relative(repository, file).replaceAll(path.sep, "/");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const walk = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
}) : [];

process.env.EXPO_OFFLINE = "1";
process.env.EXPO_NO_TELEMETRY = "1";
let networkAttempts = 0;
const blocked = () => { networkAttempts++; throw new Error("Network is blocked during Forge reachability inspection"); };
const savedConnect = net.Socket.prototype.connect;
const savedFetch = globalThis.fetch;
net.Socket.prototype.connect = blocked;
globalThis.fetch = blocked;
try {
  const { getConfig } = require("@expo/config");
  const { exp } = getConfig(mobile, { skipPlugins: true });
  const signing = require(path.join(cliRoot, "build/src/utils/codesigning.js"));
  const configChecks = [];
  for (const [name, header] of [["no signature header", undefined], ["Expo root header without EAS ID", 'keyid="expo-root"'], ["project key header without signing certificate", 'keyid="synthetic-project", alg="rsa-v1_5-sha256"']]) {
    const result = await signing.getCodeSigningInfoAsync(exp, header);
    assert.equal(result, null);
    configChecks.push({ name, returned: null });
  }

  const certificates = require("@expo/code-signing-certificates");
  const pair = certificates.generateKeyPair();
  let verifierCalls = 0;
  const verify = pair.publicKey.verify;
  pair.publicKey.verify = function (...arguments_) {
    verifierCalls++;
    return verify.apply(this, arguments_);
  };
  const now = Date.now();
  const certificate = certificates.generateSelfSignedCodeSigningCertificate({ keyPair: pair,
    validityNotBefore: new Date(now - 60000), validityNotAfter: new Date(now + 60000), commonName: "Synthetic reachability only" });
  certificates.validateSelfSignedCertificate(certificate, pair);
  assert.equal(verifierCalls, 1);
  certificates.signBufferRSASHA256AndVerify(pair.privateKey, certificate, Buffer.from("Synthetic manifest"));
  assert.equal(verifierCalls, 2);
  const csr = certificates.generateCSR(pair, "Synthetic CSR");
  certificates.generateDevelopmentCertificateFromCSR(pair.privateKey, certificate, csr, "synthetic-app", "synthetic-scope");
  assert.equal(verifierCalls, 3);
  assert.equal(networkAttempts, 0);

  const patterns = ["node-forge", "@expo/code-signing-certificates", "@expo/cli/build/src/utils/codesigning", "@expo/cli/build/src/run/ios/codeSigning"];
  const fingerprints = ["RSASSA-PKCS1-V1_5", "DigestAlgorithm identifier", "DigestInfo value", "expo-expect-signature header"];
  const existingRoot = path.join(mobile, ".expo/recovery-native-preflight");
  const originalBundles = walk(existingRoot).filter(file => /\.(?:js|hbc)$/.test(file)).map(file => {
    const bytes = fs.readFileSync(file);
    return { file: relative(file), sha256: hash(file), size_bytes: bytes.length,
      matching_verifier_strings: fingerprints.filter(value => bytes.includes(Buffer.from(value))) };
  });
  const mapRoot = path.resolve(process.argv[2] || "/private/tmp/openauthor-forge-source-map-inspection");
  const moduleLists = {};
  const maps = walk(mapRoot).filter(file => file.endsWith(".map")).map(file => {
    const map = readJson(file);
    const sources = map.sources || [];
    moduleLists[file.replace(mapRoot, "source-map-export")] = sources;
    return { file: file.replace(mapRoot, "source-map-export"), sha256: hash(file),
      source_count: sources.length, included_affected_modules: sources.filter(source => patterns.some(pattern => source.includes(pattern))),
      included_cli_modules: sources.filter(source => source.includes("@expo/cli")),
      bundle_sha256: hash(file.slice(0, -4)) };
  });
  assert.equal(maps.length, 3);
  assert(maps.every(map => map.source_count > 100));
  assert(maps.every(map => map.included_affected_modules.length === 0));
  const moduleListFile = path.join(folder, "forge-module-lists.json");
  fs.writeFileSync(moduleListFile, JSON.stringify(moduleLists, null, 2) + "\n");

  const sources = [path.join(mobile, "app.json"), path.join(mobile, "eas.json"), path.join(mobile, "package-lock.json"),
    require.resolve("@expo/code-signing-certificates"), require.resolve("node-forge/lib/rsa.js"), require.resolve("node-forge/lib/x509.js"),
    path.join(cliRoot, "build/src/utils/codesigning.js"), path.join(cliRoot, "build/src/start/server/middleware/ExpoGoManifestHandlerMiddleware.js"),
    path.join(cliRoot, "build/src/run/ios/codeSigning/Security.js")];
  const result = {
    schema_version: 1, recorded_at: new Date().toISOString(),
    scope: "Read-only installed-source analysis and offline synthetic probes; no crypto patch, audit suppression, signing credentials or deployed authorization",
    advisory: { id: "GHSA-86w9-cpqp-85rv", cve: "CVE-2026-85393", affected: "<=1.4.0", patched_version: null,
      url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv", pending_upstream_patch: "https://github.com/digitalbazaar/forge/pull/1152" },
    installed: Object.fromEntries(["expo", "@expo/cli", "@expo/code-signing-certificates", "node-forge"].map(name => [name, readJson(require.resolve(`${name}/package.json`)).version])),
    resolved_config: { has_code_signing_certificate: Boolean(exp.updates?.codeSigningCertificate), has_code_signing_metadata: Boolean(exp.updates?.codeSigningMetadata), has_eas_project_id: Boolean(exp.extra?.eas?.projectId) },
    offline_config_checks: configChecks, network_attempts: networkAttempts,
    positive_primitive_reachability: { installed_library_verifier_calls: verifierCalls,
      default_generated_rsa_exponent: pair.publicKey.e.toString(),
      exercised: ["validateSelfSignedCertificate → X509 certificate.verify → RSA publicKey.verify", "signBufferRSASHA256AndVerify → RSA publicKey.verify", "generateDevelopmentCertificateFromCSR → CSR.verify → RSA publicKey.verify"],
      exploit_demonstrated: false, private_keys_persisted: false },
    existing_export_bundles: originalBundles,
    offline_source_map_export: { command: "EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 npx expo export --platform all --source-maps --output-dir /private/tmp/openauthor-forge-source-map-inspection", maps,
      retained_module_lists: path.basename(moduleListFile), module_lists_sha256: hash(moduleListFile),
      interpretation: "Forge, the certificate helper and Expo signing modules are absent from these three Metro module lists. The Expo CLI Metro require loader is present. This is not evidence about native OS signing, embedded native libraries, EAS servers or future configured update pipelines." },
    source_sha256: Object.fromEntries(sources.map(file => [relative(file), hash(file)])),
    remaining_gate: "Supported patched release or reviewed tested mitigation/replacement; re-audit signing/update configurations and resulting artifacts. Current mobile audit remains 5 high entries from one underlying advisory."
  };
  fs.writeFileSync(path.join(folder, "forge-reachability.json"), JSON.stringify(result, null, 2) + "\n");
  console.log("Forge probe passed: 3 affected verification calls, 3 null config gates, 0 network attempts, 3 Metro module lists without Forge/certificate/signing modules.");
} finally {
  net.Socket.prototype.connect = savedConnect;
  globalThis.fetch = savedFetch;
}
