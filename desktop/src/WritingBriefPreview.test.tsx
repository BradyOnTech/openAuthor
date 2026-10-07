// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { RevisionContextPreview } from "./api";
import { WritingBriefPreview } from "./components/editor/WritingBriefPreview";

afterEach(cleanup);

function preview(voice: RevisionContextPreview["context"]["writing_voice"]): RevisionContextPreview {
  // The core returns {} when no usable voice profile exists, including when
  // a previously approved profile has stale sources. This is not a profile.
  return {
    fingerprint: "brief-preview", provider: "local", model: "heuristic-v1",
    system_prompt: "", user_prompt: "", estimated_input_tokens: 100, max_output_tokens: 700,
    memory_choices: [], story_choices: [], limits: { omitted_memory_ids: [] },
    context: {
      scene: { id: "scene-1", title: "The Repair Entry" }, codex_entities: [], writing_voice: voice,
      story_plan: { limits: { clipped_fields: [], omitted_chapters: 0, omitted_relevant_beats: 0 } },
      writing_brief: {
        schema_version: 1, scene_id: "scene-1", pov: "Tobin", story_time: "Before entry", scene_summary: "",
        direction: { ending: "The door stays shut." }, change_permission: "preserve",
        source_status: { voice_excerpts: voice?.observations?.length ?? 0, memory_entries: 0, approved_canon: 0 },
        warnings: [],
      },
    },
  };
}

it("keeps the review usable when the core excludes a missing or stale voice profile", () => {
  render(<WritingBriefPreview preview={preview({})} />);
  expect(screen.getByRole("region", { name: "Assembled writing brief" })).toBeTruthy();
  expect(screen.getByText("The door stays shut.")).toBeTruthy();
  expect(screen.getByText(/No current approved Writing Voice is included/)).toBeTruthy();
  expect(screen.getByText("Writing Voice · 0 approved excerpts")).toBeTruthy();
});

it("shows the approved prose evidence when a usable voice profile is supplied", () => {
  render(<WritingBriefPreview preview={preview({ name: "Approved voice", description: "Concrete viewpoint", guidance: ["Keep the viewpoint close."], avoid: [],
    observations: [{ scene_id: "scene-2", aspect: "Viewpoint", observation: "Concrete attention", excerpt: "He felt the worn key catch." }] })} />);
  expect(screen.getByText("Writing Voice · 1 approved excerpts")).toBeTruthy();
  expect(screen.getByText("He felt the worn key catch.")).toBeTruthy();
  expect(screen.queryByText(/No current approved Writing Voice is included/)).toBeNull();
});
