import { parseProjectKeyVerifier, PROJECT_KEY_VERIFIER_PLAINTEXT, projectKeyVerifierAdditionalData, type ProjectKeyVerifier } from "@openauthor/contracts";

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function bytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
}

export async function createProjectKeyVerifier(projectKey: CryptoKey, projectId: string, keyVersion: number,
  cryptoProvider: Pick<Crypto, "subtle" | "getRandomValues"> = crypto): Promise<ProjectKeyVerifier> {
  const additionalData = projectKeyVerifierAdditionalData(projectId, keyVersion);
  const nonce = cryptoProvider.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await cryptoProvider.subtle.encrypt({ name: "AES-GCM", iv: buffer(nonce), additionalData: buffer(additionalData), tagLength: 128 },
    projectKey, new TextEncoder().encode(PROJECT_KEY_VERIFIER_PLAINTEXT)));
  return parseProjectKeyVerifier({
    schema: "openauthor.mobile.project-key-verifier", schema_version: 1,
    project_id: projectId.toLowerCase(), key_version: keyVersion, algorithm: "aes-256-gcm-v1", aad_version: 1,
    nonce_hex: hex(nonce), ciphertext_hex: hex(ciphertext),
    ciphertext_sha256: hex(new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", buffer(ciphertext)))),
  });
}

export async function verifyProjectKeyVerifier(projectKey: CryptoKey, value: unknown, projectId: string, keyVersion: number): Promise<void> {
  const verifier = parseProjectKeyVerifier(value);
  const additionalData = projectKeyVerifierAdditionalData(projectId, keyVersion);
  if (verifier.project_id !== projectId.toLowerCase() || verifier.key_version !== keyVersion) {
    throw new Error("The recovery verifier belongs to another book or key version.");
  }
  const ciphertext = bytes(verifier.ciphertext_hex);
  if (hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer(ciphertext)))) !== verifier.ciphertext_sha256) {
    throw new Error("The recovery verifier failed its ciphertext integrity check.");
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(bytes(verifier.nonce_hex)), additionalData: buffer(additionalData), tagLength: 128 }, projectKey, buffer(ciphertext));
  } catch {
    throw new Error("The recovery key could not authenticate this book's key verifier. Check the book, key version and recovery key.");
  }
  try {
    if (new TextDecoder("utf-8", { fatal: true }).decode(plaintext) !== PROJECT_KEY_VERIFIER_PLAINTEXT) {
      throw new Error("The authenticated recovery verifier does not contain its fixed identity.");
    }
  } finally { new Uint8Array(plaintext).fill(0); }
}
