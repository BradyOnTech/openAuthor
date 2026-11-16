// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasOverlayTitleBar, reserveTitleBar } from "../../nativeWindow";
import { TitleBar } from "./TitleBar";

const workspace = vi.hoisted(() => ({
  current: { activeProjectId: "book-1", projects: [{ id: "book-1", name: "The Tide Clock" }], projectRoot: "/books/tide-clock", projectFound: true as boolean | null },
}));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspace: () => workspace.current }));

type NativeWindow = Window & { __TAURI_INTERNALS__?: unknown };

function runAs(platform: string, native: boolean) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  if (native) (window as NativeWindow).__TAURI_INTERNALS__ = {};
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as NativeWindow).__TAURI_INTERNALS__;
  delete document.documentElement.dataset.titlebar;
  workspace.current = { ...workspace.current, projectFound: true };
});

describe("the Mac window's title bar", () => {
  it("is drawn by the page only in the Mac desktop app", () => {
    runAs("MacIntel", false);
    expect(hasOverlayTitleBar()).toBe(false);
    runAs("Win32", true);
    expect(hasOverlayTitleBar()).toBe(false);
    reserveTitleBar();
    expect(document.documentElement.dataset.titlebar).toBeUndefined();
    expect(render(<TitleBar />).container.querySelector(".titlebar")).toBeNull();
  });

  it("reserves its strip before the app renders", () => {
    runAs("MacIntel", true);
    reserveTitleBar();
    expect(document.documentElement.dataset.titlebar).toBe("overlay");
  });

  it("names the open book on a strip that moves the window", () => {
    runAs("MacIntel", true);
    const strip = render(<TitleBar />).container.querySelector(".titlebar");
    expect(strip?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(strip?.textContent).toBe("The Tide Clock");
    expect(strip?.classList.contains("titlebar--plain")).toBe(false);
  });

  it("stays as a plain handle when no book is open", () => {
    runAs("MacIntel", true);
    workspace.current = { ...workspace.current, projectFound: false };
    const strip = render(<TitleBar />).container.querySelector(".titlebar");
    expect(strip?.textContent).toBe("");
    expect(strip?.classList.contains("titlebar--plain")).toBe(true);
  });

  it("dims while another app is in front and recovers on return", () => {
    runAs("MacIntel", true);
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const view = render(<TitleBar />);
    expect(document.documentElement.hasAttribute("data-window-inactive")).toBe(true);
    focused.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(document.documentElement.hasAttribute("data-window-inactive")).toBe(false);
    focused.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    expect(document.documentElement.hasAttribute("data-window-inactive")).toBe(true);
    view.unmount();
    expect(document.documentElement.hasAttribute("data-window-inactive")).toBe(false);
  });
});
