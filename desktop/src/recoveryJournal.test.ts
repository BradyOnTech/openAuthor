// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSceneRecoveryDraft,
  listSceneRecoveryDrafts,
  readSceneRecoveryDraft,
  recoveryDraftMatchesScene,
  writeSceneRecoveryDraft,
} from "./recoveryJournal";

describe("scene recovery journal", () => {
  it("retains independently owned drafts of the same scene instead of replacing the first window's writing", () => {
    const first = { projectRoot: "/novels/one", sceneId: "scene-0001", baseUpdatedAt: "", title: "Opening", body: "Window one's unsaved passage.", draftId: "draft-window-one", sequence: 1 };
    const second = { ...first, body: "Window two's different passage.", draftId: "draft-window-two" };
    writeSceneRecoveryDraft(first);
    writeSceneRecoveryDraft(second);
    const persisted = Array.from({ length: window.localStorage.length }, (_, index) => JSON.parse(window.localStorage.getItem(window.localStorage.key(index)!)!));
    expect(persisted.map((draft) => draft.body).sort()).toEqual([first.body, second.body].sort());
  });

  it("treats serializer-only trailing newlines as the saved scene", () => {
    expect(recoveryDraftMatchesScene(
      { title: "Opening", body: "# Opening\n\nThe door opens." },
      { title: "Opening", body: "# Opening\n\nThe door opens.\n" }
    )).toBe(true);
    expect(recoveryDraftMatchesScene(
      { title: "Opening", body: "The door stays closed." },
      { title: "Opening", body: "The door opens.\n" }
    )).toBe(false);
  });

  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("does not delete a newer recovery draft when an older save completes", () => {
    writeSceneRecoveryDraft({ projectRoot: "/novels/one", sceneId: "scene-0001", baseUpdatedAt: "", title: "Opening", body: "Newest writing." });
    clearSceneRecoveryDraft("/novels/one", "scene-0001", { title: "Opening", body: "Older writing." });
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")?.body).toBe("Newest writing.");
  });

  it("reports an unavailable recovery store without throwing away the editor", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    expect(writeSceneRecoveryDraft({ projectRoot: "/novels/one", sceneId: "scene-0001", baseUpdatedAt: "", title: "Opening", body: "Unsaved writing." })).toBeNull();
  });

  it("tolerates denied access to recovery storage during load and cleanup", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")).toBeNull();
    expect(() => clearSceneRecoveryDraft("/novels/one", "scene-0001")).not.toThrow();
  });

  it("persists and clears an unsaved scene draft by project and scene", () => {
    const record = writeSceneRecoveryDraft({
      projectRoot: "/novels/one",
      sceneId: "scene-0001",
      baseUpdatedAt: "2026-07-15T12:00:00Z",
      title: "Recovered title",
      body: "Recovered body",
    });
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")?.body).toBe("Recovered body");
    expect(readSceneRecoveryDraft("/novels/two", "scene-0001")).toBeNull();
    clearSceneRecoveryDraft("/novels/one", "scene-0001", record!);
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")).toBeNull();
  });

  it("retains corrupt journal bytes for manual recovery instead of deleting them", () => {
    const key = `openauthor.sceneRecovery.v1:${encodeURIComponent("/novels/one")}:${encodeURIComponent("scene-0001")}`;
    window.localStorage.setItem(key, "not-json");
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")).toBeNull();
    expect(window.localStorage.getItem(key)).toBe("not-json");
  });

  it("retiring one window cannot erase another window or a newer sequence", () => {
    const draft = { projectRoot: "/novels/one", sceneId: "scene-0001", baseUpdatedAt: "", title: "Opening", body: "Old", draftId: "window-one", sequence: 1 };
    const old = writeSceneRecoveryDraft(draft)!;
    writeSceneRecoveryDraft({ ...draft, draftId: "window-two", body: "Other window" });
    writeSceneRecoveryDraft({ ...draft, sequence: 2, body: "Newer sequence" });
    clearSceneRecoveryDraft(draft.projectRoot, draft.sceneId, old);
    expect(listSceneRecoveryDrafts(draft.projectRoot, draft.sceneId).map((row) => row.body).sort()).toEqual(["Newer sequence", "Other window"]);
    expect(writeSceneRecoveryDraft({ ...draft, body: "Delayed older write" })).toBeNull();
  });
});
