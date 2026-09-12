import { describe, expect, it, vi } from "vitest";
import { LocalCompanion, decodeDownloadedBook, type DownloadedBook, type DownloadedBookStore } from "../src/core/localCompanion";
import type { EnrolledDevice, SecretStore } from "../src/core/deviceEnrollment";
import { isMobileAuthStorageKey, mobileAuthStorageKey } from "../src/core/authStorageKey";

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async create(key: string, candidate: string) {
    if (!this.values.has(key)) this.values.set(key, candidate);
    return this.values.get(key)!;
  }
}

class MemoryBooks implements DownloadedBookStore {
  readonly values = new Map<string, DownloadedBook>();
  async get(id: string) { return this.values.has(id) ? structuredClone(this.values.get(id)!) : null; }
  async list() { return structuredClone([...this.values.values()]); }
  async put(book: DownloadedBook) { this.values.set(book.projectId, structuredClone(book)); }
  async clear() { this.values.clear(); }
}

function fixture() {
  const secrets = new MemorySecrets();
  const books = new MemoryBooks();
  const device: EnrolledDevice = { deviceId: "phone", keyId: "key", userId: "author", name: "Phone", platform: "web", publicKey: "public", enrolledAt: "2026-09-07T12:00:00Z", projectKeySlots: [] };
  const localDevice = vi.fn(async (userId?: string) => {
    if (userId && device.userId !== userId) throw new Error("Different account");
    return structuredClone(device);
  });
  const create = (deployment = "https://backend.example.test") => new LocalCompanion({ deployment, secrets, books, localDevice });
  const session = { userId: device.userId, email: "author@example.test" };
  const book = { projectId: "book-1", title: "The Winter Observatory", downloadedAt: "2026-09-07T12:00:00Z", revision: "rev-1", keyVersion: 1 };
  return { secrets, books, device, localDevice, create, session, book };
}

describe("downloaded companion access", () => {
  it("requires verified enrollment before remembering or opening local books", async () => {
    const f = fixture();
    await expect(f.create().require()).rejects.toThrow("Sign in online");
    await expect(f.create().remember(f.book)).rejects.toThrow("Sign in online");
    expect(f.books.values.size).toBe(0);
    await f.create().authorize(f.session, f.device);
    await expect(f.create().requireBook(f.book.projectId)).rejects.toThrow("not been downloaded");
  });

  it("reopens an enrolled device's downloaded library without any token or online dependency", async () => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    await f.create().remember(f.book);
    expect(await f.create().require()).toMatchObject({ ...f.session, deviceId: "phone", keyId: "key" });
    expect(await f.create().requireBook("book-1")).toMatchObject(f.book);
    expect(await f.create().books()).toHaveLength(1);
    expect(JSON.stringify([...f.secrets.values.values()])).not.toMatch(/access_token|refresh_token/);
  });

  it("persists sign-out and prevents late automatic restores from unlocking local data", async () => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    await f.create().remember(f.book);
    const before = await f.books.list();
    await f.create().lock();
    expect(await f.create().isLocked()).toBe(true);
    await expect(f.create().authorize(f.session, f.device)).rejects.toThrow("Signing out locks");
    await expect(f.create().requireBook("book-1")).rejects.toThrow("Signing out locks");
    expect(await f.books.list()).toEqual(before);
    await f.create().authorize(f.session, f.device, true);
    expect(await f.create().isLocked()).toBe(false);
    expect(await f.create().requireBook("book-1")).toMatchObject(f.book);
  });

  it("keeps the user's downloaded-library choice across cold restarts without unlocking a signed-out device", async () => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    expect(await f.create().prefersDownloaded()).toBe(false);
    await f.create().preferDownloaded(true);
    expect(await f.create().prefersDownloaded()).toBe(true);
    await f.create().lock();
    await expect(f.create().require()).rejects.toThrow("Signing out locks");
    await expect(f.create().preferDownloaded(false)).rejects.toThrow("Signing out locks");
    await f.create().authorize(f.session, f.device, true);
    await f.create().preferDownloaded(false);
    expect(await f.create().prefersDownloaded()).toBe(false);
  });

  it("does not let a first automatic restore overwrite a sign-out racing its storage creation", async () => {
    const f = fixture();
    const original = f.secrets.create.bind(f.secrets);
    vi.spyOn(f.secrets, "create").mockImplementation(async (key, candidate) => {
      await f.create().lock();
      return original(key, candidate);
    });
    await expect(f.create().authorize(f.session, f.device)).rejects.toThrow("Signing out locks");
    expect(await f.create().isLocked()).toBe(true);
  });

  it.each(["userId", "deviceId", "keyId"] as const)("rejects a changed local %s", async (field) => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    await f.create().remember(f.book);
    f.device[field] = "different";
    await expect(f.create().requireBook("book-1")).rejects.toThrow();
  });

  it("rejects a missing device private key without creating a replacement identity", async () => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    f.localDevice.mockRejectedValue(new Error("Device key is unavailable"));
    await expect(f.create().require()).rejects.toThrow("key is unavailable");
    expect(f.device.deviceId).toBe("phone");
  });

  it("does not reuse another deployment's local access", async () => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    await f.create().remember(f.book);
    const other = f.create("https://other.example.test");
    expect(await other.isLocked()).toBe(true);
    await expect(other.requireBook("book-1")).rejects.toThrow("Sign in online");
  });

  it("filters foreign library records even when project identifiers are reused", async () => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    await f.create().remember(f.book);
    f.books.values.get("book-1")!.deviceId = "different-phone";
    expect(await f.create().books()).toEqual([]);
    await expect(f.create().requireBook("book-1")).rejects.toThrow("not been downloaded");
  });

  it("does not hide persistence failures or expose corrupt access-record contents", async () => {
    const f = fixture();
    await f.create().authorize(f.session, f.device);
    vi.spyOn(f.books, "put").mockRejectedValue(new Error("Disk full"));
    await expect(f.create().remember(f.book)).rejects.toThrow("Disk full");
    const key = [...f.secrets.values.keys()][0]!;
    f.secrets.values.set(key, "not JSON: private-material");
    await expect(f.create().require()).rejects.toThrow("Saved local access is invalid");
    await expect(f.create().isLocked()).rejects.not.toThrow("private-material");
  });

  it("validates encrypted library metadata with content-free errors", () => {
    expect(() => decodeDownloadedBook("private non-json text")).toThrow("library record could not be read");
    expect(() => decodeDownloadedBook(JSON.stringify({ title: "Private book", keyVersion: 0 }))).toThrow("library record could not be read");
  });
});

describe("local sign-out auth storage scope", () => {
  it("keeps the legacy namespace and limits cleanup to that deployment's auth keys", () => {
    const base = mobileAuthStorageKey({ supabaseUrl: "https://my-project.supabase.co" });
    expect(base).toBe("sb-my-project-auth-token");
    expect([base, `${base}-user`, `${base}-code-verifier`].every((key) => isMobileAuthStorageKey(key, base))).toBe(true);
    expect(isMobileAuthStorageKey(`${base}other`, base)).toBe(false);
    expect(isMobileAuthStorageKey("downloaded-book:book", base)).toBe(false);
  });
});
