// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isMenuShortcut, listenForMenuShortcuts, MENU_DOM_EVENT, replayMenuShortcut } from "./menuShortcuts";
import { primaryModifier } from "./platformKeys";

describe("native menu shortcuts", () => {
  const seen: Array<{ key: string; primary: boolean; shift: boolean; target: EventTarget | null }> = [];
  const record = (event: KeyboardEvent) => seen.push({ key: event.key, primary: primaryModifier(event), shift: event.shiftKey, target: event.target });
  afterEach(() => { window.removeEventListener("keydown", record); seen.length = 0; document.body.replaceChildren(); });

  it("replays a menu choice as the key press the interface already handles", () => {
    window.addEventListener("keydown", record);
    replayMenuShortcut({ key: "s", shift: false });
    replayMenuShortcut({ key: "d", shift: true });
    expect(seen.map(({ key, primary, shift }) => ({ key, primary, shift }))).toEqual([
      { key: "s", primary: true, shift: false },
      { key: "D", primary: true, shift: true },
    ]);
  });

  it("sends the key press to the focused field so field shortcuts such as Italic apply there", () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    window.addEventListener("keydown", record);
    replayMenuShortcut({ key: "i", shift: false });
    expect(seen[0].target).toBe(field);
  });

  it("replays the shortcut the native shell dispatches, and ignores anything malformed", () => {
    window.addEventListener("keydown", record);
    const stop = listenForMenuShortcuts();
    window.dispatchEvent(new CustomEvent(MENU_DOM_EVENT, { detail: { key: "f", shift: false } }));
    window.dispatchEvent(new CustomEvent(MENU_DOM_EVENT, { detail: { key: "find", shift: false } }));
    window.dispatchEvent(new CustomEvent(MENU_DOM_EVENT));
    stop();
    window.dispatchEvent(new CustomEvent(MENU_DOM_EVENT, { detail: { key: "s", shift: false } }));
    expect(seen.map(({ key }) => key)).toEqual(["f"]);
  });

  it("accepts only a single key with an explicit shift state", () => {
    expect(isMenuShortcut({ key: ",", shift: false })).toBe(true);
    for (const value of [null, "s", { key: "save", shift: false }, { key: "s" }, { key: 1, shift: true }]) expect(isMenuShortcut(value)).toBe(false);
  });
});
