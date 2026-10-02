import { describe, expect, it, vi } from "vitest";
import { DeviceReviewOperation, deviceReviewOperation, forgetCompanionRecoveryKeys } from "./deviceReviewOperation";

describe("companion device operation retention", () => {
  it("fences a late recovery key after account reset while retaining the scoped completed outcome", async () => {
    const operation = deviceReviewOperation("synthetic-account-reset");
    let complete!: (result: { recoveryKey: string; needsPublish: boolean; notice: string }) => void;
    const pending = operation.run(() => new Promise<{ recoveryKey: string; needsPublish: boolean; notice: string }>(resolve => { complete = resolve; }));
    expect(operation.getSnapshot().busy).toBe(true);
    forgetCompanionRecoveryKeys();
    complete({ recoveryKey: "late-secret-must-stay-forgotten", needsPublish: true, notice: "Book key created; republish required." });
    await pending;
    expect(operation.getSnapshot()).toMatchObject({ busy: false, recoveryKey: "", needsPublish: true, notice: "Book key created; republish required." });
    await operation.run(async () => ({ recoveryKey: "new-explicitly-created-key" }));
    expect(operation.getSnapshot().recoveryKey).toBe("new-explicitly-created-key");
    operation.forgetRecoveryKey();
  });

  it("blocks duplicate submission and retains failure until an explicit successful refresh", async () => {
    const operation = new DeviceReviewOperation();
    let reject!: (reason: Error) => void;
    const pending = operation.run(() => new Promise((_resolve, fail) => { reject = fail; }));
    const duplicate = vi.fn(async () => ({ notice: "duplicate" }));
    await operation.run(duplicate);
    expect(duplicate).not.toHaveBeenCalled();
    reject(new Error("Response lost")); await pending;
    expect(operation.getSnapshot()).toMatchObject({ error: "Response lost", requiresRefresh: true, busy: false });
    operation.refreshed();
    expect(operation.getSnapshot()).toMatchObject({ error: "", requiresRefresh: false });
  });
});
