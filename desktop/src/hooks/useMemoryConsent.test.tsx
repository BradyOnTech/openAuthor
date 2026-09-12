// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCodexEntity } from "../api";
import type { CodexEntity } from "../types";
import { useMemoryConsent } from "./useMemoryConsent";

vi.mock("../api", () => ({ getCodexEntity: vi.fn() }));
const settled = vi.fn();
const entity: CodexEntity = { id: "mara", type: "character", name: "Mara", description: "A cartographer.", ai_visibility: "ask", created_at: "", updated_at: "" };
function Harness({ threadId = "chat-1" }: { threadId?: string }) {
  const consent = useMemoryConsent("/books/fixture", threadId);
  return <><button onClick={() => void consent.requestApproval(["mara"]).then(settled).catch(error => settled(error.message))}>Request</button>{consent.review}</>;
}

describe("one-request Story Memory consent", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(getCodexEntity).mockResolvedValue(entity); });
  afterEach(cleanup);

  it("waits for author approval, defaults focus to Cancel, and asks again next time", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    await screen.findByRole("region", { name: "Story Memory permission" });
    expect(settled).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow for this request" }));
    await waitFor(() => expect(settled).toHaveBeenLastCalledWith(["mara"]));
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    await screen.findByRole("region", { name: "Story Memory permission" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    await waitFor(() => expect(settled).toHaveBeenLastCalledWith(null));
  });

  it("checks current access and does not offer approval for an excluded entry", async () => {
    vi.mocked(getCodexEntity).mockResolvedValue({ ...entity, ai_visibility: "exclude" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    await waitFor(() => expect(settled).toHaveBeenCalledWith(expect.stringContaining("excluded from AI context")));
    expect(screen.queryByRole("region", { name: "Story Memory permission" })).toBeNull();
  });

  it("asks for ask-before-use details of an otherwise automatic entry", async () => {
    vi.mocked(getCodexEntity).mockResolvedValue({ ...entity, ai_visibility: "include", details: [{ key: "ending", type: "text", value: "Author direction", ai_visibility: "ask" }] });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    await screen.findByRole("region", { name: "Story Memory permission" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(settled).toHaveBeenCalledWith(null));
  });

  it("cancels pending permission when switching threads", async () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    await screen.findByRole("region", { name: "Story Memory permission" });
    view.rerender(<Harness threadId="chat-2" />);
    await waitFor(() => expect(settled).toHaveBeenCalledWith(null));
    expect(screen.queryByRole("region", { name: "Story Memory permission" })).toBeNull();
  });

  it("does not open a late permission request after changing threads", async () => {
    let finish!: (value: CodexEntity) => void;
    vi.mocked(getCodexEntity).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    view.rerender(<Harness threadId="chat-2" />);
    await act(async () => finish(entity));
    expect(settled).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("region", { name: "Story Memory permission" })).toBeNull();
  });
});
