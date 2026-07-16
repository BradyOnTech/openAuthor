import { describe, expect, it } from "vitest";
import { isMissingGitRepositoryError } from "./WorkspaceContext";

describe("workspace error classification", () => {
  it("treats an uninitialized Git repository as an optional Storylines state", () => {
    expect(isMissingGitRepositoryError(new Error("fatal: not a git repository"))).toBe(true);
    expect(isMissingGitRepositoryError("Project is not a git repository.")).toBe(true);
    expect(isMissingGitRepositoryError(new Error("permission denied"))).toBe(false);
  });
});
