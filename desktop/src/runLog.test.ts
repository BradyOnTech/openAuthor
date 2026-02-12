import { describe, expect, it } from "vitest";
import { formatRunLogJson, generationRunLogFilename } from "./runLog";
import type { GenerationRunDetail } from "./types";

describe("formatRunLogJson", () => {
  it("formats run detail as stable pretty JSON ending with newline", () => {
    const run: GenerationRunDetail = {
      run_id: "gen-abc123",
      status: "succeeded",
      created_at: "2026-02-12T10:00:00Z",
      scene_id: "scene-0001",
      provider: "local",
      model: "heuristic-v1",
      instruction: "tighten pacing",
      prompt_sha256: "deadbeef",
      system_prompt: "system",
      user_prompt: "user",
      context: {},
      log_path: ".openauthor/generations/gen-abc123.json"
    };

    const payload = formatRunLogJson(run);
    expect(payload.endsWith("\n")).toBe(true);
    expect(payload).toContain('"run_id": "gen-abc123"');
    expect(payload).toContain('"status": "succeeded"');
  });
});

describe("generationRunLogFilename", () => {
  it("builds filename from run id", () => {
    expect(generationRunLogFilename("gen-abc123")).toBe("gen-abc123.json");
  });
});
