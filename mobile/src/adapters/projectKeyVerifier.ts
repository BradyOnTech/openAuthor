import {
  parseProjectKeyVerifier,
  PROJECT_KEY_VERIFIER_PLAINTEXT,
  projectKeyVerifierAdditionalData,
} from "@openauthor/contracts";
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, CryptoDigestAlgorithm, digest } from "expo-crypto";

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
}

/** The checksum authenticates bytes; AES-GCM authenticates the candidate and
 * the selected immutable book/version before a plaintext key may be saved. */
export async function verifyProjectKeyVerifier(
  value: unknown,
  projectKey: string,
  expected: { projectId: string; keyVersion: number },
): Promise<{ projectId: string; keyVersion: number }> {
  const verifier = parseProjectKeyVerifier(value);
  if (verifier.project_id !== expected.projectId || verifier.key_version !== expected.keyVersion) {
    throw new Error("The key verifier does not match the selected book and version.");
  }
  const ciphertext = bytes(verifier.ciphertext_hex);
  const actualDigest = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, ciphertext));
  if (Array.from(actualDigest, byte => byte.toString(16).padStart(2, "0")).join("") !== verifier.ciphertext_sha256) {
    throw new Error("The key verifier ciphertext digest is invalid.");
  }
  const canonical = projectKey.replace(/-/g, "+").replace(/_/g, "/");
  const key = await AESEncryptionKey.import(canonical.padEnd(Math.ceil(canonical.length / 4) * 4, "="), "base64");
  let plaintext: Uint8Array;
  try {
    plaintext = await aesDecryptAsync(
      AESSealedData.fromParts(bytes(verifier.nonce_hex), ciphertext, 16),
      key,
      { additionalData: projectKeyVerifierAdditionalData(verifier.project_id, verifier.key_version) },
    );
  } catch {
    throw new Error("This recovery key cannot unlock the selected book. Check the key and version on desktop.");
  }
  const expectedPlaintext = new TextEncoder().encode(PROJECT_KEY_VERIFIER_PLAINTEXT);
  if (typeof plaintext === "string" || plaintext.length !== expectedPlaintext.length
    || !expectedPlaintext.every((byte, index) => plaintext[index] === byte)) {
    throw new Error("The key verifier plaintext is invalid.");
  }
  return { projectId: verifier.project_id, keyVersion: verifier.key_version };
}
