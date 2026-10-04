import assert from "node:assert/strict";
import test from "node:test";
import { ContractValidationError, parseProjectKeyVerifier, projectKeyVerifierAdditionalData, PROJECT_KEY_VERIFIER_PLAINTEXT } from "../src/index.ts";

const project = "10000000-0000-4000-8000-000000000001";
const verifier = {
  schema: "openauthor.mobile.project-key-verifier", schema_version: 1,
  project_id: project, key_version: 3, algorithm: "aes-256-gcm-v1", aad_version: 1,
  nonce_hex: "01".repeat(12), ciphertext_hex: "02".repeat(57), ciphertext_sha256: "a".repeat(64),
};

test("project verifier contract copies only fixed bounded canonical proof fields", () => {
  const parsed = parseProjectKeyVerifier(verifier);
  assert.deepEqual({ ...parsed }, verifier);
  assert.notEqual(parsed, verifier);
  assert.equal(new TextEncoder().encode(PROJECT_KEY_VERIFIER_PLAINTEXT).length, 41);
});

test("verifier contract refuses unknown, oversized, noncanonical and unsupported values", () => {
  for (const patch of [
    { plaintext_key: "secret" }, { schema_version: 2 }, { aad_version: 2 }, { algorithm: "other" },
    { project_id: "book-name" }, { project_id: project.toUpperCase().replace("000000000001", "00000000000A") },
    { key_version: 0 }, { key_version: 1.5 }, { key_version: 2147483648 },
    { nonce_hex: "00".repeat(13) }, { nonce_hex: "AB".repeat(12) },
    { ciphertext_hex: "00".repeat(58) }, { ciphertext_hex: "00".repeat(56) },
    { ciphertext_sha256: "not-a-digest" },
  ]) assert.throws(() => parseProjectKeyVerifier({ ...verifier, ...patch }), ContractValidationError);
});

test("verifier AAD distinguishes exact project/version and canonicalizes UUID case", () => {
  const decode = (id: string, version: number) => new TextDecoder().decode(projectKeyVerifierAdditionalData(id, version));
  assert.equal(decode(project, 3), [PROJECT_KEY_VERIFIER_PLAINTEXT, project, "3"].join("\0"));
  assert.notEqual(decode(project, 3), decode(project, 4));
  assert.notEqual(decode(project, 3), decode(project.replace(/1$/, "2"), 3));
  assert.equal(decode(project, 3), decode(project.toUpperCase(), 3));
  assert.throws(() => projectKeyVerifierAdditionalData("another-book", 3));
  assert.throws(() => projectKeyVerifierAdditionalData(project, 0));
});
