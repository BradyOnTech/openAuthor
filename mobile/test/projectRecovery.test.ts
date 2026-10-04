import { describe, expect, it, vi } from "vitest";
import { verifyAndImportRecoveryKey } from "../src/core/projectRecovery";

const recoveryKey = "OA1-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.EFAAEC69";
describe("verified book recovery", () => {
  it("persists a key only after authenticating the selected book and version", async () => {
    const events: string[] = [];
    const persist = vi.fn(async () => { events.push("persist"); });
    await verifyAndImportRecoveryKey({
      projectId: "book", keyVersion: 3, recoveryKey,
      verify: async (key) => {
        expect(key).toBe("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
        events.push("verify");
        return { projectId: "book", keyVersion: 3 };
      }, persist,
    });
    expect(events).toEqual(["verify", "persist"]);
  });

  it.each(["wrong-key", "missing", "other-book", "other-version"])("preserves existing keys on %s", async (failure) => {
    const persist = vi.fn();
    await expect(verifyAndImportRecoveryKey({
      projectId: "book", keyVersion: 3, recoveryKey,
      verify: async () => {
        if (failure === "wrong-key") throw new Error("Manifest authentication failed");
        if (failure === "missing") return null;
        return { projectId: failure === "other-book" ? "different" : "book", keyVersion: failure === "other-version" ? 4 : 3 };
      }, persist,
    })).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects invalid versions and checksums before any hosted request", async () => {
    const verify = vi.fn();
    const persist = vi.fn();
    await expect(verifyAndImportRecoveryKey({ projectId: "book", keyVersion: 0, recoveryKey, verify, persist })).rejects.toThrow("positive key version");
    await expect(verifyAndImportRecoveryKey({ projectId: "book", keyVersion: 1, recoveryKey: recoveryKey.slice(0, -1) + "0", verify, persist })).rejects.toThrow("checksum");
    expect(verify).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
