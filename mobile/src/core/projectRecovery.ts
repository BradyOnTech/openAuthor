import { decodeRecoveryKey } from "./recoveryKey";
import type { EnrolledDevice } from "./deviceEnrollment";
import type { LocalIdentity } from "./localCompanion";

export type VerifiedProjectKeyWrite = {
  projectId: string;
  keyVersion: number;
  projectKey: string;
  expectedKey: string | null;
  identity: LocalIdentity;
  device: EnrolledDevice;
  /** Synchronous fence only; storage never holds a transaction over a network call. */
  current(): void;
};

export function prepareVerifiedProjectKeyWrite(
  input: VerifiedProjectKeyWrite,
  accessEncoded: string | null,
  device: EnrolledDevice | null,
  existingKey: string | null,
): { slot: string; device: EnrolledDevice } {
  input.current();
  let access: Record<string, unknown>;
  try { access = JSON.parse(accessEncoded ?? "null") as Record<string, unknown>; }
  catch { throw new Error("Local access changed during book key recovery. Sign in again."); }
  if (!access || access.version !== 1 || access.state !== "active"
    || ["userId", "deviceId", "keyId", "deployment"].some(field => access[field] !== input.identity[field as keyof LocalIdentity])
    || !device || ["userId", "deviceId", "keyId", "publicKey", "platform"].some(field =>
      device[field as keyof EnrolledDevice] !== input.device[field as keyof EnrolledDevice])
    || device.userId !== input.identity.userId || device.deviceId !== input.identity.deviceId || device.keyId !== input.identity.keyId) {
    throw new Error("Local access changed during book key recovery. Sign in again.");
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.projectId)
    || !Number.isSafeInteger(input.keyVersion) || input.keyVersion < 1 || input.keyVersion > 2147483647
    || !/^[A-Za-z0-9+/]{43}=$/.test(input.projectKey)) throw new Error("Recovered project key is invalid.");
  if (existingKey !== input.expectedKey && existingKey !== input.projectKey) {
    throw new Error("The saved book key changed during recovery. Review the current book key before trying again.");
  }
  const slot = `openauthor.project.${input.projectId}.key.${input.keyVersion}`;
  return { slot, device: { ...device, projectKeySlots: [...new Set([...device.projectKeySlots, slot])] } };
}

/** A printable checksum catches typos, not wrong-book keys. Authenticate the
 * candidate against an immutable hosted verifier or an authenticated legacy
 * manifest before replacing local keys. */
export async function verifyAndImportRecoveryKey(input: {
  projectId: string;
  keyVersion: number;
  recoveryKey: string;
  verify(projectKey: string): Promise<{ projectId: string; keyVersion: number } | null>;
  persist(projectKey: string): Promise<void>;
}): Promise<void> {
  if (!input.projectId || !Number.isSafeInteger(input.keyVersion) || input.keyVersion < 1 || input.keyVersion > 2147483647) {
    throw new Error("Enter the book's positive key version from desktop.");
  }
  const key = await decodeRecoveryKey(input.recoveryKey);
  const verified = await input.verify(key);
  if (!verified) throw new Error("This book has no key verifier or encrypted snapshot. Publish a snapshot with its existing key, or rotate the key on desktop before recovering it here.");
  if (verified.projectId !== input.projectId || verified.keyVersion !== input.keyVersion) {
    throw new Error("The recovery key version does not match this book's authenticated key proof.");
  }
  await input.persist(key);
}
