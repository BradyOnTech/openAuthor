import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BrowserStorage } from "../src/adapters/browserStorage";
import { EncryptedDownloadedBookStore } from "../src/adapters/downloadedBookStore.web";
import type { DownloadedBook } from "../src/core/localCompanion";

const BOOK: DownloadedBook = { projectId: "book", title: "Private novel title", userId: "author", email: "author@example.test", deviceId: "phone", keyId: "key", deployment: "https://backend.example.test", downloadedAt: "2026-09-07T12:00:00Z", revision: "rev-1", keyVersion: 1 };

describe("encrypted downloaded library", () => {
  it("persists encrypted book metadata across browser instances and simultaneous book downloads", async () => {
    const name = `library-${crypto.randomUUID()}`;
    const storage = new BrowserStorage(name);
    const first = new EncryptedDownloadedBookStore(storage);
    const second = new EncryptedDownloadedBookStore(new BrowserStorage(name));
    await Promise.all([first.put(BOOK), second.put({ ...BOOK, projectId: "other-book", title: "Second novel" })]);
    const reopened = new EncryptedDownloadedBookStore(new BrowserStorage(name));
    expect(await reopened.get("book")).toEqual(BOOK);
    expect(await reopened.list()).toHaveLength(2);
    const raw = await storage.transaction<unknown>("records", "readonly", (store, done) => {
      const read = store.getAll(); read.onsuccess = () => done(read.result);
    });
    expect(JSON.stringify(raw)).not.toContain(BOOK.title);
    expect(JSON.stringify(raw)).not.toContain(BOOK.email);
  });

  it("rejects a record copied under another book identifier", async () => {
    const storage = new BrowserStorage(`library-${crypto.randomUUID()}`);
    const books = new EncryptedDownloadedBookStore(storage);
    await books.put(BOOK);
    await storage.transaction<void>("records", "readwrite", (store) => {
      const read = store.get("downloaded-book:book");
      read.onsuccess = () => { store.put(read.result, "downloaded-book:other"); };
    });
    await expect(books.get("other")).rejects.toThrow();
    expect(await books.get("book")).toEqual(BOOK);
  });

  it("removes only the downloaded-book index during cleanup", async () => {
    const storage = new BrowserStorage(`library-${crypto.randomUUID()}`);
    const books = new EncryptedDownloadedBookStore(storage);
    await books.put(BOOK);
    await storage.set("auth:session", "auth-session");
    await books.clear();
    expect(await books.list()).toEqual([]);
    expect(await books.get("book")).toBeNull();
    expect(await storage.get("auth:session")).toBe("auth-session");
  });
});
