import { describe, expect, it } from "vitest";
import {
  buildDictationProposalDraft,
  normalizeDictationTranscript
} from "./voiceDictation";

describe("voiceDictation", () => {
  it("normalizes transcript whitespace", () => {
    expect(normalizeDictationTranscript("  keep   this\n\nline tight  ")).toBe(
      "keep this line tight"
    );
  });

  it("builds deterministic dictation proposal drafts", () => {
    const draft = buildDictationProposalDraft(
      "scene-0003",
      " tighten pacing while preserving voice ",
      new Date("2026-02-12T09:00:00.000Z")
    );
    expect(draft.sceneId).toBe("scene-0003");
    expect(draft.title).toContain("scene-0003");
    expect(draft.title).toContain("2026-02-12T0900");
    expect(draft.instruction).toContain("Voice Dictation Transcript:");
    expect(draft.instruction).toContain("tighten pacing while preserving voice");
  });
});
