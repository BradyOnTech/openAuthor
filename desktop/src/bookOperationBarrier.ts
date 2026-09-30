// Book metadata writes can outlive their React editor. Keep version changes
// outside those writes even when the author has navigated to another panel.
const pendingWrites = new Map<string, Set<Promise<unknown>>>();
const changingBooks = new Set<string>();

export const isProjectBookChanging = (projectRoot: string) => changingBooks.has(projectRoot);

export async function withBookMetadataWrite<T>(projectRoot: string, write: () => Promise<T>): Promise<T> {
  if (changingBooks.has(projectRoot)) throw new Error("The book version is changing. Wait for it to finish, then review your draft before saving.");
  const pending = Promise.resolve().then(write);
  let writes = pendingWrites.get(projectRoot);
  if (!writes) { writes = new Set(); pendingWrites.set(projectRoot, writes); }
  writes.add(pending);
  try { return await pending; }
  finally {
    writes.delete(pending);
    if (!writes.size) pendingWrites.delete(projectRoot);
  }
}

export async function withBookVersionBarrier<T>(projectRoot: string, change: () => Promise<T>): Promise<T> {
  if (changingBooks.has(projectRoot)) throw new Error("Another book change is in progress.");
  changingBooks.add(projectRoot);
  try {
    await Promise.all([...(pendingWrites.get(projectRoot) ?? [])]);
    return await change();
  } finally { changingBooks.delete(projectRoot); }
}
