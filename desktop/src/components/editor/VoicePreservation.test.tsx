// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScene, getWritingVoiceWorkspace, writingVoiceAction, type StyleProfile, type VoicePreservation, type VoicePreview, type WritingVoiceWorkspace } from "../../api";
import { WritingVoiceEditor } from "./WritingVoiceEditor";
import { preservationError, validPreservationDraft } from "./VoicePreservation";
import { VoiceRefinement } from "./VoiceRefinement";
import type { SceneDetail } from "../../types";

const editor = vi.hoisted(() => ({ openTab: vi.fn(), updateTab: vi.fn() }));
const state = vi.hoisted(() => ({ project: "/books/preservation", storyline: "primary" }));
const ui = vi.hoisted(() => ({ sidebarOpen: true, secondarySidebarOpen: true, panelOpen: false, setSidebarOpen: vi.fn(), setSecondarySidebarOpen: vi.fn(), setPanelOpen: vi.fn() }));
vi.mock("../../contexts/UIContext", () => ({ useUI: () => ui }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: state.project, branches: [{ name: state.storyline, current: true }],
  scenes: [{ id: "scene-1", title: "The quay" }, { id: "scene-2", title: "The letter" }], runtimeConfig: null, refreshProposals: vi.fn(), setMessage: vi.fn() }) }));
vi.mock("../../api", () => ({ getScene: vi.fn(), getWritingVoiceWorkspace: vi.fn(), writingVoiceAction: vi.fn() }));

const profile: StyleProfile = { schema_version: 2, name: "Original voice", description: "Restrained.", traits: {}, guidance: [], avoid: [], exemplar_scene_ids: [], metrics: {}, created_at: "", version: "profile-version-1" };
const preservation: VoicePreservation[] = [{ kind: "fact", text: "  The letter remains unopened.  " }, { kind: "protected_text", text: "No answer came." }];
const preview: VoicePreview = { id: "preview-1", scene_id: "scene-1", source_text: "Lina held the letter. No answer came.", instruction: "Keep the restrained perspective.", provider: "local",
  preservation, preservation_schema_version: 1, preservation_fingerprint: "a".repeat(64),
  directions: [{ id: "direction-1", profile, text: "Lina kept the letter. No answer came.", warnings: [], measures: { words: 8, average_sentence_words: 4, dialogue_passages: 0 },
    observations: [{ criterion: "consistency", observation: "The unanswered ending is retained.", source_excerpt: "No answer came.", excerpt: "No answer came." }], author_review: { ratings: {}, notes: "" } }] };
const workspace = (scope = state.storyline): WritingVoiceWorkspace => ({ profile, scope, dimensions: {}, criteria: {}, previews: [],
  presets: [{ ...profile, id: "kinetic", name: "Kinetic", description: "Urgent." }, { ...profile, id: "atmospheric", name: "Atmospheric", description: "Atmospheric." }] });
function delayed<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
async function ready() {
  await waitFor(() => expect((screen.getByRole("textbox", { name: /Exact excerpt/ }) as HTMLTextAreaElement).value).toBe(preview.source_text));
  await waitFor(() => expect((screen.getByRole("button", { name: "Compare 3 short previews" }) as HTMLButtonElement).disabled).toBe(false));
}
function addInstruction(text: string, kind: VoicePreservation["kind"] = "fact") {
  const index = screen.queryAllByRole("textbox", { name: /Preservation instruction/ }).length + 1;
  fireEvent.click(screen.getByRole("button", { name: "Add preservation instruction" }));
  fireEvent.change(screen.getByRole("combobox", { name: `Preservation kind ${index}` }), { target: { value: kind } });
  fireEvent.change(screen.getByRole("textbox", { name: `Preservation instruction ${index}` }), { target: { value: text } });
}

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); state.project = "/books/preservation"; state.storyline = "primary";
  vi.mocked(getWritingVoiceWorkspace).mockImplementation(async () => workspace());
  vi.mocked(getScene).mockResolvedValue({ id: "scene-1", body: preview.source_text } as SceneDetail);
});
afterEach(cleanup);

describe("author preservation instructions", () => {
  it("passes exact optional author instructions only when the author requests a preview", async () => {
    render(<WritingVoiceEditor />); await ready();
    expect(screen.queryByRole("textbox", { name: /Preservation instruction/ })).toBeNull();
    addInstruction(preservation[0].text);
    addInstruction(preservation[1].text, "protected_text");
    expect(writingVoiceAction).not.toHaveBeenCalled();
    vi.mocked(writingVoiceAction).mockResolvedValue(preview);
    fireEvent.click(screen.getByRole("button", { name: "Compare 3 short previews" }));
    await screen.findByRole("region", { name: "Saved preservation instructions" });
    expect(writingVoiceAction).toHaveBeenCalledWith(state.project, "preview", expect.objectContaining({ preservation }));
    expect(screen.getByRole("region", { name: "Saved preservation instructions" }).textContent).toContain(preservation[0].text);
  });

  it("blocks blank or absent protected wording without contacting a provider", async () => {
    render(<WritingVoiceEditor />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add preservation instruction" }));
    expect((screen.getByRole("button", { name: "Compare 3 short previews" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Preservation kind 1" }), { target: { value: "protected_text" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Preservation instruction 1" }), { target: { value: "A sentence absent from this excerpt." } });
    expect((screen.getByRole("button", { name: "Compare 3 short previews" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("must appear unchanged");
    expect(writingVoiceAction).not.toHaveBeenCalled();
  });

  it("retains instructions by scene and Storyline without copying them into another book", async () => {
    const view = render(<WritingVoiceEditor />); await ready(); addInstruction("Keep the first scene unresolved.");
    fireEvent.change(screen.getByRole("combobox", { name: "Preview scene" }), { target: { value: "scene-2" } });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /Preservation instruction/ })).toBeNull());
    addInstruction("The second scene's author instruction.");
    fireEvent.change(screen.getByRole("combobox", { name: "Preview scene" }), { target: { value: "scene-1" } });
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Preservation instruction 1" }) as HTMLTextAreaElement).value).toBe("Keep the first scene unresolved."));
    state.storyline = "alternate"; view.rerender(<WritingVoiceEditor />); await ready();
    expect(screen.queryByRole("textbox", { name: /Preservation instruction/ })).toBeNull();
    state.storyline = "primary"; view.rerender(<WritingVoiceEditor />); await ready();
    expect((screen.getByRole("textbox", { name: "Preservation instruction 1" }) as HTMLTextAreaElement).value).toBe("Keep the first scene unresolved.");
    state.project = "/books/another"; view.rerender(<WritingVoiceEditor />); await ready();
    expect(screen.queryByRole("textbox", { name: /Preservation instruction/ })).toBeNull();
    view.unmount(); state.project = "/books/preservation"; render(<WritingVoiceEditor />); await ready();
    expect((screen.getByRole("textbox", { name: "Preservation instruction 1" }) as HTMLTextAreaElement).value).toBe("Keep the first scene unresolved.");
  });

  it("uses the saved comparison fingerprint for stage and refinement and labels both quotations", async () => {
    vi.mocked(getWritingVoiceWorkspace).mockResolvedValue({ ...workspace(), previews: [preview] });
    render(<WritingVoiceEditor />); await ready();
    addInstruction("A different next-preview instruction.");
    const card = screen.getByRole("article", { name: "Preview Original voice" });
    fireEvent.click(within(card).getByText("Generator self-review — not independent evidence"));
    expect(within(card).getByText("Original quotation")).toBeTruthy();
    expect(within(card).getByText("Candidate quotation")).toBeTruthy();
    expect(within(card).getAllByText("No answer came.")).toHaveLength(2);
    vi.mocked(writingVoiceAction).mockResolvedValue({ id: "proposal-1", title: "Chosen sample" });
    fireEvent.click(within(card).getByRole("button", { name: "Queue sample as Change Set" }));
    await waitFor(() => expect(editor.openTab).toHaveBeenCalled());
    expect(writingVoiceAction).toHaveBeenLastCalledWith(state.project, "stage", { preview_id: preview.id, direction_id: "direction-1", expected_preservation_fingerprint: preview.preservation_fingerprint });
    fireEvent.click(within(card).getByText("Refine this sample"));
    fireEvent.change(within(card).getByRole("textbox", { name: "Revision feedback" }), { target: { value: "Retain the unanswered ending." } });
    vi.mocked(writingVoiceAction).mockResolvedValue({ ...preview, id: "refined-1" });
    fireEvent.click(within(card).getByRole("button", { name: "Generate refined sample" }));
    await screen.findByText(/Refined sample saved separately/);
    expect(writingVoiceAction).toHaveBeenLastCalledWith(state.project, "refine", expect.objectContaining({ expected_preservation_fingerprint: preview.preservation_fingerprint, feedback: "Retain the unanswered ending." }));
  });

  it("rejects unsupported kinds and enforces individual and aggregate limits without altering exact text", () => {
    expect(validPreservationDraft([{ kind: "unrecognized", text: "A fact." }])).toBe(false);
    expect(validPreservationDraft([{ kind: ["fact"], text: "A fact." }])).toBe(false);
    expect(validPreservationDraft([{ kind: "fact", text: "A fact.", unreviewed: "Extra data" }])).toBe(false);
    expect(validPreservationDraft(Array.from({ length: 13 }, () => ({ kind: "fact", text: "A fact." })))).toBe(false);
    expect(preservationError([{ kind: "fact", text: "x".repeat(401) }], "")).toContain("at most 12");
    expect(preservationError(Array.from({ length: 8 }, () => ({ kind: "fact", text: "x".repeat(400) })), "")).toContain("3,000");
    expect(preservationError([{ kind: "fact", text: "🪶".repeat(400) }], "")).toBe("");
    expect(preservationError(preservation, preview.source_text)).toBe("");
    expect(preservation[0].text).toBe("  The letter remains unopened.  ");
  });
});

describe("late Writing Voice completion", () => {
  it("ignores an old preview when a different Storyline becomes active", async () => {
    const response = delayed<VoicePreview>(); vi.mocked(writingVoiceAction).mockReturnValue(response.promise);
    const view = render(<WritingVoiceEditor />); await ready(); addInstruction("Original branch instruction.");
    fireEvent.click(screen.getByRole("button", { name: "Compare 3 short previews" }));
    state.storyline = "alternate"; view.rerender(<WritingVoiceEditor />); await ready();
    await act(async () => response.resolve(preview));
    expect(screen.queryByRole("region", { name: "Saved preservation instructions" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Preview Original voice" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Preservation instruction/ })).toBeNull();
  });

  it("ignores an older profile load after the book changes", async () => {
    const response = delayed<WritingVoiceWorkspace>(); vi.mocked(getWritingVoiceWorkspace).mockReturnValueOnce(response.promise);
    const view = render(<WritingVoiceEditor />);
    state.project = "/books/another"; view.rerender(<WritingVoiceEditor />); await ready();
    await act(async () => response.resolve({ ...workspace("old-scope"), profile: { ...profile, name: "Late old profile" }, previews: [preview] }));
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe(profile.name);
    expect(screen.queryByRole("article", { name: "Preview Original voice" })).toBeNull();
  });

  it("keeps a dirty profile's original version and scope through a Storyline change", async () => {
    const view = render(<WritingVoiceEditor />); await ready();
    fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "My unsaved voice" } });
    state.storyline = "alternate"; view.rerender(<WritingVoiceEditor />); await ready();
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("My unsaved voice");
    vi.mocked(writingVoiceAction).mockRejectedValue(new Error("Original Storyline changed."));
    fireEvent.click(screen.getByRole("button", { name: "Approve and save Writing Voice" }));
    await screen.findByText(/Original Storyline changed/);
    expect(writingVoiceAction).toHaveBeenCalledWith(state.project, "save", expect.objectContaining({ scope: "primary", expected_version: "profile-version-1", profile: expect.objectContaining({ name: "My unsaved voice" }) }));
  });

  it("keeps unsaved profiles in their books when local draft storage is unavailable", async () => {
    const unavailable = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    try {
      const view = render(<WritingVoiceEditor />); await ready();
      fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "First book's draft" } });
      fireEvent.change(screen.getByRole("textbox", { name: "Tell the copilot how this book should read" }), { target: { value: "First book's brief" } });
      state.project = "/books/another"; view.rerender(<WritingVoiceEditor />); await ready();
      expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe(profile.name);
      expect((screen.getByRole("textbox", { name: "Tell the copilot how this book should read" }) as HTMLTextAreaElement).value).toBe("");
      state.project = "/books/preservation"; state.storyline = "alternate"; view.rerender(<WritingVoiceEditor />); await ready();
      expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("First book's draft");
      expect((screen.getByRole("textbox", { name: "Tell the copilot how this book should read" }) as HTMLTextAreaElement).value).toBe("First book's brief");
      vi.mocked(writingVoiceAction).mockRejectedValue(new Error("Original Storyline changed."));
      fireEvent.click(screen.getByRole("button", { name: "Approve and save Writing Voice" }));
      await screen.findByText(/Original Storyline changed/);
      expect(writingVoiceAction).toHaveBeenCalledWith(state.project, "save", expect.objectContaining({ scope: "primary", expected_version: "profile-version-1" }));
    } finally { unavailable.mockRestore(); }
  });

  it("does not journal an old book's dirty profile under the new book", async () => {
    const view = render(<WritingVoiceEditor />); await ready();
    fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "Only the first book" } });
    state.project = "/books/another"; view.rerender(<WritingVoiceEditor />); await ready();
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe(profile.name);
    expect(localStorage.getItem("openauthor:writing-voice-draft:v2:/books/another")).toBeNull();
  });

  it("ignores a late profile save after another book's draft is being edited", async () => {
    const response = delayed<StyleProfile>(); vi.mocked(writingVoiceAction).mockReturnValue(response.promise);
    const view = render(<WritingVoiceEditor />); await ready();
    fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "Saved old book" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve and save Writing Voice" }));
    state.project = "/books/another"; view.rerender(<WritingVoiceEditor />); await ready();
    fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "New book's unsaved profile" } });
    await act(async () => response.resolve({ ...profile, name: "Saved old book", version: "saved-version" }));
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("New book's unsaved profile");
    expect(JSON.parse(localStorage.getItem("openauthor:writing-voice-draft:v2:/books/another")!).draft.name).toBe("New book's unsaved profile");
    expect(screen.queryByText(/Writing Voice approved/)).toBeNull();
  });

  it("does not open an old staged proposal in a newly active book", async () => {
    vi.mocked(getWritingVoiceWorkspace).mockImplementation(async () => ({ ...workspace(), previews: state.project === "/books/preservation" ? [preview] : [] }));
    const response = delayed<unknown>(); vi.mocked(writingVoiceAction).mockReturnValue(response.promise);
    const view = render(<WritingVoiceEditor />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Queue sample as Change Set" }));
    state.project = "/books/another"; view.rerender(<WritingVoiceEditor />); await ready();
    await act(async () => response.resolve({ id: "old-proposal", title: "Old book sample" }));
    expect(editor.openTab).not.toHaveBeenCalled();
  });

  it("leaves a remounted editor's newer feedback intact and ignores the old completion", async () => {
    const response = delayed<VoicePreview>(); vi.mocked(writingVoiceAction).mockReturnValue(response.promise);
    const onRefined = vi.fn(); const onBusy = vi.fn();
    const props = { project: "/books/preservation", scope: "primary", previewId: preview.id, preservationFingerprint: preview.preservation_fingerprint, direction: preview.directions[0], provider: "local", model: "", disabled: false, onRefined, onBusy };
    const first = render(<VoiceRefinement {...props} />); fireEvent.click(screen.getByText("Refine this sample"));
    fireEvent.change(screen.getByRole("textbox", { name: "Revision feedback" }), { target: { value: "Submitted old feedback." } });
    fireEvent.click(screen.getByRole("button", { name: "Generate refined sample" })); first.unmount();
    render(<VoiceRefinement {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Revision feedback" }), { target: { value: "New feedback after reopening." } });
    await act(async () => response.resolve({ ...preview, id: "finished-old-request" }));
    expect((screen.getByRole("textbox", { name: "Revision feedback" }) as HTMLTextAreaElement).value).toBe("New feedback after reopening.");
    expect(onRefined).not.toHaveBeenCalled();
    expect(onBusy.mock.calls).toEqual([[true]]);
  });

  it("retains feedback edited after submission in the same mounted editor", async () => {
    const response = delayed<VoicePreview>(); vi.mocked(writingVoiceAction).mockReturnValue(response.promise);
    const onRefined = vi.fn();
    render(<VoiceRefinement project={state.project} scope="primary" previewId={preview.id} preservationFingerprint={preview.preservation_fingerprint} direction={preview.directions[0]} provider="local" model="" disabled={false} onBusy={vi.fn()} onRefined={onRefined} />);
    fireEvent.click(screen.getByText("Refine this sample"));
    fireEvent.change(screen.getByRole("textbox", { name: "Revision feedback" }), { target: { value: "Submitted feedback." } });
    fireEvent.click(screen.getByRole("button", { name: "Generate refined sample" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Revision feedback" }), { target: { value: "Later feedback." } });
    await act(async () => response.resolve({ ...preview, id: "finished-current-request" }));
    expect((screen.getByRole("textbox", { name: "Revision feedback" }) as HTMLTextAreaElement).value).toBe("Later feedback.");
    expect(onRefined).toHaveBeenCalledWith(expect.objectContaining({ id: "finished-current-request" }));
  });
});
