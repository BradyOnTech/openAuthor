// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSceneRecoveryDraft,
  readSceneRecoveryDraft,
  recoveryDraftMatchesScene,
  writeSceneRecoveryDraft,
} from "./recoveryJournal";

describe("scene recovery journal", () => {
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

  it("persists and clears an unsaved scene draft by project and scene", () => {
    writeSceneRecoveryDraft({
      projectRoot: "/novels/one",
      sceneId: "scene-0001",
      baseUpdatedAt: "2026-07-15T12:00:00Z",
      title: "Recovered title",
      body: "Recovered body",
    });
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")?.body).toBe("Recovered body");
    expect(readSceneRecoveryDraft("/novels/two", "scene-0001")).toBeNull();
    clearSceneRecoveryDraft("/novels/one", "scene-0001");
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")).toBeNull();
  });

  it("discards corrupt journal data", () => {
    const key = `openauthor.sceneRecovery.v1:${encodeURIComponent("/novels/one")}:${encodeURIComponent("scene-0001")}`;
    window.localStorage.setItem(key, "not-json");
    expect(readSceneRecoveryDraft("/novels/one", "scene-0001")).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
