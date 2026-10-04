// @vitest-environment jsdom
import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TabBar } from "../components/editor/TabBar";
import { readWorkspace, saveWorkspace, workspaceKey } from "../tabRecovery";
import { EditorProvider, useEditor } from "./EditorContext";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function ChosenDirectionWorkspace({ openFirst = false }: { openFirst?: boolean }) {
  const { openTab, closeTab } = useEditor();
  useEffect(() => {
    openTab({ id: "alternatives:scene-1", kind: "alternatives", label: "Compare Directions" });
    if (openFirst) {
      openTab({ id: "plan", kind: "plan", label: "Plan" });
      openTab({ id: "alternatives:scene-1", kind: "alternatives", label: "Compare Directions" });
    }
  }, [openFirst, openTab]);
  return <>
    <TabBar idPrefix="direction-test" />
    <button onClick={async () => {
      await Promise.resolve();
      if (openFirst) openTab({ id: "proposal:direction-2", kind: "proposal", label: "Direction 2" });
      closeTab("alternatives:scene-1");
      if (!openFirst) openTab({ id: "proposal:direction-2", kind: "proposal", label: "Direction 2" });
    }}>Choose Direction</button>
  </>;
}

it("selects the chosen direction when an asynchronous action closes the comparison and opens its review", async () => {
  render(<EditorProvider><ChosenDirectionWorkspace /></EditorProvider>);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Compare Directions" }).getAttribute("aria-selected")).toBe("true"));
  await userEvent.setup().click(screen.getByRole("button", { name: "Choose Direction" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Direction 2" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.queryByRole("tab", { name: "Compare Directions" })).toBeNull();
});

it("retains a newly opened review when the same asynchronous action then closes the previous active workspace", async () => {
  render(<EditorProvider><ChosenDirectionWorkspace openFirst /></EditorProvider>);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Compare Directions" }).getAttribute("aria-selected")).toBe("true"));
  await userEvent.setup().click(screen.getByRole("button", { name: "Choose Direction" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Direction 2" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.queryByRole("tab", { name: "Compare Directions" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Plan" }).getAttribute("aria-selected")).toBe("false");
});

function BookWorkspace({ createTabs = true }: { createTabs?: boolean }) {
  const { openTab, updateTab, splitDirection, secondaryActiveTabId } = useEditor();
  useEffect(() => {
    if (!createTabs) return;
    openTab({ id: "plan", kind: "plan", label: "Plan" });
    openTab({ id: "settings", kind: "settings", label: "Settings" });
    openTab({ id: "memory", kind: "memory", label: "Memory" });
  }, [createTabs, openTab]);
  return <>
    <TabBar idPrefix="book-test" />
    <button onClick={() => openTab({ id: "plan", kind: "plan", label: "Updated Plan" })}>Reopen Plan</button>
    <button onClick={() => updateTab("plan", { label: "Refreshed Plan", modified: true })}>Refresh Plan</button>
    <output aria-label="Split workspace">{splitDirection}:{secondaryActiveTabId}</output>
  </>;
}

it("retains the selected document when closing another tab and selects a neighbor when closing the active tab", async () => {
  render(<EditorProvider><BookWorkspace /></EditorProvider>);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole("tab", { name: "Memory" }).getAttribute("aria-selected")).toBe("true"));
  await user.click(screen.getByRole("button", { name: "Close Plan" }));
  expect(screen.getByRole("tab", { name: "Memory" }).getAttribute("aria-selected")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Close Memory" }));
  expect(screen.getByRole("tab", { name: "Settings" }).getAttribute("aria-selected")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Close Settings" }));
  expect(screen.queryByRole("tab")).toBeNull();
});

it("reopens an existing document once and refreshes another tab without changing the active document", async () => {
  render(<EditorProvider><BookWorkspace /></EditorProvider>);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
  await user.click(screen.getByRole("button", { name: "Refresh Plan" }));
  expect(screen.getByRole("tab", { name: "Memory" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Refreshed Plan, unsaved changes" }).getAttribute("aria-selected")).toBe("false");
  await user.click(screen.getByRole("button", { name: "Reopen Plan" }));
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(screen.getByRole("tab", { name: "Updated Plan, unsaved changes" }).getAttribute("aria-selected")).toBe("true");
});

it("restores the selected document and split workspace, then persists the next selection", async () => {
  const key = workspaceKey("/books/tab-recovery", "main");
  saveWorkspace(key, [
    { id: "plan", kind: "plan", label: "Plan" },
    { id: "memory", kind: "memory", label: "Memory" },
  ], "plan", "horizontal", "memory");
  render(<EditorProvider projectRoot="/books/tab-recovery"><BookWorkspace createTabs={false} /></EditorProvider>);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole("tab", { name: "Plan" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.getByRole("status", { name: "Split workspace" }).textContent).toBe("horizontal:memory");
  await user.click(screen.getByRole("tab", { name: "Memory" }));
  await waitFor(() => expect(readWorkspace(key)?.activeTabId).toBe("memory"));
  await user.click(screen.getByRole("button", { name: "Close Memory" }));
  await waitFor(() => expect(readWorkspace(key)?.activeTabId).toBe("plan"));
  expect(screen.getByRole("tab", { name: "Plan" }).getAttribute("aria-selected")).toBe("true");
});
