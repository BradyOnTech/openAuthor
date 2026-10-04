// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecoverableDraft } from "./recoverableDraft";

type Draft = { text: string };
const valid = (value: unknown): value is Draft => !!value && typeof (value as Draft).text === "string";
const initial = { text: "Saved" };
const create = () => new RecoverableDraft("draft-test", initial, valid);

describe("recoverable author drafts", () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it("recovers edits after the editor is recreated", () => {
    create().edit({ text: "A newer thought" });
    const reopened = create();
    reopened.acceptSaved(initial);
    expect(reopened.getSnapshot().value.text).toBe("A newer thought");
    expect(reopened.getSnapshot().recovered).toBe(true);
    expect(reopened.getSnapshot().conflict).toBe(false);
  });

  it("requires a choice when the saved version changed", () => {
    const draft = create();
    draft.edit({ text: "My thought" });
    draft.acceptSaved({ text: "An external update" });
    expect(draft.getSnapshot().conflict).toBe(true);
    draft.keepDraft();
    expect(draft.getSnapshot().value.text).toBe("My thought");
    expect(draft.getSnapshot().conflict).toBe(false);
    expect(draft.dirty).toBe(true);
    draft.useSaved();
    expect(draft.getSnapshot().value.text).toBe("An external update");
    expect(draft.dirty).toBe(false);
  });

  it("retains typing that happens during an in-flight save", () => {
    const draft = create();
    const submitted = { text: "First edit" };
    draft.edit(submitted);
    draft.edit({ text: "Second edit" });
    draft.saved(submitted, submitted);
    expect(draft.getSnapshot().value.text).toBe("Second edit");
    expect(draft.dirty).toBe(true);
    expect(create().getSnapshot().value.text).toBe("Second edit");
  });

  it("does not erase a reopened editor's edits when an old save finishes", () => {
    const previous = create();
    const submitted = { text: "Submitted" };
    previous.edit(submitted);
    const reopened = create();
    reopened.edit({ text: "Newer after reopening" });
    previous.saved(submitted, submitted);
    expect(create().getSnapshot().value.text).toBe("Newer after reopening");
  });

  it("does not downgrade an authoritative refresh when a guarded older save completes", () => {
    const draft = create();
    const submitted = { text: "Submitted" };
    const current = { text: "A later saved update" };
    draft.edit(submitted);
    draft.acceptSaved(current);
    const acknowledged = draft.saved(submitted, submitted, initial);
    expect(draft.getSnapshot().latest).toEqual(current);
    expect(draft.getSnapshot().base).toEqual(initial);
    expect(draft.getSnapshot().value).toEqual(submitted);
    expect(acknowledged).toBe(false);
    expect(create().getSnapshot().value).toEqual(submitted);
  });

  it("does not overwrite a newer journal baseline reviewed in a reopened editor", () => {
    const previous = create();
    const submitted = { text: "Submitted" };
    previous.edit(submitted);
    const reopened = create();
    const current = { text: "A later saved update" };
    reopened.acceptSaved(current);
    reopened.keepDraft();
    reopened.edit({ text: "A new correction" });
    expect(previous.saved(submitted, submitted, initial)).toBe(false);
    expect(create().getSnapshot().base).toEqual(current);
    expect(create().getSnapshot().value.text).toBe("A new correction");
  });

  it("amends the newest journal when an asynchronous form action finishes", () => {
    const previous = create();
    previous.edit({ text: "Submitted" });
    const reopened = create();
    reopened.edit({ text: "Newer after reopening" });
    previous.amend(current => current.text === "Submitted" ? initial : current);
    expect(create().getSnapshot().value.text).toBe("Newer after reopening");
    reopened.edit(initial);
    previous.amend(current => current);
    expect(create().getSnapshot().value).toEqual(initial);
  });

  it("keeps in-memory writing and reports unavailable recovery storage", () => {
    const draft = create();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    draft.edit({ text: "Keep this writing" });
    expect(draft.getSnapshot().value.text).toBe("Keep this writing");
    expect(draft.getSnapshot().error).toContain("Recovery storage is full or unavailable");
  });

  it("clears the recovery record only after the submitted text is saved", () => {
    const draft = create();
    const submitted = { text: "My revision" };
    draft.edit(submitted);
    draft.saved(submitted, submitted);
    expect(window.localStorage.getItem("draft-test")).toBeNull();
    expect(draft.dirty).toBe(false);
  });

  it("preserves an unreadable recovery record and its warning while loading", () => {
    window.localStorage.setItem("draft-test", "interrupted recovery record");
    const draft = create();
    draft.acceptSaved(initial);
    expect(draft.getSnapshot().error).toContain("unreadable");
    expect(window.localStorage.getItem("draft-test")).toBe("interrupted recovery record");
  });
});
