import { decodeDownloadedBook, type DownloadedBook, type DownloadedBookStore } from "../core/localCompanion";
import { browserStorage, type BrowserStorage } from "./browserStorage";

const PREFIX = "downloaded-book:";

export class EncryptedDownloadedBookStore implements DownloadedBookStore {
  constructor(private readonly storage: BrowserStorage = browserStorage) {}
  async get(projectId: string): Promise<DownloadedBook | null> {
    const encoded = await this.storage.get(`${PREFIX}${projectId}`);
    if (encoded === null) return null;
    const book = decodeDownloadedBook(encoded);
    if (book.projectId !== projectId) throw new Error("Downloaded book identity mismatch.");
    return book;
  }
  async list(): Promise<DownloadedBook[]> {
    const books: DownloadedBook[] = [];
    for (const key of await this.storage.keys(PREFIX)) {
      const book = await this.get(key.slice(PREFIX.length));
      if (book) books.push(book);
    }
    return books.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  }
  async put(book: DownloadedBook): Promise<void> {
    decodeDownloadedBook(JSON.stringify(book));
    await this.storage.set(`${PREFIX}${book.projectId}`, JSON.stringify(book));
  }
  clear(): Promise<void> { return this.storage.deletePrefix(PREFIX); }
}
