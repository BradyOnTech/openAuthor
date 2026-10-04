import type { EnrolledDevice, SecretStore } from "./deviceEnrollment";

export type LocalIdentity = { userId: string; email: string; deviceId: string; keyId: string; deployment: string };
export type DownloadedBook = LocalIdentity & {
  projectId: string;
  title: string;
  downloadedAt: string;
  revision: string;
  keyVersion: number;
};

export interface DownloadedBookStore {
  get(projectId: string): Promise<DownloadedBook | null>;
  list(): Promise<DownloadedBook[]>;
  put(book: DownloadedBook): Promise<void>;
  clear(): Promise<void>;
}

const ACCESS_SLOT = "openauthor.mobile.local-access.v1";
const MODE_SLOT = "openauthor.mobile.library-mode.v1";
type AccessRecord = { version: 1; state: "locked" } | (LocalIdentity & { version: 1; state: "active" });

function validIdentity(value: LocalIdentity): boolean {
  return [value.userId, value.deviceId, value.keyId].every((id) => typeof id === "string" && /^[a-z0-9-]{1,128}$/i.test(id))
    && typeof value.email === "string" && value.email.length <= 320
    && typeof value.deployment === "string" && value.deployment.length > 0 && value.deployment.length <= 512;
}

export function validateLocalAuthorization(encoded: string, device: EnrolledDevice | null): void {
  let access: AccessRecord;
  try { access = JSON.parse(encoded) as AccessRecord; }
  catch { throw new Error("Local authorization is invalid."); }
  if (!access || access.version !== 1 || access.state !== "active" || !validIdentity(access) || !device
    || device.userId !== access.userId || device.deviceId !== access.deviceId || device.keyId !== access.keyId) {
    throw new Error("The saved device changed during local authorization. Sign in again.");
  }
}

export function decodeDownloadedBook(encoded: string): DownloadedBook {
  try {
    const value = JSON.parse(encoded) as DownloadedBook;
    if (!value || !validIdentity(value) || typeof value.projectId !== "string" || !/^[a-z0-9-]{1,128}$/i.test(value.projectId)
      || typeof value.title !== "string" || !value.title || value.title.length > 240
      || typeof value.downloadedAt !== "string" || !Number.isFinite(Date.parse(value.downloadedAt))
      || typeof value.revision !== "string" || !value.revision || value.revision.length > 160
      || !Number.isSafeInteger(value.keyVersion) || value.keyVersion < 1) throw new Error();
    return value;
  } catch { throw new Error("The downloaded library record could not be read. Reconnect to download the book again."); }
}

function decodeAccess(encoded: string | null): AccessRecord | null {
  if (encoded === null) return null;
  try {
    const value = JSON.parse(encoded) as AccessRecord;
    if (!value || value.version !== 1 || (value.state !== "locked" && (value.state !== "active" || !validIdentity(value)))) throw new Error();
    return value;
  } catch { throw new Error("Saved local access is invalid. Sign in again; no downloaded work was deleted."); }
}

/** Local data access only. This record is never an authorization token for hosting or voice. */
export class LocalCompanion {
  constructor(private readonly input: {
    deployment: string;
    secrets: SecretStore;
    books: DownloadedBookStore;
    localDevice(userId?: string): Promise<EnrolledDevice>;
  }) {}

  async isLocked(): Promise<boolean> {
    const record = decodeAccess(await this.input.secrets.get(ACCESS_SLOT));
    return record?.state === "locked" || (record?.state === "active" && record.deployment !== this.input.deployment);
  }

  async authorize(session: { userId: string; email: string }, device: EnrolledDevice, explicitSignIn = false, current?: () => void): Promise<void> {
    const candidate: AccessRecord = {
      version: 1, state: "active", ...session,
      deviceId: device.deviceId, keyId: device.keyId, deployment: this.input.deployment,
    };
    if (!validIdentity(candidate) || device.userId !== session.userId) throw new Error("Verified device identity does not match this account.");
    // Only a deliberate sign-in may unlock a signed-out device. A late session
    // restore uses create, so it cannot overwrite a concurrent sign-out lock.
    if (explicitSignIn && current) {
      if (!this.input.secrets.setLocalAccessIfCurrent) throw new Error("Guarded local authorization is unavailable. Sign in again.");
      await this.input.secrets.setLocalAccessIfCurrent(JSON.stringify(candidate), current);
    } else if (explicitSignIn) await this.input.secrets.set(ACCESS_SLOT, JSON.stringify(candidate));
    else await this.input.secrets.create(ACCESS_SLOT, JSON.stringify(candidate));
    const identity = await this.require();
    if (identity.userId !== session.userId || identity.deviceId !== device.deviceId || identity.keyId !== device.keyId) {
      throw new Error("Saved local access belongs to another identity. Sign in again.");
    }
  }

  async require(): Promise<LocalIdentity> {
    const record = decodeAccess(await this.input.secrets.get(ACCESS_SLOT));
    if (!record || record.state !== "active" || record.deployment !== this.input.deployment) {
      throw new Error("Sign in online and download a book before using downloaded books. Signing out locks local access.");
    }
    const device = await this.input.localDevice(record.userId);
    if (device.deviceId !== record.deviceId || device.keyId !== record.keyId) throw new Error("The saved device identity has changed. Sign in again.");
    return { userId: record.userId, email: record.email, deviceId: record.deviceId, keyId: record.keyId, deployment: record.deployment };
  }

  async lock(): Promise<void> {
    // Retain ciphertext and project keys. A persistent lock works without a
    // network response and also blocks stale SDK sessions after a cold restart.
    await this.input.secrets.set(ACCESS_SLOT, JSON.stringify({ version: 1, state: "locked" } satisfies AccessRecord));
  }

  async prefersDownloaded(): Promise<boolean> {
    return await this.input.secrets.get(MODE_SLOT) === "downloaded";
  }

  async preferDownloaded(value: boolean): Promise<void> {
    await this.require();
    await this.input.secrets.set(MODE_SLOT, value ? "downloaded" : "online");
  }

  async remember(book: Omit<DownloadedBook, keyof LocalIdentity>): Promise<void> {
    const identity = await this.require();
    await this.input.books.put(decodeDownloadedBook(JSON.stringify({ ...book, ...identity })));
  }

  async books(): Promise<DownloadedBook[]> {
    const identity = await this.require();
    return (await this.input.books.list()).filter((book) => book.userId === identity.userId
      && book.deviceId === identity.deviceId && book.keyId === identity.keyId && book.deployment === identity.deployment);
  }

  async requireBook(projectId: string): Promise<DownloadedBook> {
    const identity = await this.require();
    const book = await this.input.books.get(projectId);
    if (!book || book.projectId !== projectId || book.userId !== identity.userId || book.deviceId !== identity.deviceId
      || book.keyId !== identity.keyId || book.deployment !== identity.deployment) {
      throw new Error("This book has not been downloaded for this device. Connect to the online library first.");
    }
    return book;
  }
}
