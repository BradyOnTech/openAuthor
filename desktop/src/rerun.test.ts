import { describe, expect, it } from "vitest";
import {
  EMPTY_RERUN_DRAFT,
  buildRerunPayload,
  draftRerunFromRun
} from "./rerun";
import type { GenerationRunDetail } from "./types";

function makeRun(overrides: Partial<GenerationRunDetail> = {}): GenerationRunDetail {
  return {
    run_id: "gen-abc123",
    status: "succeeded",
    created_at: "2026-02-12T10:00:00Z",
    scene_id: "scene-0001",
    provider: "openai",
    model: "gpt-4.1-mini",
    instruction: "tighten pacing",
    prompt_sha256: "deadbeef",
    system_prompt: "system",
    user_prompt: "user",
    context: {},
    log_path: ".openauthor/generations/gen-abc123.json",
    ...overrides
  };
}

describe("draftRerunFromRun", () => {
  it("seeds draft with run settings", () => {
    const draft = draftRerunFromRun(
      makeRun({
        temperature: 0.3,
        max_output_tokens: 800,
        context_scene_radius: 2,
        codex_limit: 25
      })
    );
    expect(draft.provider).toBe("openai");
    expect(draft.model).toBe("gpt-4.1-mini");
    expect(draft.temperature).toBe("0.3");
    expect(draft.maxOutputTokens).toBe("800");
    expect(draft.contextScenes).toBe("2");
    expect(draft.codexLimit).toBe("25");
  });

  it("falls back to local provider for unknown run provider", () => {
    const draft = draftRerunFromRun(makeRun({ provider: "custom" }));
    expect(draft.provider).toBe("local");
  });
});

describe("buildRerunPayload", () => {
  it("trims text and parses numeric overrides", () => {
    const payload = buildRerunPayload("gen-abc123", {
      ...EMPTY_RERUN_DRAFT,
      title: "  Replay proposal  ",
      provider: "anthropic",
      model: " claude-3-5-haiku-latest ",
      temperature: "0.6",
      maxOutputTokens: "900",
      contextScenes: "3",
      codexLimit: "15"
    });
    expect(payload).toEqual({
      runId: "gen-abc123",
      title: "Replay proposal",
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      temperature: 0.6,
      maxOutputTokens: 900,
      contextScenes: 3,
      codexLimit: 15
    });
  });

  it("omits invalid numeric overrides", () => {
    const payload = buildRerunPayload("gen-abc123", {
      ...EMPTY_RERUN_DRAFT,
      provider: "local",
      temperature: "abc",
      maxOutputTokens: "",
      contextScenes: " ",
      codexLimit: "xyz"
    });
    expect(payload.temperature).toBeUndefined();
    expect(payload.maxOutputTokens).toBeUndefined();
    expect(payload.contextScenes).toBeUndefined();
    expect(payload.codexLimit).toBeUndefined();
  });
});
