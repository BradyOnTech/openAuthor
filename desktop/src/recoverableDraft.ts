import { useEffect, useMemo, useSyncExternalStore } from "react";

type RecordValue<T> = { base: T; value: T };
type Snapshot<T> = RecordValue<T> & { latest: T; recovered: boolean; error: string; conflict: boolean };
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
// Retain only unsaved recovery failures beyond an editor's lifetime. Successful
// drafts reload from storage; failed writes must not disappear on navigation.
const failedDrafts = new Map<string, RecoverableDraft<unknown>>();
const warnBeforeClose = (event: BeforeUnloadEvent) => {
  if (failedDrafts.size) { event.preventDefault(); event.returnValue = ""; }
};

export class RecoverableDraft<T> {
  private state: Snapshot<T>;
  private listeners = new Set<() => void>();

  constructor(private key: string, initial: T, private validate: (value: unknown) => value is T) {
    this.state = { base: initial, value: initial, latest: initial, recovered: false, error: "", conflict: false };
    try {
      const recovered = this.read();
      if (recovered) this.state = { ...this.state, ...recovered, recovered: true };
    } catch {
      this.state.error = "Recovery storage is unavailable or unreadable. Keep this editor open until you save.";
    }
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  get dirty() { return !equal(this.state.value, this.state.base); }

  private read(): RecordValue<T> | null {
    const raw = window.localStorage.getItem(this.key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== 1 || !this.validate(record.base) || !this.validate(record.value)) {
      throw new Error("Invalid recovery record");
    }
    return { base: record.base, value: record.value };
  }

  private publish(next: Partial<Snapshot<T>>, persist = false) {
    this.state = { ...this.state, ...next };
    if (persist) {
      try {
        if (this.dirty) window.localStorage.setItem(this.key, JSON.stringify({ version: 1, base: this.state.base, value: this.state.value }));
        else window.localStorage.removeItem(this.key);
        this.state.error = "";
      } catch {
        this.state.error = "Recovery storage is full or unavailable. Keep this editor open until you save.";
      }
    }
    this.listeners.forEach(listener => listener());
  }

  edit = (value: T) => { this.publish({ value }, true); };

  amend = (update: (latest: T) => T) => {
    // Completion callbacks can outlive their editor. Reconcile against the
    // newest journal; a removed journal means the draft was cleared elsewhere.
    let latest = this.state.value;
    try { latest = this.read()?.value ?? (this.state.error ? latest : this.state.base); } catch { /* Retain the in-memory draft when recovery is unavailable. */ }
    this.edit(update(latest));
  };

  acceptSaved = (latest: T) => {
    if (!this.dirty || equal(this.state.value, latest)) {
      this.publish({ base: latest, value: latest, latest, recovered: false, conflict: false }, !this.state.error);
    } else {
      this.publish({ latest, conflict: !equal(this.state.base, latest) });
    }
  };

  saved = (submitted: T, latest: T) => {
    // An editor can be closed/reopened while this save is in flight. Preserve
    // newer journaled edits instead of clearing another mounted editor's draft.
    let value = this.state.value;
    try {
      const journal = this.read();
      if (journal && equal(value, submitted) && !equal(journal.value, submitted)) value = journal.value;
    } catch { /* The in-memory draft remains authoritative when storage fails. */ }
    this.publish({ base: latest, latest, value: equal(value, submitted) ? latest : value, recovered: false, conflict: false }, true);
  };

  useSaved = () => { this.publish({ base: this.state.latest, value: this.state.latest, recovered: false, conflict: false }, true); };
  keepDraft = () => { this.publish({ base: this.state.latest, conflict: false }, true); };
}

export function useRecoverableDraft<T>(key: string, initial: T, validate: (value: unknown) => value is T) {
  const session = useMemo(() => (failedDrafts.get(key) as RecoverableDraft<T> | undefined) ?? new RecoverableDraft(key, initial, validate), [key]);
  useEffect(() => {
    const retainFailure = () => {
      if (session.dirty && session.getSnapshot().error) failedDrafts.set(key, session as RecoverableDraft<unknown>);
      else if (failedDrafts.get(key) === session) failedDrafts.delete(key);
      window.removeEventListener("beforeunload", warnBeforeClose);
      if (failedDrafts.size) window.addEventListener("beforeunload", warnBeforeClose);
    };
    retainFailure();
    return session.subscribe(retainFailure);
  }, [key, session]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { session, ...state, dirty: session.dirty };
}
