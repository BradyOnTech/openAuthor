// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryWorkspace } from "./MemoryWorkspace";
const editor = vi.hoisted(() => ({ activeTabId: "memory:canon", updateTab: vi.fn() }));
vi.mock("../../contexts/EditorContext", () => ({ useEditor: () => editor }));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => ({ projectRoot: "/book", branches: [] }) }));
vi.mock("./CanonMemoryEditor", () => ({ CanonMemoryEditor: () => { const [notes, setNotes] = useState(""); return <label>Review notes<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>; } }));
vi.mock("./MemorySuggestionReview", () => ({ MemorySuggestionReview: () => <p>Review recorded suggestion evidence</p> }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(cleanup);

it("keeps Canon review notes when changing Memory views and consumes navigation once", () => {
  const view = render(<MemoryWorkspace request={{ memoryView: "canon" }} />);
  fireEvent.change(screen.getByLabelText("Review notes"), { target: { value: "An intentional narrator contradiction." } });
  fireEvent.click(screen.getByRole("button", { name: "Show suggestion inbox" }));
  expect(screen.getByText("Review recorded suggestion evidence")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show Canon & Continuity" }));
  expect((screen.getByLabelText("Review notes") as HTMLTextAreaElement).value).toBe("An intentional narrator contradiction.");
  expect(editor.updateTab).toHaveBeenCalledWith("memory:canon", { data: null });
  fireEvent.click(screen.getByRole("button", { name: "Show suggestion inbox" }));
  view.unmount();
  render(<MemoryWorkspace />);
  expect(screen.getByRole("button", { name: "Show suggestion inbox" }).getAttribute("aria-pressed")).toBe("true");
});
