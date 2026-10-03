// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UIProvider, useUI } from "../../contexts/UIContext";
import { EditorProvider, useEditor } from "../../contexts/EditorContext";
import { getScene, getCodexEntity } from "../../api";
import type { SceneDetail, SceneSummary } from "../../types";
import { CommandPalette } from "./CommandPalette";

const workspace = vi.hoisted(() => ({
  projectRoot: "/books/harbor",
  scenes: [] as SceneSummary[],
  codexEntities: [] as Array<{ id: string; name: string; type: string }>,
  setError: vi.fn(),
}));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace }));
vi.mock("../../api", () => ({ getScene: vi.fn(), getCodexEntity: vi.fn() }));

function Workspace() {
  const { setCommandPaletteOpen } = useUI();
  const { activeTabId, tabs, openTab } = useEditor();
  const selected = tabs.find(tab => tab.id === activeTabId);
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [setCommandPaletteOpen]);
  return <>
    <textarea aria-label="Scene prose" defaultValue="Mara kept the folded ticket." />
    <button onClick={() => openTab({ id: "plan", kind: "plan", label: "Plan" })}>Choose Plan</button>
    <button onClick={() => openTab({ id: "scene:scene-a", kind: "scene", label: "Unfinished Arrival", modified: true, data: { id: "scene-a", title: "Unfinished Arrival", body: "Unfinished prose." } as SceneDetail })}>Open unfinished Arrival</button>
    <output aria-label="Selected document">{activeTabId}</output>
    <output aria-label="Selected title">{selected?.label}</output>
    <output aria-label="Selected prose">{(selected?.data as SceneDetail | undefined)?.body}</output>
    <output aria-label="Unfinished document">{String(Boolean(selected?.modified))}</output>
    <CommandPalette />
  </>;
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  workspace.projectRoot = "/books/harbor";
  workspace.codexEntities = [];
  workspace.scenes = [
    { id: "scene-a", title: "Harbor Arrival", status: "draft", pov: "Mara" },
    { id: "scene-b", title: "Harbor Departure", status: "draft", pov: "Mara" },
  ] as SceneSummary[];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function view(scope = "main") {
  return <UIProvider><EditorProvider key={JSON.stringify([workspace.projectRoot, scope])} scope={scope}><Workspace /></EditorProvider></UIProvider>;
}

async function palette() {
  const rendered = render(view());
  const user = userEvent.setup();
  const prose = screen.getByRole("textbox", { name: "Scene prose" }) as HTMLTextAreaElement;
  prose.focus();
  prose.setSelectionRange(5, 9, "backward");
  await user.keyboard("{Control>}k{/Control}");
  return { user, prose, input: screen.getByPlaceholderText("Search scenes, entities, commands..."), rendered };
}

it("announces the keyboard-selected result through the actual combobox and listbox", async () => {
  const { user, input } = await palette();
  expect(screen.getByRole("dialog", { name: "Command Palette" }).getAttribute("aria-modal")).toBe("true");
  expect(screen.getByRole("combobox", { name: "Search scenes, entities, commands" })).toBe(input);
  const list = screen.getByRole("listbox", { name: "Search results" });
  expect(input.getAttribute("aria-controls")).toBe(list.id);
  await user.type(input, "#harbor");
  await user.keyboard("{ArrowDown}");
  const selected = screen.getByRole("option", { name: "Harbor Departure", selected: true });
  expect(input.getAttribute("aria-activedescendant")).toBe(selected.id);
  expect(document.activeElement).toBe(input);
});

it("keeps Tab and Shift Tab inside the open palette", async () => {
  const { user, input } = await palette();
  await user.tab();
  expect(document.activeElement).toBe(input);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(input);
});

it("restores the writing focus and exact selection on Escape", async () => {
  const { user, prose } = await palette();
  await user.keyboard("{Escape}");
  expect(screen.queryByPlaceholderText("Search scenes, entities, commands...")).toBeNull();
  expect(document.activeElement).toBe(prose);
  expect([prose.selectionStart, prose.selectionEnd, prose.selectionDirection]).toEqual([5, 9, "backward"]);
});

it("does not reopen a delayed scene after the author chooses another document", async () => {
  let finish!: (scene: SceneDetail) => void;
  vi.mocked(getScene).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { user, input } = await palette();
  await user.type(input, "#arrival");
  await user.keyboard("{Enter}");
  expect(getScene).toHaveBeenCalledWith("/books/harbor", "scene-a");
  await user.click(screen.getByRole("button", { name: "Choose Plan" }));
  await act(async () => { finish({ id: "scene-a", title: "Harbor Arrival", body: "Saved scene." } as SceneDetail); });
  expect(screen.getByLabelText("Selected document").textContent).toBe("plan");
});

it("clears the active descendant for no results and selects the first result after a new query", async () => {
  const { user, input } = await palette();
  await user.type(input, "#harbor");
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: "Harbor Departure", selected: true })).toBeTruthy();
  await user.clear(input);
  await user.type(input, "#unrecorded");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  expect(screen.getByRole("status", { name: "" }).textContent).toBe("No results");
  await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
  expect(getScene).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  await user.clear(input);
  await user.type(input, "#harbor");
  expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Harbor Arrival", selected: true }).id);
});

it("keeps the selected result exposed and scrolls it into view when the list shrinks", async () => {
  const { user, input, rendered } = await palette();
  await user.type(input, "#harbor");
  await user.keyboard("{ArrowDown}");
  const arrival = screen.getByRole("option", { name: "Harbor Arrival" });
  const scroll = vi.fn();
  arrival.scrollIntoView = scroll;
  workspace.scenes = workspace.scenes.slice(0, 1);
  rendered.rerender(view());
  expect(input.getAttribute("aria-activedescendant")).toBe(arrival.id);
  expect(arrival.getAttribute("aria-selected")).toBe("true");
  expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
});

it("restores the writing selection on backdrop dismissal", async () => {
  const { user, prose } = await palette();
  await user.click(screen.getByRole("dialog", { name: "Command Palette" }).parentElement!);
  expect(document.activeElement).toBe(prose);
  expect([prose.selectionStart, prose.selectionEnd, prose.selectionDirection]).toEqual([5, 9, "backward"]);
});

it("activates the selected scene with fresh data without restoring an old writing focus", async () => {
  vi.mocked(getScene).mockResolvedValue({ id: "scene-b", title: "Renamed Departure", body: "Saved prose." } as SceneDetail);
  const { user, input, prose } = await palette();
  await user.type(input, "#harbor");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByLabelText("Selected document").textContent).toBe("scene:scene-b");
  expect(screen.getByLabelText("Selected title").textContent).toBe("Renamed Departure");
  expect(screen.getByLabelText("Selected prose").textContent).toBe("Saved prose.");
  expect(getScene).toHaveBeenCalledWith("/books/harbor", "scene-b");
  expect(document.activeElement).not.toBe(prose);
});

it("activates pointer-selected options and navigation commands", async () => {
  vi.mocked(getScene).mockResolvedValue({ id: "scene-b", title: "Harbor Departure", body: "Saved prose." } as SceneDetail);
  const { user, input } = await palette();
  await user.type(input, "#harbor");
  const departure = screen.getByRole("option", { name: "Harbor Departure" });
  await user.hover(departure);
  expect(input.getAttribute("aria-activedescendant")).toBe(departure.id);
  await user.click(departure);
  expect(screen.getByLabelText("Selected document").textContent).toBe("scene:scene-b");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(screen.getByRole("combobox"), ">focus plan");
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("Selected document").textContent).toBe("plan");
});

it("returns to an already open unfinished document without replacing its data", async () => {
  const { user, prose } = await palette();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Open unfinished Arrival" }));
  prose.focus();
  await user.keyboard("{Control>}k{/Control}");
  await user.type(screen.getByRole("combobox"), "#arrival");
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("Selected document").textContent).toBe("scene:scene-a");
  expect(screen.getByLabelText("Selected title").textContent).toBe("Unfinished Arrival");
  expect(screen.getByLabelText("Selected prose").textContent).toBe("Unfinished prose.");
  expect(screen.getByLabelText("Unfinished document").textContent).toBe("true");
  expect(getScene).not.toHaveBeenCalled();
});

it.each(["book", "Storyline"])("ignores a delayed result after the %s changes", async change => {
  let finish!: (scene: SceneDetail) => void;
  vi.mocked(getScene).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { user, input, rendered } = await palette();
  await user.type(input, "#arrival");
  await user.keyboard("{Enter}");
  if (change === "book") workspace.projectRoot = "/books/other";
  rendered.rerender(view(change === "Storyline" ? "alternate" : "main"));
  await user.click(screen.getByRole("button", { name: "Choose Plan" }));
  await act(async () => { finish({ id: "scene-a", title: "Harbor Arrival", body: "Saved scene." } as SceneDetail); });
  expect(screen.getByLabelText("Selected document").textContent).toBe("plan");
});

it("ignores a delayed entity failure after another document is chosen", async () => {
  workspace.codexEntities = [{ id: "mara", name: "Mara", type: "character" }];
  let fail!: (error: Error) => void;
  vi.mocked(getCodexEntity).mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  const { user, input } = await palette();
  await user.type(input, "@mara");
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "Choose Plan" }));
  await act(async () => { fail(new Error("Old book unavailable")); });
  expect(workspace.setError).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Selected document").textContent).toBe("plan");
});

it("does not activate a result while the author is composing input", async () => {
  const { input } = await palette();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(getScene).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeTruthy();
});
