import { describe, expect, it } from "vitest";
import { PROJECT_KEY_VERIFIER_PLAINTEXT, projectKeyVerifierAdditionalData } from "@openauthor/contracts";
import { createProjectKeyVerifier, verifyProjectKeyVerifier } from "./projectKeyVerifier";
import { importMobileRecoveryKey } from "./projectKeyProvisioning";
import { recoveryFixtureKey, recoveryFixtureProject } from "./recoverySnapshot.fixture";

const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
async function digest(value: Uint8Array) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer))); }

describe("immutable non-prose project-key verifier", () => {
  it("authenticates the actual nonextractable OA1 key without snapshot or raw key export", async () => {
    const key = await importMobileRecoveryKey(recoveryFixtureKey);
    const verifier = { ...await createProjectKeyVerifier(key, recoveryFixtureProject, 3) };
    expect(key.extractable).toBe(false);
    expect(verifier).toMatchObject({ project_id: recoveryFixtureProject, key_version: 3 });
    expect(verifier.nonce_hex).toHaveLength(24); expect(verifier.ciphertext_hex).toHaveLength(114);
    await expect(verifyProjectKeyVerifier(key, verifier, recoveryFixtureProject, 3)).resolves.toBeUndefined();
    expect(JSON.stringify(verifier)).not.toContain("OA1-");
  });
  it.each(["key", "project", "version", "nonce", "ciphertext", "digest", "unknown"])("refuses changed %s proof before accepting the candidate", async kind => {
    const key = await importMobileRecoveryKey(recoveryFixtureKey);
    let candidate = key;
    const verifier = { ...await createProjectKeyVerifier(key, recoveryFixtureProject, 3) };
    if (kind === "key") candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    if (kind === "project") verifier.project_id = recoveryFixtureProject.replace(/1$/, "2");
    if (kind === "version") verifier.key_version++;
    if (kind === "nonce") verifier.nonce_hex = "01".repeat(12);
    if (kind === "ciphertext") { verifier.ciphertext_hex = "01".repeat(57); verifier.ciphertext_sha256 = await digest(new Uint8Array(57).fill(1)); }
    if (kind === "digest") verifier.ciphertext_sha256 = "0".repeat(64);
    if (kind === "unknown") (verifier as unknown as Record<string, unknown>).key = "extra";
    await expect(verifyProjectKeyVerifier(candidate, verifier, recoveryFixtureProject, 3)).rejects.toThrow();
  });
  it("requires exact fixed plaintext even when another same-length message has valid AEAD", async () => {
    const key = await importMobileRecoveryKey(recoveryFixtureKey);
    const verifier = { ...await createProjectKeyVerifier(key, recoveryFixtureProject, 3) };
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new Uint8Array(projectKeyVerifierAdditionalData(recoveryFixtureProject, 3)).buffer }, key, new TextEncoder().encode("x".repeat(PROJECT_KEY_VERIFIER_PLAINTEXT.length))));
    verifier.nonce_hex = hex(nonce); verifier.ciphertext_hex = hex(ciphertext); verifier.ciphertext_sha256 = await digest(ciphertext);
    await expect(verifyProjectKeyVerifier(key, verifier, recoveryFixtureProject, 3)).rejects.toThrow("fixed");
  });
});
