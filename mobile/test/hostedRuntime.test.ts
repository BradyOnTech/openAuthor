import { describe, expect, it } from "vitest";

import {
  clearHostedEncryptedData,
  revokeAndDeleteHostedLocalData,
} from "../src/core/hostedLifecycle";

describe("hosted mobile lifecycle cleanup", () => {
  it("attempts every destructive cleanup step and reports only after cleanup", async () => {
    const calls: string[] = [];

    await expect(revokeAndDeleteHostedLocalData({
      revokeDevice: async () => {
        calls.push("revoke");
        throw new Error("remote detail");
      },
      deleteCache: async () => { calls.push("cache"); },
      deleteOutbox: async () => {
        calls.push("outbox");
        throw new Error("sqlite detail");
      },
      signOut: async () => { calls.push("signout"); },
    })).rejects.toThrow("Device cleanup could not be completed safely.");

    expect(calls).toEqual(["revoke", "cache", "outbox", "signout"]);
  });

  it("clears device keys, cached snapshots, and ciphertext outbox before account reuse", async () => {
    const calls: string[] = [];
    await clearHostedEncryptedData({
      clearDevice: async () => { calls.push("device"); },
      deleteCache: async () => { calls.push("cache"); },
      deleteOutbox: async () => { calls.push("outbox"); },
    });
    expect(calls).toEqual(["device", "cache", "outbox"]);
  });
});
