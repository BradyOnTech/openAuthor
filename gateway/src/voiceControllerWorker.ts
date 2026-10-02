import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { CallJournal } from "./callJournal.ts";
import { VoiceControlProblem, sameVoiceScope } from "./sharedVoiceControl.ts";
import type { ControllerVoiceControl, VoiceControlRecord } from "./sharedVoiceControl.ts";
import type { RealtimeUpstream } from "./types.ts";

/** A private durable cache lets this host end observed calls during DB outage. */
export class ControllerJournal {
  readonly calls: CallJournal;
  readonly #statePath: string;
  readonly #binding: string;
  readonly #closing = new Set<string>();
  readonly #accepted = new Set<string>();
  constructor(path: string, binding: string) {
    if (!/^[0-9a-f]{64}$/.test(binding)) throw new VoiceControlProblem();
    this.calls = new CallJournal(path);
    this.#statePath = `${path}.control`; this.#binding = binding;
    try {
      const metadata = `${path}.binding`;
      if (existsSync(metadata)) {
        const stat = lstatSync(metadata);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || readFileSync(metadata, "utf8") !== binding) throw new VoiceControlProblem();
      } else {
        if (this.calls.entries().length) throw new VoiceControlProblem();
        const file = openSync(metadata, "wx", 0o600);
        try { writeFileSync(file, binding); fsyncSync(file); } finally { closeSync(file); }
        const directory = openSync(dirname(path), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
      }
      if (existsSync(this.#statePath)) {
        const stat = lstatSync(this.#statePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new VoiceControlProblem();
        const state = JSON.parse(readFileSync(this.#statePath, "utf8"));
        const ids = new Set(this.calls.entries().map(([id]) => id));
        if (state.binding !== binding || !Array.isArray(state.closing) || !Array.isArray(state.accepted)
          || new Set(state.closing).size !== state.closing.length || new Set(state.accepted).size !== state.accepted.length
          || !state.closing.every((id: unknown) => typeof id === "string" && ids.has(id))
          || !state.accepted.every((id: unknown) => state.closing.includes(id))) throw new VoiceControlProblem();
        state.closing.forEach((id: string) => this.#closing.add(id)); state.accepted.forEach((id: string) => this.#accepted.add(id));
      } else this.#persist();
    } catch (error) { this.calls.close(); throw error; }
  }
  record(row: VoiceControlRecord): void {
    if (!row.call_id) throw new VoiceControlProblem();
    const previous = this.calls.entries().find(([id]) => id === row.lease_id);
    if (previous) { if (previous[1] !== row.call_id) throw new VoiceControlProblem(); }
    else this.calls.record(row.lease_id, row.call_id);
  }
  markClosing(id: string) {
    if (!this.calls.entries().some(([lease]) => lease === id)) throw new VoiceControlProblem();
    this.#closing.add(id); this.#persist();
  }
  accepted(id: string): boolean { return this.#accepted.has(id); }
  accept(id: string) { if (!this.#closing.has(id)) throw new VoiceControlProblem(); this.#accepted.add(id); this.#persist(); }
  retire(id: string) {
    this.#closing.delete(id); this.#accepted.delete(id); this.#persist(); this.calls.retire(id);
  }
  #persist() {
    const temporary = `${this.#statePath}.${randomUUID()}`; const file = openSync(temporary, "wx", 0o600);
    try { writeFileSync(file, JSON.stringify({ binding: this.#binding, closing: [...this.#closing], accepted: [...this.#accepted] })); fsyncSync(file); }
    finally { closeSync(file); }
    try { renameSync(temporary, this.#statePath); const directory = openSync(dirname(this.#statePath), "r"); try { fsyncSync(directory); } finally { closeSync(directory); } }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  close() { this.calls.close(); }
}

async function concurrent<T>(values: T[], work: (value: T) => Promise<void>): Promise<void> {
  let index = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(8, values.length) }, async () => {
    while (index < values.length) { const value = values[index++]!; await work(value); }
  }));
  if (results.some(result => result.status === "rejected")) throw new VoiceControlProblem();
}

export class VoiceControllerWorker {
  readonly #store: ControllerVoiceControl;
  readonly #upstream: RealtimeUpstream;
  readonly #journal: ControllerJournal;
  readonly #known = new Map<string, VoiceControlRecord>();
  readonly #uncertain = new Set<string>();
  readonly #timeoutMs: number;
  #running = false;
  #ready = false;
  constructor(options: { store: ControllerVoiceControl; upstream: RealtimeUpstream; journal: ControllerJournal; operationTimeoutMs?: number }) {
    this.#store = options.store; this.#upstream = options.upstream; this.#journal = options.journal;
    this.#timeoutMs = options.operationTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 60000) throw new VoiceControlProblem();
  }
  async #bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new VoiceControlProblem()), this.#timeoutMs); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  async #end(row: VoiceControlRecord): Promise<void> {
    this.#journal.record(row);
    if (row.phase === "closed") { this.#retire(row.lease_id); return; }
    if (row.phase !== "closing") throw new VoiceControlProblem();
    this.#journal.markClosing(row.lease_id);
    if (!this.#journal.accepted(row.lease_id)) {
      await this.#bounded(this.#upstream.hangupCall(row.call_id!));
      this.#journal.accept(row.lease_id);
    }
    const closed = await this.#bounded(this.#store.complete(row));
    if (closed.phase !== "closed" || !sameVoiceScope(row, closed)) throw new VoiceControlProblem();
    this.#retire(row.lease_id);
  }
  #retire(id: string) { this.#journal.retire(id); this.#known.delete(id); this.#uncertain.delete(id); }
  async #failClosed(): Promise<void> {
    await concurrent(this.#journal.calls.entries(), async ([id, callId]) => {
      this.#uncertain.add(id);
      this.#journal.markClosing(id);
      try {
        const row = await this.#bounded(this.#store.claim(id, true));
        if (row.call_id !== callId) throw new VoiceControlProblem(true);
        await this.#end(row); return;
      } catch (error) {
        // A live foreign generation may still own this call. Do not bypass
        // an explicit authoritative refusal; retry after its bounded claim.
        if (error instanceof VoiceControlProblem && error.refused) throw error;
      }
      // With DB unavailable, the private acknowledged journal still supplies
      // exact bound call identity. Keep it until SQL can persist closing/ack.
      if (!this.#journal.accepted(id)) {
        await this.#bounded(this.#upstream.hangupCall(callId));
        this.#journal.accept(id);
      }
    }).catch(() => undefined);
  }
  async runOnce(): Promise<void> {
    if (this.#running) throw new VoiceControlProblem(); this.#running = true;
    try {
      if (!this.#ready) {
        await concurrent(this.#journal.calls.entries(), async ([id, callId]) => {
          const row = await this.#bounded(this.#store.claim(id, true));
          if (row.call_id !== callId) throw new VoiceControlProblem();
          await this.#end(row);
        });
        this.#ready = true;
      }
      // Recover outage teardowns before renewing the controller heartbeat.
      await concurrent([...this.#uncertain], async id => {
        const row = await this.#bounded(this.#store.claim(id, true));
        const known = this.#journal.calls.entries().find(([lease]) => lease === id);
        if (!known || row.call_id !== known[1]) throw new VoiceControlProblem();
        await this.#end(row);
      });
      await concurrent([...this.#known.values()].filter(row => Date.parse(row.lease_expires_at) <= Date.now()), async previous => {
        const row = await this.#bounded(this.#store.claim(previous.lease_id, false));
        if (!sameVoiceScope(previous, row)) throw new VoiceControlProblem();
        if (row.phase === "closing" || row.phase === "closed") await this.#end(row);
        else this.#known.set(row.lease_id, row);
      });
      const rows = await this.#bounded(this.#store.poll());
      await concurrent(rows, async initial => {
        if (!initial.call_id) return;
        this.#journal.record(initial);
        this.#known.set(initial.lease_id, initial);
        const row = initial.phase === "registering" ? await this.#bounded(this.#store.observed(initial)) : initial;
        if (!sameVoiceScope(initial, row)) throw new VoiceControlProblem();
        this.#known.set(row.lease_id, row);
        if (row.phase === "closing") await this.#end(row);
      });
    } catch {
      await this.#failClosed();
      throw new VoiceControlProblem();
    } finally { this.#running = false; }
  }
  close() { this.#journal.close(); }
}
