// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writingVoiceAction, type VoicePreview } from "../../api";
import { VoiceAssessment } from "./VoiceAssessment";
vi.mock("../../api", () => ({ writingVoiceAction: vi.fn(), getWritingVoiceWorkspace: vi.fn() }));
const direction = { id: "direction-1", author_review: { ratings: {}, notes: "Saved note" } } as VoicePreview["directions"][number];
const props = { project: "book", scope: "main", previewId: "preview-1", direction, criteria: { voice_fit: "Voice fit" }, onSaved: vi.fn() };
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });
afterEach(cleanup);
function open() { fireEvent.click(screen.getByText("Your quality assessment")); }

it("restores unfinished ratings and notes without saving or learning a voice", () => {
  const view = render(<VoiceAssessment {...props} />); open();
  fireEvent.change(screen.getByRole("textbox", { name: "Assessment notes" }), { target: { value: "Check Ivo's knowledge" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Voice fit" }), { target: { value: "needs_revision" } });
  view.unmount(); render(<VoiceAssessment {...props} />);
  expect((screen.getByRole("textbox", { name: "Assessment notes" }) as HTMLTextAreaElement).value).toBe("Check Ivo's knowledge");
  expect((screen.getByRole("combobox", { name: "Voice fit" }) as HTMLSelectElement).value).toBe("needs_revision");
  expect(writingVoiceAction).not.toHaveBeenCalled();
});

it("keeps newer notes through a late save acknowledgement and remount", async () => {
  let finish!: (value: VoicePreview) => void;
  vi.mocked(writingVoiceAction).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = render(<VoiceAssessment {...props} />); open();
  fireEvent.change(screen.getByRole("textbox", { name: "Assessment notes" }), { target: { value: "Submitted" } });
  fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Assessment notes" }), { target: { value: "Newer typing" } });
  const saved = { ...direction, author_review: { ratings: {}, notes: "Submitted" } };
  await act(async () => finish({ directions: [saved] } as VoicePreview));
  view.unmount(); render(<VoiceAssessment {...props} direction={saved} />);
  expect((screen.getByRole("textbox", { name: "Assessment notes" }) as HTMLTextAreaElement).value).toBe("Newer typing");
  vi.mocked(writingVoiceAction).mockResolvedValue({ directions: [saved] });
  fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
  await waitFor(() => expect(writingVoiceAction).toHaveBeenLastCalledWith("book", "review", expect.objectContaining({ review: { ratings: {}, notes: "Newer typing" }, expected_review: saved.author_review })));
});

it("preserves the original baseline on conflict and requires explicit review before rebasing", async () => {
  const first = render(<VoiceAssessment {...props} />); open();
  fireEvent.change(screen.getByRole("textbox", { name: "Assessment notes" }), { target: { value: "My unsaved review" } });
  first.unmount();
  const other = { ...direction, author_review: { ratings: {}, notes: "Another reader saved this" } };
  vi.mocked(writingVoiceAction).mockRejectedValue(new Error("saved elsewhere"));
  render(<VoiceAssessment {...props} direction={other} />);
  fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
  await screen.findByText(/Error: saved elsewhere/);
  expect(writingVoiceAction).toHaveBeenLastCalledWith("book", "review", expect.objectContaining({ expected_review: direction.author_review }));
  expect((screen.getByRole("textbox", { name: "Assessment notes" }) as HTMLTextAreaElement).value).toBe("My unsaved review");
  fireEvent.click(screen.getByRole("button", { name: /I reviewed the saved assessment/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
  await waitFor(() => expect(writingVoiceAction).toHaveBeenLastCalledWith("book", "review", expect.objectContaining({ expected_review: other.author_review })));
});

it("does not restore another preview, direction, or Storyline's assessment", () => {
  const view = render(<VoiceAssessment {...props} />); open();
  fireEvent.change(screen.getByRole("textbox", { name: "Assessment notes" }), { target: { value: "Private to this sample" } });
  view.unmount();
  for (const changes of [{ scope: "other" }, { previewId: "preview-2" }, { direction: { ...direction, id: "direction-2" } }]) {
    const other = render(<VoiceAssessment {...props} {...changes} />); open();
    expect((screen.getByRole("textbox", { name: "Assessment notes" }) as HTMLTextAreaElement).value).toBe("Saved note");
    other.unmount();
  }
});
