// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorialFindings } from "./EditorialFindings";
import type { EditorialReview } from "../../types";

const state = vi.hoisted(() => ({ opened: [] as unknown[], errors: [] as string[] }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: "/synthetic/editorial", scenes: [{ id: "scene-2", title: "Departure" }], setError: (value: string) => state.errors.push(value) }) }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => ({ tabs: [], openTab: (value: unknown) => state.opened.push(value), beginNavigation: () => () => true }) }));
vi.mock("../../sceneSaveSession", () => ({ flushProjectSceneSaves: async () => true }));
vi.mock("../../api", () => ({ getScene: async () => ({ id: "scene-2", title: "Departure", body: "Mara read the note." }) }));
afterEach(() => { cleanup(); state.opened = []; state.errors = []; });
const review: EditorialReview = {
  schema_version: 1, focus: "character-knowledge", scope: "chapter", kind: "editorial",
  summary: "Check the source of Mara's knowledge.", strengths: ["Keep the unresolved departure."], limitations: ["Exact quotes do not verify an interpretation."], warnings: [],
  sources: [{ scene_id: "scene-2", title: "Departure", start: 0, end: 19 }],
  findings: [{ id: "finding-1", category: "character-knowledge", title: "The sealed note", observation: "Mara later speaks about its contents.", uncertainty: "She might have heard it from someone else.", suggestion: "Check the intended knowledge boundary without inventing a source.", evidence: [{ scene_id: "scene-2", start: 0, end: 19, excerpt: "Mara read the note." }] }],
};

describe("focused editorial findings", () => {
  it("keeps uncertainty, minimal suggestion and evidence visible and opens the cited passage", async () => {
    render(<EditorialFindings review={review} feedback="Original response" stale={false} />);
    expect(screen.getByText("She might have heard it from someone else.")).toBeTruthy();
    expect(screen.getByText("Check the intended knowledge boundary without inventing a source.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apply|accept/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open evidence 1 in Departure" }));
    await waitFor(() => expect(state.opened).toHaveLength(1));
    expect(state.opened[0]).toMatchObject({ id: "scene:scene-2", focusPassage: { start: 0, end: 19, excerpt: "Mara read the note." } });
  });
  it("reports changed sources and withheld or empty findings without implying a successful story review", () => {
    render(<EditorialFindings review={{ ...review, findings: [], warnings: ["Finding 1 was withheld because its source was not supplied."] }} feedback="Unverified response" stale />);
    expect(screen.getByText(/A reviewed source or Storyline changed/)).toBeTruthy();
    expect(screen.getByText(/does not establish that the passage has no editorial problems/)).toBeTruthy();
    expect(screen.getByText(/Finding 1 was withheld/)).toBeTruthy();
  });
});
