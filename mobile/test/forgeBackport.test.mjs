import { createHash, constants, generateKeyPairSync, privateEncrypt, sign, verify } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maintainForgeBackport } from "../scripts/forge-backport.mjs";

const mobile = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(mobile, "security/forge-backport-1.4.0.json"), "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const rsaFile = root => join(root, manifest.forge.path, manifest.forge.patch.path);

function project() {
  const root = mkdtempSync(join(tmpdir(), "openauthor-forge-backport-"));
  const copy = name => {
    const destination = join(root, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(mobile, name), destination);
  };
  copy("package.json");
  copy("package-lock.json");
  copy(manifest.expo_package_json.path);
  copy(manifest.expo_entrypoint.path);
  for (const name of Object.keys(manifest.forge.files)) copy(manifest.forge.path + "/" + name);
  for (const item of manifest.caller_packages) for (const name of Object.keys(item.files)) copy(item.path + "/" + name);
  // Keep the known vulnerable preimage as an isolated diagnostic control even
  // when npm postinstall has already repaired the real development tree.
  const current = readFileSync(rsaFile(root), "utf8");
  if (sha256(current) === manifest.forge.patch.patched_sha256) {
    writeFileSync(rsaFile(root), current.replace(manifest.forge.patch.after, manifest.forge.patch.before));
  }
  expect(sha256(readFileSync(rsaFile(root)))).toBe(manifest.forge.patch.original_sha256);
  return root;
}

function fixture(run) {
  const root = project();
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function digestInfo(forge, digest, algorithm = "sha256", extra = [], parameters = true, outer = []) {
  const { asn1 } = forge;
  const value = (type, bytes) => asn1.create(asn1.Class.UNIVERSAL, type, false, bytes);
  const sequence = nodes => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, nodes);
  return Buffer.from(asn1.toDer(sequence([
    sequence([value(asn1.Type.OID, asn1.oidToDer(forge.oids[algorithm]).getBytes()),
      ...(parameters ? [value(asn1.Type.NULL, "")] : []), ...extra]),
    value(asn1.Type.OCTETSTRING, digest.toString("latin1")), ...outer,
  ])).getBytes(), "latin1");
}

function encodedSignature(privateKey, info) {
  const bytes = privateKey.asymmetricKeyDetails.modulusLength / 8;
  const block = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(bytes - info.length - 3, 255), Buffer.from([0]), info]);
  return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, block);
}

function accepts(publicKey, digest, signature, scheme) {
  try { return publicKey.verify(digest.toString("latin1"), signature.toString("latin1"), scheme); } catch { return false; }
}

describe("byte-bound local Expo Forge backport", () => {
  it("check-only refuses original bytes without changing them", () => fixture(root => {
    const original = readFileSync(rsaFile(root));
    expect(() => maintainForgeBackport(root)).toThrow("reviewed backport not applied");
    expect(readFileSync(rsaFile(root))).toEqual(original);
  }));

  it("applies once, verifies every caller and leaves Forge version/audit scope unchanged", () => fixture(root => {
    const metadata = readFileSync(join(root, manifest.forge.path, "package.json"));
    const lock = readFileSync(join(root, "package-lock.json"));
    const first = maintainForgeBackport(root, "apply");
    expect(first.applied).toBe(true);
    expect(first.callers).toEqual(manifest.callers);
    expect(first.forge_version).toBe("1.4.0");
    expect(first.dependency_audit_gate).toBe("open");
    expect(first.unmodified_distribution_files).toContain("dist/forge.min.js");
    expect(maintainForgeBackport(root, "apply").applied).toBe(false);
    expect(maintainForgeBackport(root, "check").rsa_sha256).toBe(manifest.forge.patch.patched_sha256);
    expect(readFileSync(join(root, manifest.forge.path, "package.json"))).toEqual(metadata);
    expect(readFileSync(join(root, "package-lock.json"))).toEqual(lock);
  }));

  it.each([
    ["RSA", "node_modules/node-forge/lib/rsa.js"],
    ["ASN.1", "node_modules/node-forge/lib/asn1.js"],
    ["certificate helper", "node_modules/@expo/code-signing-certificates/build/main.js"],
    ["manifest caller", "node_modules/expo/node_modules/@expo/cli/build/src/utils/codesigning.js"],
    ["iOS caller", "node_modules/expo/node_modules/@expo/cli/build/src/run/ios/codeSigning/Security.js"],
    ["Expo CLI entry point", "node_modules/expo/node_modules/@expo/cli/build/bin/cli"],
  ])("refuses %s source drift before applying a patch", (_label, name) => fixture(root => {
    const originalRsa = readFileSync(rsaFile(root));
    const file = join(root, name);
    writeFileSync(file, readFileSync(file, "utf8") + "\n// synthetic source drift\n");
    const beforeAttempt = readFileSync(rsaFile(root));
    expect(() => maintainForgeBackport(root, "apply")).toThrow(/source bytes changed|unknown RSA source bytes/);
    expect(readFileSync(rsaFile(root))).toEqual(beforeAttempt);
    if (!name.endsWith("/rsa.js")) expect(readFileSync(rsaFile(root))).toEqual(originalRsa);
  }));

  it("refuses Expo entry-point drift before changing Forge", () => fixture(root => {
    const originalRsa = readFileSync(rsaFile(root));
    const file = join(root, manifest.expo_entrypoint.path);
    writeFileSync(file, readFileSync(file, "utf8") + "\n// synthetic source drift\n");
    expect(() => maintainForgeBackport(root, "apply")).toThrow("Expo entry point changed");
    expect(readFileSync(rsaFile(root))).toEqual(originalRsa);
  }));

  it("refuses drift after application instead of treating a marker as verification", () => fixture(root => {
    maintainForgeBackport(root, "apply");
    writeFileSync(rsaFile(root), readFileSync(rsaFile(root), "utf8") + "\n// synthetic postimage drift\n");
    expect(() => maintainForgeBackport(root)).toThrow("unknown RSA source bytes");
  }));

  it("refuses an unknown nested or aliased Forge copy before changing either copy", () => {
    for (const name of ["node_modules/@expo/code-signing-certificates/node_modules/node-forge", "node_modules/synthetic-forge-alias"]) fixture(root => {
      const original = readFileSync(rsaFile(root));
      const second = join(root, name);
      mkdirSync(dirname(second), { recursive: true });
      cpSync(join(root, manifest.forge.path), second, { recursive: true });
      expect(() => maintainForgeBackport(root, "apply")).toThrow("unknown installed Forge copy");
      expect(readFileSync(rsaFile(root))).toEqual(original);
      expect(readFileSync(join(second, "lib/rsa.js"))).toEqual(original);
    });
  });

  it("refuses unknown lock copies, versions and package file inventories", () => {
    for (const change of [
      root => {
        const file = join(root, "package-lock.json");
        const lock = JSON.parse(readFileSync(file));
        lock.packages["node_modules/new-parent/node_modules/node-forge"] = lock.packages[manifest.forge.path];
        writeFileSync(file, JSON.stringify(lock));
      },
      root => {
        const file = join(root, manifest.forge.path, "package.json");
        const metadata = JSON.parse(readFileSync(file));
        metadata.version = "1.4.1";
        writeFileSync(file, JSON.stringify(metadata));
      },
      root => writeFileSync(join(root, manifest.forge.path, "lib/new-verifier.js"), "exports.synthetic = true;\n"),
    ]) fixture(root => {
      const original = readFileSync(rsaFile(root));
      change(root);
      expect(() => maintainForgeBackport(root, "apply")).toThrow(/unknown locked Forge copy|source bytes changed|unexpected package file inventory/);
      expect(readFileSync(rsaFile(root))).toEqual(original);
    });
  });

  it("refuses a symlinked RSA file and does not write through it", () => fixture(root => {
    const original = readFileSync(rsaFile(root));
    const external = join(root, "synthetic-external-rsa.js");
    writeFileSync(external, original);
    rmSync(rsaFile(root));
    symlinkSync(external, rsaFile(root));
    expect(() => maintainForgeBackport(root, "apply")).toThrow("symlinked package content");
    expect(readFileSync(external)).toEqual(original);
  }));

  it("fresh install applies the repair and supported Expo entry points require check-only verification", () => {
    const { scripts } = JSON.parse(readFileSync(join(mobile, "package.json")));
    expect(scripts.postinstall).toBe("node scripts/forge-backport.mjs apply");
    for (const command of ["web", "start", "android", "ios", "prebuild", "doctor", "build:web", "build:export", "build:security", "build:test-hosted"]) {
      expect(scripts["pre" + command], command).toBe("node scripts/forge-backport.mjs check");
    }
    expect(JSON.parse(readFileSync(join(mobile, "package-lock.json"))).packages[""].hasInstallScript).toBe(true);
    expect(() => maintainForgeBackport(mobile, "unknown")).toThrow("unsupported mode");
  });
});

describe("Forge and actual Expo helper signature compatibility", () => {
  let root;
  let forge;
  let helper;
  let keys;
  beforeAll(() => {
    root = project();
    maintainForgeBackport(root, "apply");
    const require = createRequire(join(root, "package.json"));
    forge = require("node-forge");
    helper = require("@expo/code-signing-certificates");
    keys = [3, 65537].map(publicExponent => {
      const pair = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent });
      return { ...pair, publicExponent, forgePair: {
        publicKey: forge.pki.publicKeyFromPem(pair.publicKey.export({ type: "spki", format: "pem" })),
        privateKey: forge.pki.privateKeyFromPem(pair.privateKey.export({ type: "pkcs1", format: "pem" })),
      } };
    });
  });
  afterAll(() => { if (root && existsSync(root)) rmSync(root, { recursive: true, force: true }); });

  it.each(["sha1", "sha256", "sha384", "sha512"])("retains valid %s signatures against the Node/OpenSSL oracle", algorithm => {
    for (const key of keys) {
      const message = Buffer.from("Synthetic valid signature\0Unicode café");
      const digest = createHash(algorithm).update(message).digest();
      const signature = sign(algorithm, message, key.privateKey);
      expect(verify(algorithm, message, key.publicKey, signature)).toBe(true);
      expect(accepts(key.forgePair.publicKey, digest, signature)).toBe(true);
      const wrongDigest = Buffer.from(digest);
      wrongDigest[0] ^= 1;
      expect(accepts(key.forgePair.publicKey, wrongDigest, signature)).toBe(false);
    }
  });

  it("rejects extra nested elements with and without NULL for both public exponents", () => {
    for (const key of keys) for (const parameters of [true, false]) {
      const message = Buffer.from("Synthetic nested algorithm garbage");
      const digest = createHash("sha256").update(message).digest();
      const extra = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, "unconsumed-garbage");
      const signature = encodedSignature(key.privateKey, digestInfo(forge, digest, "sha256", [extra], parameters));
      expect(verify("sha256", message, key.publicKey, signature)).toBe(false);
      expect(accepts(key.forgePair.publicKey, digest, signature)).toBe(false);
    }
  });

  it("retains permitted absent SHA parameters and rejects outer garbage and trailing bytes", () => {
    const key = keys[1];
    const message = Buffer.from("Synthetic algorithm encoding controls");
    const digest = createHash("sha256").update(message).digest();
    const withoutNull = encodedSignature(key.privateKey, digestInfo(forge, digest, "sha256", [], false));
    expect(accepts(key.forgePair.publicKey, digest, withoutNull)).toBe(true);
    const extra = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, "outer-garbage");
    const outer = encodedSignature(key.privateKey, digestInfo(forge, digest, "sha256", [], true, [extra]));
    const trailing = encodedSignature(key.privateKey, Buffer.concat([digestInfo(forge, digest), Buffer.from([0]) ]));
    for (const signature of [outer, trailing]) {
      expect(verify("sha256", message, key.publicKey, signature)).toBe(false);
      expect(accepts(key.forgePair.publicKey, digest, signature)).toBe(false);
    }
  });

  it("leaves PSS and NONE verification paths compatible", () => {
    const key = keys[1];
    const message = Buffer.from("Synthetic alternate RSA schemes");
    const signature = sign("sha256", message, { key: key.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
    expect(verify("sha256", message, { key: key.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature)).toBe(true);
    const pss = forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength: 32 });
    expect(accepts(key.forgePair.publicKey, createHash("sha256").update(message).digest(), signature, pss)).toBe(true);
    const raw = createHash("sha256").update(message).digest();
    const none = key.forgePair.privateKey.sign(raw.toString("latin1"), "NONE");
    expect(key.forgePair.publicKey.verify(raw.toString("latin1"), none, "NONE")).toBe(true);
  });

  function certificate(key) {
    return helper.generateSelfSignedCodeSigningCertificate({ keyPair: key.forgePair,
      validityNotBefore: new Date("2020-01-01"), validityNotAfter: new Date("2099-01-01"), commonName: "Synthetic openAuthor compatibility" });
  }
  function tbsBytes(cert) { return Buffer.from(forge.asn1.toDer(forge.pki.getTBSCertificate(cert)).getBytes(), "latin1"); }

  it("validates actual Expo certificates, CSRs and manifest signatures against Node/OpenSSL", () => {
    for (const key of keys) {
      const cert = helper.convertCertificatePEMToCertificate(helper.convertCertificateToCertificatePEM(certificate(key)));
      expect(() => helper.validateSelfSignedCertificate(cert, key.forgePair)).not.toThrow();
      expect(verify("sha256", tbsBytes(cert), key.publicKey, Buffer.from(cert.signature, "latin1"))).toBe(true);
      const csr = helper.convertCSRPEMToCSR(helper.convertCSRToCSRPEM(helper.generateCSR(key.forgePair, "Synthetic CSR")));
      expect(csr.verify()).toBe(true);
      const issued = helper.generateDevelopmentCertificateFromCSR(key.forgePair.privateKey, cert, csr, "synthetic-project", "synthetic-scope");
      expect(verify("sha256", tbsBytes(issued), key.publicKey, Buffer.from(issued.signature, "latin1"))).toBe(true);
      const message = Buffer.from('{"synthetic":"manifest café"}');
      const signature = Buffer.from(helper.signBufferRSASHA256AndVerify(key.forgePair.privateKey, cert, message), "base64");
      expect(verify("sha256", message, key.publicKey, signature)).toBe(true);
      expect(verify("sha256", Buffer.from("changed"), key.publicKey, signature)).toBe(false);
    }
  });

  it("actual Expo certificate/CSR helpers refuse malformed nested signature encodings", () => {
    const key = keys[0];
    const extra = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, "unconsumed-garbage");
    const cert = certificate(key);
    const certificateDigest = createHash("sha256").update(tbsBytes(cert)).digest();
    cert.signature = encodedSignature(key.privateKey, digestInfo(forge, certificateDigest, "sha256", [extra])).toString("latin1");
    expect(() => helper.validateSelfSignedCertificate(cert, key.forgePair)).toThrow(/DigestInfo/);
    const csr = helper.generateCSR(key.forgePair, "Synthetic malformed CSR");
    const request = Buffer.from(forge.asn1.toDer(forge.pki.getCertificationRequestInfo(csr)).getBytes(), "latin1");
    const requestDigest = createHash("sha256").update(request).digest();
    csr.signature = encodedSignature(key.privateKey, digestInfo(forge, requestDigest, "sha256", [extra])).toString("latin1");
    expect(() => helper.generateDevelopmentCertificateFromCSR(key.forgePair.privateKey, certificate(key), csr, "synthetic-project", "synthetic-scope")).toThrow(/DigestInfo/);
  });
});
