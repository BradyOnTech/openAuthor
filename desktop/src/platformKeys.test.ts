// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { primaryModifier } from "./platformKeys";

describe("primary shortcut modifier", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is Command alone on a Mac, leaving Control for caret and deletion keys", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(primaryModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(primaryModifier({ metaKey: false, ctrlKey: true })).toBe(false);
    expect(primaryModifier({ metaKey: true, ctrlKey: true })).toBe(false);
  });

  it("is Control elsewhere", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    expect(primaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(primaryModifier({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});
