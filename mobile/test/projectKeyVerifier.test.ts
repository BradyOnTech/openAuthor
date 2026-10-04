import { describe, expect, it, vi } from "vitest";
import {
  PROJECT_KEY_VERIFIER_PLAINTEXT,
  projectKeyVerifierAdditionalData,
  type ProjectKeyVerifier,
} from "@openauthor/contracts";

vi.mock("expo", () => ({ NativeModule: class {}, registerWebModule: (type: new () => unknown) => new type() }));
vi.mock("expo-modules-core", () => ({ CodedError: class extends Error {} }));
vi.mock("expo-crypto/src/aes/ExpoCryptoAES", async () => await vi.importActual("expo-crypto/src/aes/ExpoCryptoAES.web"));
vi.mock("expo-crypto", async () => {
  const aes = await vi.importActual<Record<string, unknown>>("expo-crypto/src/aes/index");
  return { ...aes, CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: (algorithm: string, bytes: BufferSource) => crypto.subtle.digest(algorithm, bytes) };
});

import { verifyProjectKeyVerifier } from "../src/adapters/projectKeyVerifier";

const projectId = "30000000-0000-4000-8000-000000000001";
const keyVersion = 4;
const key = new Uint8Array(Array.from({ length: 32 }, (_, index) => index));
const projectKey = btoa(String.fromCharCode(...key));
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

async function witness(input: { plaintext?: string; aad?: Uint8Array } = {}): Promise<ProjectKeyVerifier> {
  const nonce = new Uint8Array(12).fill(9);
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce,
    additionalData: new Uint8Array(input.aad ?? projectKeyVerifierAdditionalData(projectId, keyVersion)), tagLength: 128 },
  aes, new TextEncoder().encode(input.plaintext ?? PROJECT_KEY_VERIFIER_PLAINTEXT)));
  return { schema: "openauthor.mobile.project-key-verifier", schema_version: 1, project_id: projectId, key_version: keyVersion,
    algorithm: "aes-256-gcm-v1", aad_version: 1, nonce_hex: hex(nonce), ciphertext_hex: hex(ciphertext),
    ciphertext_sha256: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext))) };
}

describe("mobile immutable project key verifier through installed Expo AES", () => {
  it("authenticates a selected book/version without any encrypted snapshot", async () => {
    await expect(verifyProjectKeyVerifier(await witness(), projectKey, { projectId, keyVersion })).resolves.toEqual({ projectId, keyVersion });
  });
  it("rejects a checksum-valid different book key", async () => {
    await expect(verifyProjectKeyVerifier(await witness(), btoa(String.fromCharCode(...new Uint8Array(32).fill(3))), { projectId, keyVersion })).rejects.toThrow();
  });
  it.each(["schema", "schema_version", "project_id", "key_version", "algorithm", "aad_version", "nonce_hex", "ciphertext_hex", "ciphertext_sha256"])("refuses changed %s", async field => {
    const value = await witness();
    const changes: Record<string, unknown> = { schema: "other", schema_version: 2, project_id: "30000000-0000-4000-8000-000000000002", key_version: 5,
      algorithm: "other", aad_version: 2, nonce_hex: "0".repeat(24), ciphertext_hex: "0".repeat(114), ciphertext_sha256: "0".repeat(64) };
    await expect(verifyProjectKeyVerifier({ ...value, [field]: changes[field] }, projectKey, { projectId, keyVersion })).rejects.toThrow();
  });
  it("refuses authentic ciphertext with different fixed plaintext", async () => {
    await expect(verifyProjectKeyVerifier(await witness({ plaintext: "x".repeat(41) }), projectKey, { projectId, keyVersion })).rejects.toThrow();
  });
  it("refuses authentic ciphertext sealed under a different AAD domain", async () => {
    await expect(verifyProjectKeyVerifier(await witness({ aad: new TextEncoder().encode("other") }), projectKey, { projectId, keyVersion })).rejects.toThrow();
  });
  it("refuses a corrupted tag even when its ciphertext digest is recomputed", async () => {
    const value = await witness();
    const ciphertext = Uint8Array.from(value.ciphertext_hex.match(/../g)!, byte => Number.parseInt(byte, 16));
    ciphertext[ciphertext.length - 1] = ciphertext[ciphertext.length - 1]! ^ 1;
    value.ciphertext_hex = hex(ciphertext);
    value.ciphertext_sha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext)));
    await expect(verifyProjectKeyVerifier(value, projectKey, { projectId, keyVersion })).rejects.toThrow();
  });
});
