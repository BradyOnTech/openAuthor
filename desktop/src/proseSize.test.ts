// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyStoredProseSize, DEFAULT_PROSE_SIZE, proseSize, setProseSize, stepProseSize } from "./proseSize";

describe("prose text size", () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.style.removeProperty("--prose-size"); });

  it("defaults to the designed size and applies a stored choice", () => {
    expect(proseSize()).toBe(DEFAULT_PROSE_SIZE);
    localStorage.setItem("openauthor.proseSize", "20");
    applyStoredProseSize();
    expect(document.documentElement.style.getPropertyValue("--prose-size")).toBe("20px");
  });

  it("steps along the scale and stops at its ends", () => {
    expect(stepProseSize(1)).toBe(18);
    expect(setProseSize(24)).toBe(24);
    expect(stepProseSize(1)).toBe(24);
    expect(setProseSize(15)).toBe(15);
    expect(stepProseSize(-1)).toBe(15);
    expect(localStorage.getItem("openauthor.proseSize")).toBe("15");
  });

  it("ignores a size that is not on the scale", () => {
    localStorage.setItem("openauthor.proseSize", "400");
    expect(proseSize()).toBe(DEFAULT_PROSE_SIZE);
    expect(setProseSize(3)).toBe(DEFAULT_PROSE_SIZE);
  });
});
