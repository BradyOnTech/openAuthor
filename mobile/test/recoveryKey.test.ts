import { describe, expect, it } from "vitest";

import { decodeRecoveryKey, encodeRecoveryKey } from "../src/core/recoveryKey";

describe("project recovery keys", () => {
  it("round-trips a project key and detects transcription mistakes", async () => {
    const encoded = await encodeRecoveryKey("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
    expect(encoded).toMatch(/^OA1-/);
    await expect(decodeRecoveryKey(encoded)).resolves.toBe(
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    );
    await expect(decodeRecoveryKey(`${encoded.slice(0, -1)}X`)).rejects.toThrow("checksum");
  });
});
