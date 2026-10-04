// Companion operations can finish while the author is viewing another book.
// Keep their outcome scoped to the reviewed book/account/device, without ever
// writing recovery keys to browser storage.
type OperationSnapshot = { busy: boolean; error: string; notice: string; recoveryKey: string; needsPublish: boolean; requiresRefresh: boolean };
export class DeviceReviewOperation {
  private state: OperationSnapshot = { busy: false, error: "", notice: "", recoveryKey: "", needsPublish: false, requiresRefresh: false };
  private listeners = new Set<() => void>();
  private recoveryKeyEpoch = 0;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: Partial<OperationSnapshot>) { this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); }
  async run(action: () => Promise<Partial<Omit<OperationSnapshot, "busy" | "error">>>) {
    if (this.state.busy) return;
    const recoveryKeyEpoch = this.recoveryKeyEpoch;
    this.update({ busy: true, error: "", notice: "" });
    try {
      const result = { ...await action() };
      // Sign-out/account changes can happen while an already-open sign-in form
      // completes. A late reply may retain its scoped nonsecret outcome, but
      // must never restore recovery material explicitly forgotten meanwhile.
      if (recoveryKeyEpoch !== this.recoveryKeyEpoch) delete result.recoveryKey;
      this.update(result);
    }
    catch (reason) { this.update({ error: reason instanceof Error ? reason.message : String(reason), requiresRefresh: true }); }
    finally { this.update({ busy: false }); }
  }
  published = () => { this.update({ needsPublish: false }); };
  refreshed = () => { if (!this.state.busy && this.state.requiresRefresh) this.update({ requiresRefresh: false, error: "", notice: "Device list and current book key refreshed. Review the current state before making another change." }); };
  forgetRecoveryKey = () => { this.recoveryKeyEpoch++; this.update({ recoveryKey: "" }); };
}
const operations = new Map<string, DeviceReviewOperation>();
export function deviceReviewOperation(scope: string) {
  let operation = operations.get(scope);
  if (!operation) { operation = new DeviceReviewOperation(); operations.set(scope, operation); }
  return operation;
}
export function forgetCompanionRecoveryKeys() { operations.forEach(operation => operation.forgetRecoveryKey()); }
