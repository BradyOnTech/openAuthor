// On a Mac the Control key belongs to text editing (Control+F, Control+K,
// Control+B and friends move the caret or delete), so app shortcuts answer to
// Command only. Elsewhere the primary modifier is Control; the Windows key
// never reaches an app, so accepting it there is harmless.

export function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
}

/** True when the platform's primary shortcut modifier is held. */
export function primaryModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey || event.metaKey;
}
