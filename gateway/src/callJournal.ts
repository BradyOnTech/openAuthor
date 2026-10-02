import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

import { validCallId } from "./openAIRealtimeUpstream.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Content-free, exclusively owned call records. Bearer tokens never go to disk. */
export class CallJournal {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #owner = { pid: process.pid, host: hostname(), id: randomUUID() };
  readonly #calls = new Map<string, string>();
  #closed = false;

  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error("Call journal requires an absolute persistent path.");
    this.#path = path;
    this.#lockPath = `${path}.lock`;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const parent = lstatSync(dirname(path));
    if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || parent.uid !== process.getuid?.()) throw new Error("Call journal directory must be private and owned by the gateway.");
    const claimPath = `${this.#lockPath}.claim`;
    const claim = openSync(claimPath, "wx", 0o600);
    try {
      if (existsSync(this.#lockPath)) {
        const stat = lstatSync(this.#lockPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error("Call journal ownership requires operator review.");
        let prior: { pid: number; host: string; id: string };
        try { prior = JSON.parse(readFileSync(this.#lockPath, "utf8")); } catch { throw new Error("Call journal ownership requires operator review."); }
        if (prior.host !== hostname() || !Number.isSafeInteger(prior.pid) || prior.pid < 1) throw new Error("Call journal ownership requires operator review.");
        try { process.kill(prior.pid, 0); throw new Error("Call journal already has an active owner."); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("Call journal already has an active or unknown owner.");
        }
        unlinkSync(this.#lockPath);
      }
      const lock = openSync(this.#lockPath, "wx", 0o600);
      try { writeFileSync(lock, JSON.stringify(this.#owner)); fsyncSync(lock); } finally { closeSync(lock); }
      this.#syncDirectory();
    } finally { closeSync(claim); unlinkSync(claimPath); this.#syncDirectory(); }
    try {
      if (existsSync(path)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error();
        const saved = JSON.parse(readFileSync(path, "utf8"));
        if (saved.schema !== 1 || !Array.isArray(saved.calls) || saved.calls.length > 1000) throw new Error();
        for (const entry of saved.calls) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !uuidPattern.test(entry[0]) || !validCallId(entry[1]) || this.#calls.has(entry[0]) || [...this.#calls.values()].includes(entry[1])) throw new Error();
          this.#calls.set(entry[0], entry[1]);
        }
      } else this.#persist();
    } catch {
      this.close();
      throw new Error("Call journal is invalid; startup cleanup requires operator review.");
    }
  }

  entries(): Array<[string, string]> { return [...this.#calls.entries()]; }

  record(leaseId: string, callId: string): void {
    if (!uuidPattern.test(leaseId) || !validCallId(callId) || this.#closed || this.#calls.has(leaseId) || this.#calls.size >= 1000 || [...this.#calls.values()].includes(callId)) throw new Error("Call cannot be durably registered.");
    this.#calls.set(leaseId, callId);
    try { this.#persist(); } catch (error) { this.#calls.delete(leaseId); throw error; }
  }

  retire(leaseId: string): void {
    const previous = this.#calls.get(leaseId);
    this.#calls.delete(leaseId);
    try { this.#persist(); } catch (error) { if (previous) this.#calls.set(leaseId, previous); throw error; }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const saved = JSON.parse(readFileSync(this.#lockPath, "utf8"));
    if (saved.id !== this.#owner.id) throw new Error("Call journal owner changed.");
    unlinkSync(this.#lockPath);
    this.#syncDirectory();
  }

  #syncDirectory(): void {
    const descriptor = openSync(dirname(this.#path), "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }

  #persist(): void {
    if (this.#closed) throw new Error("Call journal is closed.");
    const temporary = join(dirname(this.#path), `.calls-${randomUUID()}.json`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify({ schema: 1, calls: this.entries() }));
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    try { renameSync(temporary, this.#path); this.#syncDirectory(); } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
}
