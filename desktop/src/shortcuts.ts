export type ShortcutAction =
  | "save_scene"
  | "generate_proposal"
  | "run_continuity_checks"
  | "open_runs_tab";

type ShortcutEventLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

function hasPrimaryModifier(event: ShortcutEventLike): boolean {
  return event.ctrlKey || event.metaKey;
}

export function resolveShortcutAction(
  event: ShortcutEventLike
): ShortcutAction | null {
  if (!hasPrimaryModifier(event) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "s" && !event.shiftKey) return "save_scene";
  if (key === "g" && event.shiftKey) return "generate_proposal";
  if (key === "k" && event.shiftKey) return "run_continuity_checks";
  if (key === "l" && event.shiftKey) return "open_runs_tab";
  return null;
}
