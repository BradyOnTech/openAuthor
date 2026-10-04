import { describe, expect, it } from "vitest";
import { importMobileRecoveryKey, sealMobileRecoveryKey } from "./projectKeyProvisioning";
import { recoveryDigest, validateRecoverySnapshot, verifyRecoverySnapshot } from "./snapshotRecovery";
import { recoveryFixtureKey, recoveryFixtureProject, recoveryMetadata, recoverySnapshotFixture } from "./recoverySnapshot.fixture";

describe("authenticated snapshot key recovery", () => {
  it("accepts the actual desktop-published manifest and snapshot with a matching nonextractable key", async () => {
    const snapshot = await recoverySnapshotFixture();
    const key = await importMobileRecoveryKey(recoveryFixtureKey);
    expect(key.extractable).toBe(false);
    await expect(verifyRecoverySnapshot(key, recoveryMetadata(snapshot), snapshot.ciphertext_base64)).resolves.toBeUndefined();
  });

  it("rejects a distinct valid AES key before any book identity claim can be trusted", async () => {
    const snapshot = await recoverySnapshotFixture();
    const other = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await expect(verifyRecoverySnapshot(other, recoveryMetadata(snapshot), snapshot.ciphertext_base64)).rejects.toThrow("could not authenticate");
  });

  it.each(["manifest", "object"])("rejects %s AEAD corruption even when its public ciphertext digest is recomputed", async kind => {
    const snapshot = await recoverySnapshotFixture();
    const metadata = recoveryMetadata(snapshot);
    let ciphertext = snapshot.ciphertext_base64;
    if (kind === "manifest") {
      metadata.manifestCiphertext[0] ^= 1;
      metadata.manifestSha256 = await recoveryDigest(metadata.manifestCiphertext);
    } else {
      const bytes = Uint8Array.from(atob(ciphertext), character => character.charCodeAt(0)); bytes[12] ^= 1;
      ciphertext = btoa(String.fromCharCode(...bytes));
      metadata.ciphertextSha256 = await recoveryDigest(new TextEncoder().encode(ciphertext));
    }
    await expect(verifyRecoverySnapshot(await importMobileRecoveryKey(recoveryFixtureKey), metadata, ciphertext)).rejects.toThrow("could not authenticate");
  });

  it.each(["project", "version", "snapshot", "revision"])("rejects substituted %s metadata through AEAD binding", async field => {
    const snapshot = await recoverySnapshotFixture();
    const metadata = recoveryMetadata(snapshot);
    if (field === "project") { metadata.projectId = "10000000-0000-4000-8000-000000000002"; metadata.objectPath = metadata.objectPath.replace(recoveryFixtureProject, metadata.projectId); }
    if (field === "version") metadata.keyVersion++;
    if (field === "snapshot") { metadata.snapshotId = "50000000-0000-4000-8000-000000000002"; metadata.objectPath = `projects/${metadata.projectId}/snapshots/${metadata.snapshotId}.bin`; }
    if (field === "revision") metadata.revision = "another-revision";
    await expect(verifyRecoverySnapshot(await importMobileRecoveryKey(recoveryFixtureKey), metadata, snapshot.ciphertext_base64)).rejects.toThrow("could not authenticate");
  });

  it("rejects authenticated prose with a different plaintext project identity", async () => {
    const snapshot = await recoverySnapshotFixture({ plaintextProjectId: "another-book" });
    await expect(verifyRecoverySnapshot(await importMobileRecoveryKey(recoveryFixtureKey), recoveryMetadata(snapshot), snapshot.ciphertext_base64)).rejects.toThrow("another book");
  });

  it("requires the exact caller-reviewed book/version, scoped object path and bounded object before download", async () => {
    const metadata = recoveryMetadata(await recoverySnapshotFixture());
    expect(() => validateRecoverySnapshot(metadata, "another-book", 3)).toThrow("another book");
    expect(() => validateRecoverySnapshot(metadata, recoveryFixtureProject, 4)).toThrow("another book");
    expect(() => validateRecoverySnapshot({ ...metadata, objectPath: "projects/other/snapshots/file.bin" }, recoveryFixtureProject, 3)).toThrow();
    expect(() => validateRecoverySnapshot({ ...metadata, byteLength: 64 * 1024 * 1024 + 1 }, recoveryFixtureProject, 3)).toThrow();
  });

  it("erases the raw recovery key after sealing both success and refusal", async () => {
    let retained: Uint8Array | undefined;
    const publicKey = "A".repeat(43);
    await sealMobileRecoveryKey(recoveryFixtureKey, publicKey, { seal: async raw => { retained = raw; expect(raw[1]).toBe(1); return new Uint8Array(80).fill(8); } });
    expect(retained).toEqual(new Uint8Array(32));
    await expect(sealMobileRecoveryKey(recoveryFixtureKey, publicKey, { seal: async raw => { retained = raw; throw new Error("sealing refused"); } })).rejects.toThrow("refused");
    expect(retained).toEqual(new Uint8Array(32));
  });
});
