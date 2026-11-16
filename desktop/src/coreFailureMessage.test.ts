import { afterEach, describe, expect, it, vi } from "vitest";
import { coreFailureMessage } from "./api";

describe("core failure messages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops the engine's error prefix and keeps the sentence", () => {
    expect(coreFailureMessage({ stderr: "error: Scene not found: scene-0099\n", stdout: "" })).toBe("Scene not found: scene-0099");
    expect(coreFailureMessage({ stderr: "", stdout: "Budget limit reached." })).toBe("Budget limit reached.");
  });

  it("reduces a stack trace to its final message and logs the rest for developers", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const trace = "Traceback (most recent call last):\n  File \"cli.py\", line 12, in main\n    run()\nUnicodeDecodeError: 'utf-8' codec can't decode byte 0xe9";
    expect(coreFailureMessage({ stderr: trace, stdout: "" })).toBe("The openAuthor engine hit an unexpected problem: 'utf-8' codec can't decode byte 0xe9");
    expect(logged).toHaveBeenCalledWith(trace);
  });

  it("explains an empty failure", () => {
    expect(coreFailureMessage({ stderr: "", stdout: "" })).toMatch(/stopped without an explanation/);
  });
});
