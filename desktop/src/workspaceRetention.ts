/** Local working copies, not manuscript writes. Each editor owns its own slot. */
export type RetainedRecord<T> = { schema: 1; owner: string; sequence: number; at: string; value: T };
export const retentionKey = (project: string, scope: string, resource: string) =>
  `openauthor.retained.v1:${encodeURIComponent(project)}:${encodeURIComponent(scope)}:${encodeURIComponent(resource)}`;

export class DraftJournal<T> {
  constructor(private key: string, private valid: (value: unknown) => value is T, private storage: () => Storage = () => window.localStorage) {}

  read(): RetainedRecord<T>[] {
    const storage = this.storage();
    const rows: RetainedRecord<T>[] = [];
    let damaged = false;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(`${this.key}:draft:`)) continue;
      try {
        const row = JSON.parse(storage.getItem(key) || "null");
        if (row?.schema !== 1 || typeof row.owner !== "string" || !Number.isSafeInteger(row.sequence) || row.sequence < 1
          || typeof row.at !== "string" || key !== `${this.key}:draft:${row.owner}` || !this.valid(row.value)) throw new Error("Invalid draft");
        if (storage.getItem(`${this.key}:retired:${row.owner}:${row.sequence}`) !== "1") rows.push(row);
      } catch { damaged = true; }
    }
    if (damaged && !rows.length) throw new Error("A local draft is damaged. Its stored copy was preserved; saved book content is unchanged.");
    return rows.sort((a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence);
  }

  write(value: T, previous?: RetainedRecord<T>): RetainedRecord<T> {
    if (!this.valid(value)) throw new Error("Invalid local working copy.");
    const row: RetainedRecord<T> = { schema: 1, owner: previous?.owner || crypto.randomUUID(), sequence: (previous?.sequence || 0) + 1, at: new Date().toISOString(), value };
    this.storage().setItem(`${this.key}:draft:${row.owner}`, JSON.stringify(row));
    return row;
  }

  retire(row: RetainedRecord<T>) {
    // Acknowledging an older save can never retire a newer sequence.
    const storage = this.storage();
    storage.setItem(`${this.key}:retired:${row.owner}:${row.sequence}`, "1");
  }
}

export function readPosition<T>(key: string, valid: (value: unknown) => value is T): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!valid(value)) throw new Error("The saved reading position is invalid; starting at the chapter beginning.");
  return value;
}

export function savePosition(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}
