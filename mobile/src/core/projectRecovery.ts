import { decodeRecoveryKey } from "./recoveryKey";

/** A printable checksum catches typos, not wrong-book keys. Authenticate the
 * candidate against the hosted encrypted manifest before replacing local keys. */
export async function verifyAndImportRecoveryKey(input: {
  projectId: string;
  keyVersion: number;
  recoveryKey: string;
  verify(projectKey: string): Promise<{ projectId: string; keyVersion: number } | null>;
  persist(projectKey: string): Promise<void>;
}): Promise<void> {
  if (!input.projectId || !Number.isSafeInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error("Enter the book's positive key version from desktop.");
  }
  const key = await decodeRecoveryKey(input.recoveryKey);
  const verified = await input.verify(key);
  if (!verified) throw new Error("Publish an encrypted snapshot from desktop before unlocking this book.");
  if (verified.projectId !== input.projectId || verified.keyVersion !== input.keyVersion) {
    throw new Error("The recovery key version does not match this book's published snapshot.");
  }
  await input.persist(key);
}
