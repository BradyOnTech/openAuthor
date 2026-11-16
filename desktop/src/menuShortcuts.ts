// The native menu bar sends the shortcut behind the chosen item. Replaying it
// as a key press keeps one implementation of every action: the key handlers.

import { isApplePlatform } from "./platformKeys";

// The native shell dispatches this DOM event on the window when a menu item is
// chosen. No Tauri event module is involved, so the menu adds nothing to load.
export const MENU_DOM_EVENT = "openauthor-menu";

export type MenuShortcut = { key: string; shift: boolean };

export function isMenuShortcut(value: unknown): value is MenuShortcut {
  if (!value || typeof value !== "object") return false;
  const row = value as MenuShortcut;
  return typeof row.key === "string" && row.key.length === 1 && typeof row.shift === "boolean";
}

/** Send the primary modifier plus the shortcut's key to whatever has focus. */
export function replayMenuShortcut(shortcut: MenuShortcut): void {
  const focused = document.activeElement;
  const target: EventTarget = focused instanceof HTMLElement && focused.isConnected ? focused : window;
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key: shortcut.shift ? shortcut.key.toUpperCase() : shortcut.key,
    metaKey: isApplePlatform(),
    ctrlKey: !isApplePlatform(),
    shiftKey: shortcut.shift,
    bubbles: true,
    cancelable: true,
  }));
}

/** Start replaying native menu choices. Returns a function that stops it. */
export function listenForMenuShortcuts(): () => void {
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (isMenuShortcut(detail)) replayMenuShortcut(detail);
  };
  window.addEventListener(MENU_DOM_EVENT, receive);
  return () => window.removeEventListener(MENU_DOM_EVENT, receive);
}
