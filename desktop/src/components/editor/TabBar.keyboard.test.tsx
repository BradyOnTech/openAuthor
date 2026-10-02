// @vitest-environment jsdom
import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { EditorProvider, useEditor } from "../../contexts/EditorContext";
import { TabBar } from "./TabBar";

afterEach(cleanup);

function Workspace() {
  const { tabs, activeTabId, openTab } = useEditor();
  useEffect(() => {
    openTab({ id: "scene-1", kind: "scene", label: "Ferry", modified: true });
    openTab({ id: "plan", kind: "plan", label: "Plan" });
    openTab({ id: "memory", kind: "memory", label: "Memory" });
  }, [openTab]);
  return <div className="editor-area"><button>Before tabs</button><TabBar idPrefix="test" />
    {tabs.length ? <div role="tabpanel" tabIndex={0} aria-label="Current document">{activeTabId}</div> : <button data-editor-empty-action>Open manuscript</button>}
    <button>After workspace</button></div>;
}
async function book() {
  render(<EditorProvider><Workspace /></EditorProvider>);
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
  return userEvent.setup();
}

it("arrows wrap without changing the document until Enter or Space activates it", async () => {
  const user = await book();
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Memory" }));
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Plan" }));
  expect(screen.getByRole("tabpanel").textContent).toBe("memory");
  await user.keyboard("{Enter}");
  expect(screen.getByRole("tabpanel").textContent).toBe("plan");
  await user.keyboard("{Home}{ArrowLeft}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Memory" }));
  await user.keyboard("{ArrowRight} ");
  expect(screen.getByRole("tabpanel").textContent).toBe("scene-1");
  expect(screen.getByRole("tab", { name: "Ferry, unsaved changes" }).getAttribute("aria-selected")).toBe("true");
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Memory" }));
  expect(screen.getByRole("tabpanel").textContent).toBe("scene-1");
});

it("offers one tab and its close action in the tab sequence, then reenters at the selected document", async () => {
  const user = await book();
  await user.tab(); await user.tab();
  await user.keyboard("{ArrowLeft}");
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close Plan" }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("tabpanel"));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close Memory" }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Memory" }));
});

it("closing a keyboard-focused document retains focus on a surviving tab or the empty workspace action", async () => {
  const user = await book();
  await user.tab(); await user.tab(); await user.tab();
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Plan" }));
  expect(screen.getByRole("tabpanel").textContent).toBe("plan");
  await user.tab(); await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Ferry, unsaved changes" }));
  await user.tab(); await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open manuscript" }));
});
