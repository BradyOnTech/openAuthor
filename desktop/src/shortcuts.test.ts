import { describe, expect, it } from "vitest";
import { resolveShortcutAction } from "./shortcuts";

describe("resolveShortcutAction", () => {
  it("maps save shortcut", () => {
    expect(
      resolveShortcutAction({
        key: "s",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    ).toBe("save_scene");
  });

  it("maps generate/check/runs shortcuts with shift", () => {
    expect(
      resolveShortcutAction({
        key: "G",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true
      })
    ).toBe("generate_proposal");
    expect(
      resolveShortcutAction({
        key: "k",
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: true
      })
    ).toBe("run_continuity_checks");
    expect(
      resolveShortcutAction({
        key: "l",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true
      })
    ).toBe("open_runs_tab");
  });

  it("maps sidebar toggle and view mode shortcuts", () => {
    expect(
      resolveShortcutAction({
        key: "b",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    ).toBe("toggle_sidebar");
    expect(
      resolveShortcutAction({
        key: "1",
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false
      })
    ).toBe("switch_write");
    expect(
      resolveShortcutAction({
        key: "4",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    ).toBe("switch_review");
  });

  it("ignores events without required modifiers", () => {
    expect(
      resolveShortcutAction({
        key: "s",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    ).toBeNull();
    expect(
      resolveShortcutAction({
        key: "s",
        ctrlKey: true,
        metaKey: false,
        altKey: true,
        shiftKey: false
      })
    ).toBeNull();
  });
});
