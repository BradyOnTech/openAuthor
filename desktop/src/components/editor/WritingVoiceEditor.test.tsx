// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScene, getWritingVoiceWorkspace, writingVoiceAction, type StyleProfile, type VoicePreview, type WritingVoiceWorkspace } from "../../api";
import { WritingVoiceEditor } from "./WritingVoiceEditor";
import type { SceneDetail } from "../../types";

const editor = vi.hoisted(() => ({ openTab: vi.fn(), updateTab: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
const ui = vi.hoisted(() => ({ sidebarOpen: true, secondarySidebarOpen: true, panelOpen: false, setSidebarOpen: vi.fn(), setSecondarySidebarOpen: vi.fn(), setPanelOpen: vi.fn() }));
vi.mock("../../contexts/UIContext", () => ({ useUI: () => ui }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: "/books/voice", scenes: [{ id: "scene-1", title: "The gate" }], runtimeConfig: null, refreshProposals: refresh, setMessage: vi.fn() }) }));
vi.mock("../../api", () => ({ getScene: vi.fn(), getWritingVoiceWorkspace: vi.fn(), writingVoiceAction: vi.fn() }));

const profile: StyleProfile = { schema_version: 2, name: "Coast voice", description: "Clear and restrained.", traits: { prose: "direct" }, guidance: ["Keep action clear."], avoid: ["Overexplaining"], metrics: {}, exemplar_scene_ids: [], created_at: "", version: "saved-1" };
const workspace: WritingVoiceWorkspace = {
  profile, scope: "book-scope", dimensions: { prose: { label: "Prose", options: ["direct", "balanced", "lyrical"] } },
  presets: [{ ...profile, id: "clear-epic", name: "Clear epic", description: "Clear action." }, { ...profile, id: "kinetic", name: "Kinetic", description: "Urgent emotion." }, { ...profile, id: "atmospheric", name: "Atmospheric", description: "Quiet atmosphere." }],
  criteria: { voice_fit: "Does this fit your voice?", consistency: "Are facts preserved?" }, previews: [],
};
const preview: VoicePreview = {
  id: "voice-preview-fixture", scene_id: "scene-1", source_text: "Mara counted boats.", provider: "transport-fixture",
  directions: ["Coast voice", "Kinetic", "Atmospheric"].map((name, index) => ({ id: `direction-${index + 1}`, profile: { ...profile, name }, text: `Mara counted the boats. Direction ${index + 1}.`, warnings: ["Provider interpretation needs author review."], observations: [], measures: { words: 8, average_sentence_words: 4, dialogue_passages: 0 }, author_review: { ratings: {}, notes: "" } })),
};

describe("Writing Voice author workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear();
    vi.mocked(getWritingVoiceWorkspace).mockResolvedValue(structuredClone(workspace));
    vi.mocked(getScene).mockResolvedValue({ id: "scene-1", body: "Mara counted boats." } as SceneDetail);
  });
  afterEach(cleanup);

  it("edits a preset but saves only after approval with the loaded version", async () => {
    vi.mocked(getWritingVoiceWorkspace).mockResolvedValue({ ...workspace, profile: { ...profile, exemplar_scene_ids: ["scene-1"], exemplar_digests: { "scene-1": "a".repeat(64) } } });
    render(<WritingVoiceEditor />);
    await screen.findByRole("textbox", { name: "Profile name" });
    fireEvent.change(screen.getByRole("combobox", { name: "Writing Voice preset" }), { target: { value: "kinetic" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "My original voice" } });
    expect(writingVoiceAction).not.toHaveBeenCalled();
    vi.mocked(writingVoiceAction).mockResolvedValue({ ...profile, name: "My original voice", version: "saved-2" });
    fireEvent.click(screen.getByRole("button", { name: "Approve and save Writing Voice" }));
    await screen.findByText(/Writing Voice approved/);
    expect(writingVoiceAction).toHaveBeenCalledWith("/books/voice", "save", expect.objectContaining({ expected_version: "saved-1", scope: "book-scope", profile: expect.objectContaining({ name: "My original voice" }) }));
    expect(vi.mocked(writingVoiceAction).mock.calls[0][2].profile).toEqual(expect.objectContaining({ exemplar_scene_ids: [], exemplar_digests: {} }));
    expect(editor.openTab).not.toHaveBeenCalled();
  });

  it("restores an unsaved draft after navigation and keeps it after a save conflict", async () => {
    const view = render(<WritingVoiceEditor />);
    await screen.findByRole("textbox", { name: "Profile name" });
    fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "Unsaved craft" } });
    view.unmount(); render(<WritingVoiceEditor />);
    await screen.findByText(/Restored your unsaved/);
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("Unsaved craft");
    vi.mocked(writingVoiceAction).mockRejectedValueOnce(new Error("Writing Voice changed elsewhere."));
    fireEvent.click(screen.getByRole("button", { name: "Approve and save Writing Voice" }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed elsewhere");
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("Unsaved craft");
  });

  it("automatically compares a chosen preset against other directions", async () => {
    vi.mocked(writingVoiceAction).mockResolvedValue(preview);
    render(<WritingVoiceEditor />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: /Exact excerpt/ }) as HTMLTextAreaElement).value).toBe("Mara counted boats."));
    fireEvent.change(screen.getByRole("combobox", { name: "Writing Voice preset" }), { target: { value: "kinetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare 3 short previews" }));
    await screen.findByRole("article", { name: "Preview Kinetic" });
    const request = vi.mocked(writingVoiceAction).mock.calls[0][2];
    expect((request.directions as StyleProfile[]).map((row) => row.name)).toEqual(["Kinetic", "Atmospheric", "Clear epic"]);
  });

  it("turns a conversational brief and exemplars into an unsaved editable suggestion", async () => {
    vi.mocked(writingVoiceAction).mockResolvedValue({ profile: { ...profile, name: "Suggested voice", observations: [{ scene_id: "scene-1", aspect: "Rhythm", observation: "A direct opening.", excerpt: "Mara counted boats." }] }, message: "Review this interpretation." });
    render(<WritingVoiceEditor initialBrief="Less exposition, closer perspective." />);
    await screen.findByRole("textbox", { name: "Profile name" });
    fireEvent.click(screen.getByText(/Choose your exemplar scenes/));
    fireEvent.click(screen.getByRole("checkbox", { name: "The gate" }));
    fireEvent.click(screen.getByRole("button", { name: "Propose a voice profile" }));
    await screen.findByText("A direct opening.");
    expect(writingVoiceAction).toHaveBeenCalledTimes(1);
    expect(writingVoiceAction).toHaveBeenCalledWith("/books/voice", "suggest", expect.objectContaining({ brief: "Less exposition, closer perspective.", scene_ids: ["scene-1"] }));
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("Suggested voice");
    expect(screen.getByText(/unsaved proposal/)).toBeTruthy();
  });

  it("ignores corrupt local recovery data without crashing or changing the approved profile", async () => {
    localStorage.setItem("openauthor:writing-voice-draft:v2:/books/voice", JSON.stringify({ draft: { ...profile, guidance: null }, version: "old", scope: "book-scope", brief: "", selected: [] }));
    render(<WritingVoiceEditor />);
    await screen.findByText(/local voice draft is invalid/);
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe(profile.name);
    expect(writingVoiceAction).not.toHaveBeenCalled();
  });

  it("retains a promoted chat brief even before analysis", async () => {
    const view = render(<WritingVoiceEditor initialBrief="Close perspective, dry humor." />);
    await screen.findByRole("textbox", { name: "Profile name" });
    view.unmount(); render(<WritingVoiceEditor />);
    await screen.findByText(/Restored your unsaved/);
    expect((screen.getByRole("textbox", { name: "Tell the copilot how this book should read" }) as HTMLTextAreaElement).value).toBe("Close perspective, dry humor.");
  });

  it("compares short samples, records human judgment and queues only the chosen direction", async () => {
    vi.mocked(writingVoiceAction).mockResolvedValue(structuredClone(preview));
    render(<WritingVoiceEditor />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: /Exact excerpt/ }) as HTMLTextAreaElement).value).toBe("Mara counted boats."));
    fireEvent.click(screen.getByRole("button", { name: "Compare 3 short previews" }));
    const card = await screen.findByRole("article", { name: "Preview Kinetic" });
    expect(screen.getAllByRole("article")).toHaveLength(3);
    fireEvent.click(within(card).getByText("Your quality assessment"));
    fireEvent.change(within(card).getByRole("combobox", { name: "Does this fit your voice?" }), { target: { value: "works" } });
    fireEvent.change(within(card).getByRole("textbox", { name: "Assessment notes" }), { target: { value: "Good rhythm; verify the character's knowledge." } });
    const saved = structuredClone(preview);
    saved.directions[1].author_review = { ratings: { voice_fit: "works" }, notes: "Good rhythm; verify the character's knowledge." };
    vi.mocked(writingVoiceAction).mockResolvedValue(saved);
    fireEvent.click(within(card).getByRole("button", { name: "Save assessment" }));
    await screen.findByText(/assessment was saved/);
    expect(writingVoiceAction).toHaveBeenCalledWith("/books/voice", "review", expect.objectContaining({ direction_id: "direction-2", review: { ratings: { voice_fit: "works" }, notes: "Good rhythm; verify the character's knowledge." } }));
    fireEvent.change(screen.getByRole("combobox", { name: "Reopen saved previews" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Reopen saved previews" }), { target: { value: preview.id } });
    const reopened = screen.getByRole("article", { name: "Preview Kinetic" });
    expect((within(reopened).getByRole("textbox", { name: "Assessment notes", hidden: true }) as HTMLTextAreaElement).value).toBe(saved.directions[1].author_review.notes);
    vi.mocked(writingVoiceAction).mockResolvedValue({ id: "proposal-voice", title: "Selected sample", status: "pending" });
    fireEvent.click(within(reopened).getByRole("button", { name: "Queue sample as Change Set" }));
    await waitFor(() => expect(editor.openTab).toHaveBeenCalledWith(expect.objectContaining({ id: "proposal:proposal-voice", kind: "proposal" })));
    expect(writingVoiceAction).toHaveBeenLastCalledWith("/books/voice", "stage", { preview_id: preview.id, direction_id: "direction-2" });
    expect(vi.mocked(writingVoiceAction).mock.calls.some(([, action]) => action === "save")).toBe(false);
  });

  it("reopens saved comparisons and makes selecting a direction a draft-only action", async () => {
    vi.mocked(getWritingVoiceWorkspace).mockResolvedValue({ ...workspace, previews: [preview] });
    render(<WritingVoiceEditor />);
    const card = await screen.findByRole("article", { name: "Preview Atmospheric" });
    fireEvent.click(within(card).getByRole("button", { name: "Use as draft voice" }));
    expect((screen.getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("Atmospheric");
    expect(writingVoiceAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Approve and save to use it/)).toBeTruthy();
  });

  it("expands comparison and restores the previous layout on leaving", async () => {
    vi.mocked(getWritingVoiceWorkspace).mockResolvedValue({ ...workspace, previews: [preview] });
    const view = render(<WritingVoiceEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Expand comparison" }));
    expect(ui.setSidebarOpen).toHaveBeenLastCalledWith(false);
    expect(ui.setSecondarySidebarOpen).toHaveBeenLastCalledWith(false);
    view.unmount();
    expect(ui.setSidebarOpen).toHaveBeenLastCalledWith(true);
    expect(ui.setSecondarySidebarOpen).toHaveBeenLastCalledWith(true);
  });
});
