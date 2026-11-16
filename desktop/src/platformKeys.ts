// On a Mac the Control key belongs to text editing (Control+F, Control+N and
// friends move the caret), so shortcuts added on those letters must answer to
// Command only. Elsewhere the primary modifier is Control.

export function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
}

/** True when the platform's primary shortcut modifier, and only it, is held. */
export function primaryModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
