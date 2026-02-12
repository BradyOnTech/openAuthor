export type ShortcutAction =
  | "save_scene"
  | "generate_proposal"
  | "run_continuity_checks"
  | "open_runs_tab"
  | "toggle_sidebar"
  | "switch_write"
  | "switch_plan"
  | "switch_chat"
  | "switch_review";

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
  if (key === "b" && !event.shiftKey) return "toggle_sidebar";
  if (key === "1" && !event.shiftKey) return "switch_write";
  if (key === "2" && !event.shiftKey) return "switch_plan";
  if (key === "3" && !event.shiftKey) return "switch_chat";
  if (key === "4" && !event.shiftKey) return "switch_review";
  return null;
}
