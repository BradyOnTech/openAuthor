import { describe, expect, it } from "vitest";
import {
  appendVoiceCommandLog,
  clearVoiceCommandLog,
  listVoiceCommandLog
} from "./voiceLog";

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    }
  };
}

describe("voiceLog", () => {
  it("appends and lists entries", () => {
    const storage = makeStorage();
    appendVoiceCommandLog(
      "/repo",
      {
        source: "manual",
        transcript: "open runs",
        normalized: "open runs",
        confidence: 0.95,
        status: "executed",
        intent: { kind: "open_tab", tab: "runs" },
        detail: "Opened runs tab."
      },
      storage
    );
    const rows = listVoiceCommandLog("/repo", 10, storage);
    expect(rows).toHaveLength(1);
    expect(rows[0].intentKind).toBe("open_tab");
    expect(rows[0].status).toBe("executed");
  });

  it("clears per-project logs", () => {
    const storage = makeStorage();
    appendVoiceCommandLog(
      "/repo",
      {
        source: "manual",
        transcript: "save scene",
        normalized: "save scene",
        confidence: 0.9,
        status: "executed",
        intent: { kind: "save_scene" },
        detail: "Saved scene."
      },
      storage
    );
    clearVoiceCommandLog("/repo", storage);
    expect(listVoiceCommandLog("/repo", 10, storage)).toEqual([]);
  });
});
