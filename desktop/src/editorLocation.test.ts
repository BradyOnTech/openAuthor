// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { rememberTextLocation, restoreTextLocation } from "./editorLocation";
beforeEach(() => localStorage.clear());
it("restores a selection and scroll within the same book and Storyline", () => {
  const input = document.createElement("textarea"); input.value = "🌙 Mara waited beside the gate.";
  input.setSelectionRange(3, 7, "backward"); input.scrollTop = 200;
  rememberTextLocation("/book", "primary", "s1", input);
  expect(restoreTextLocation("/book", "primary", "s1", input.value)).toMatchObject({ start: 3, end: 7, direction: "backward", scrollTop: 200 });
  expect(restoreTextLocation("/book", "alternate", "s1", input.value)).toBeNull();
  expect(restoreTextLocation("/other", "primary", "s1", input.value)).toBeNull();
});
it("relocates a unique passage after an insertion and refuses ambiguity", () => {
  const input = document.createElement("textarea"); input.value = "Mara waited beside the gate."; input.setSelectionRange(5, 11);
  rememberTextLocation("/book", "primary", "s1", input);
  expect(restoreTextLocation("/book", "primary", "s1", "New opening. " + input.value)).toMatchObject({ start: 18, end: 24 });
  expect(restoreTextLocation("/book", "primary", "s1", "New opening. " + input.value + input.value)).toBeNull();
});
