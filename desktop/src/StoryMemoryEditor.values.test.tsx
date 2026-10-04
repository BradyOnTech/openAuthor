// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryMemoryEditor } from "./components/editor/StoryMemoryEditor";
import type { CodexEntity } from "./types";

const harness = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>>, failSave: false, errors: [] as string[] }));
vi.mock("./contexts/WorkspaceContext", () => ({ useWorkspace: () => ({
  projectRoot: "/synthetic/memory-values", branches: [{ name: "main", current: true }],
  scenes: [{ id: "scene-0001", title: "Opening" }], codexEntities: [{ id: "entity-archive", name: "Archive" }],
  refreshCodex: async () => {}, setError: (value: string) => harness.errors.push(value), setMessage: () => {},
}) }));
vi.mock("./contexts/EditorContext", () => ({ useEditor: () => ({ updateTab: () => {} }) }));
vi.mock("./api", () => ({
  listCodexRelationships: async () => [], addCodexRelationship: async () => ({}), deleteCodexRelationship: async () => {},
  updateCodexEntity: async (_project: string, _id: string, payload: Record<string, unknown>) => {
    harness.updates.push(payload);
    if (harness.failSave) throw new Error("Storage unavailable; draft retained.");
    return { id: "entity-mara", ...payload, created_at: "2026-10-02", updated_at: "2026-10-02" };
  },
}));
const entity: CodexEntity = { id: "entity-mara", type: "character", name: "Mara", description: "Saved description", details: [], notes: "Private notes", created_at: "2026-10-02", updated_at: "2026-10-02" };
beforeEach(() => { localStorage.clear(); harness.updates = []; harness.errors = []; harness.failSave = false; });
afterEach(cleanup);

const invalidInputs = [
  ["number", "", "number"], ["number", "NaN", "number"], ["number", "Infinity", "number"], ["number", "0x20", "number"],
  ["number", "9007199254740993", "number"], ["boolean", "yes", "true or false"],
  ["date", "2026-02-30", "YYYY-MM-DD"], ["date", "2026-1-01", "YYYY-MM-DD"],
  ["list", "key, coat", "JSON array"], ["list", "{}", "JSON array"], ["list", "[1e309]", "finite"],
  ["scene", "scene-missing", "scene"], ["entity", "entity-missing", "Memory entry"],
] as const;
it.each(invalidInputs)("retains an invalid %s detail form (%s) and explains the required value", async (type, input, explanation) => {
  const user = userEvent.setup();
  const first = render(<StoryMemoryEditor entity={entity} />);
  await user.type(screen.getByPlaceholderText("Detail name"), "Draft value");
  await user.selectOptions(screen.getByRole("option", { name: type }).closest("select")!, type);
  if (input) { await user.click(screen.getByPlaceholderText("Value")); await user.paste(input); }
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("alert").textContent).toContain(explanation);
  expect((screen.getByPlaceholderText("Detail name") as HTMLInputElement).value).toBe("Draft value");
  expect(harness.updates).toEqual([]);
  first.unmount();
  render(<StoryMemoryEditor entity={entity} />);
  expect((screen.getByPlaceholderText("Value") as HTMLInputElement).value).toBe(input);
  expect((screen.getByPlaceholderText("Detail name") as HTMLInputElement).value).toBe("Draft value");
});

it("saves explicit number, boolean, date, references and list input as native JSON values", async () => {
  const user = userEvent.setup();
  render(<StoryMemoryEditor entity={entity} />);
  for (const [key, type, value] of [
    ["Age", "number", "31"], ["Ready", "boolean", "false"], ["Date", "date", "2024-02-29"],
    ["First seen", "scene", "scene-0001"], ["Home", "entity", "entity-archive"],
    ["Inventory", "list", '["key",2,false,null,{"color":"blue"}]'],
  ]) {
    await user.type(screen.getByPlaceholderText("Detail name"), key);
    await user.selectOptions(screen.getByRole("option", { name: type }).closest("select")!, type);
    await user.click(screen.getByPlaceholderText("Value"));
    await user.paste(value);
    await user.click(screen.getByRole("button", { name: "Add" }));
  }
  await user.selectOptions(screen.getByLabelText("Assistant access for Age"), "ask");
  await user.selectOptions(screen.getByLabelText("Assistant access for Inventory"), "exclude");
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  await waitFor(() => expect(harness.updates).toHaveLength(1));
  const details = harness.updates[0].details as NonNullable<CodexEntity["details"]>;
  expect(details.map(row => row.value)).toEqual([31, false, "2024-02-29", "scene-0001", "entity-archive", ["key", 2, false, null, { color: "blue" }]]);
  expect(details[0].ai_visibility).toBe("ask");
  expect(details[5].ai_visibility).toBe("exclude");
  expect(harness.updates[0].notes).toBe("Private notes");
});

it("preserves legacy typed values during unrelated/privacy edits and requires explicit repair after editing", async () => {
  const user = userEvent.setup();
  const legacy: CodexEntity = { ...entity, details: [{ key: "Age", type: "number", value: "thirty one", ai_visibility: "ask" }] };
  render(<StoryMemoryEditor entity={legacy} />);
  expect(screen.getByRole("alert").textContent).toContain("saved");
  await user.type(screen.getByLabelText("Description"), " correction");
  await user.selectOptions(screen.getByLabelText("Assistant access for Age"), "exclude");
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  await waitFor(() => expect(harness.updates).toHaveLength(1));
  expect(harness.updates[0].details).toEqual([{ key: "Age", type: "number", value: "thirty one", ai_visibility: "exclude" }]);
  await user.clear(screen.getByLabelText("Detail Age value"));
  await user.type(screen.getByLabelText("Detail Age value"), "not a number");
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  expect(harness.updates).toHaveLength(1);
  expect((screen.getByLabelText("Detail Age value") as HTMLInputElement).value).toBe("not a number");
  await user.clear(screen.getByLabelText("Detail Age value"));
  await user.type(screen.getByLabelText("Detail Age value"), "31");
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  await waitFor(() => expect(harness.updates).toHaveLength(2));
  expect(harness.updates[1].details).toEqual([{ key: "Age", type: "number", value: 31, ai_visibility: "exclude" }]);
});

it("displays JSON list values losslessly and recovers an edited value after backend failure", async () => {
  const user = userEvent.setup();
  const original: CodexEntity = { ...entity, details: [{ key: "Inventory", type: "list", value: ["key", { color: "blue" }], ai_visibility: "ask" }] };
  const first = render(<StoryMemoryEditor entity={original} />);
  expect((screen.getByLabelText("Detail Inventory value") as HTMLInputElement).value).toBe('["key",{"color":"blue"}]');
  await user.clear(screen.getByLabelText("Detail Inventory value"));
  await user.click(screen.getByLabelText("Detail Inventory value"));
  await user.paste('["key","coat"]');
  harness.failSave = true;
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  await waitFor(() => expect(harness.errors[harness.errors.length - 1]).toContain("Storage unavailable"));
  first.unmount();
  render(<StoryMemoryEditor entity={original} />);
  expect((screen.getByLabelText("Detail Inventory value") as HTMLInputElement).value).toBe('["key","coat"]');
  expect(original.details?.[0].value).toEqual(["key", { color: "blue" }]);
  harness.failSave = false;
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  await waitFor(() => expect(harness.updates).toHaveLength(2));
  expect(harness.updates[1].details).toEqual([{ key: "Inventory", type: "list", value: ["key", "coat"], ai_visibility: "ask" }]);
});

it("does not silently convert a legacy numeric string when only its key is renamed", async () => {
  const user = userEvent.setup();
  const legacy: CodexEntity = { ...entity, details: [{ key: "Age", type: "number", value: "31", ai_visibility: "ask" }] };
  render(<StoryMemoryEditor entity={legacy} />);
  await user.clear(screen.getByLabelText("Detail 1 key"));
  await user.type(screen.getByLabelText("Detail 1 key"), "Years");
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  expect(harness.updates).toEqual([]);
  expect((screen.getByLabelText("Detail Years value") as HTMLInputElement).value).toBe("31");
  expect(legacy.details?.[0].value).toBe("31");
  await user.clear(screen.getByLabelText("Detail Years value"));
  await user.type(screen.getByLabelText("Detail Years value"), "31");
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  await waitFor(() => expect(harness.updates).toHaveLength(1));
  expect(harness.updates[0].details).toEqual([{ key: "Years", type: "number", value: 31, ai_visibility: "ask" }]);
});

it("refuses duplicate new keys and keeps an existing detail whose key was accidentally cleared", async () => {
  const user = userEvent.setup();
  const original: CodexEntity = { ...entity, details: [{ key: "Age", type: "number", value: 31, ai_visibility: "ask" }] };
  render(<StoryMemoryEditor entity={original} />);
  await user.type(screen.getByPlaceholderText("Detail name"), "age");
  await user.type(screen.getByPlaceholderText("Value"), "Conflicting new text");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  expect((screen.getByPlaceholderText("Detail name") as HTMLInputElement).value).toBe("age");
  await user.clear(screen.getByLabelText("Detail 1 key"));
  await user.click(screen.getByRole("button", { name: "Save Memory" }));
  expect(harness.updates).toEqual([]);
  expect((screen.getByRole("textbox", { name: /^Detail\s+value$/ }) as HTMLInputElement).value).toBe("31");
});
