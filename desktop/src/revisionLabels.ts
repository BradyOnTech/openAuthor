// Author-facing names for the kinds of Revision and the files a Revision holds.

const KIND_LABELS: Record<string, string> = {
  author_edit: "Your edit",
  author_edit_before: "Snapshot before your edit",
  change_set_apply: "Change Set applied",
  change_set_before: "Snapshot before a Change Set",
  change_set_undo: "Change Set undone",
  change_group_apply: "Change Sets applied together",
  change_group_before: "Snapshot before Change Sets",
  change_group_undo: "Change Sets undone together",
  manuscript_import: "Import",
  restore: "Restored version",
  backup: "Backup",
  manual: "Saved version",
};

export function revisionKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

/** True for the automatic snapshot taken before a change so it can be undone. */
export function isSafetySnapshot(kind: string): boolean {
  return /_before$/.test(kind);
}

/** True for files that configure the book rather than hold the author's work. */
export function isBookSettingsFile(path: string): boolean {
  return path.startsWith(".openauthor/");
}

/** What a stored file is, in the author's terms. The path remains its exact identity. */
export function bookFileLabel(path: string, sceneTitle?: string): string {
  if (path.startsWith("manuscript/scenes/")) return sceneTitle || path.slice("manuscript/scenes/".length).replace(/\.md$/, "");
  if (path === "manuscript/structure.json") return "Plan";
  if (path === "codex/codex.json") return "Story Memory";
  if (path === "codex/memory.json") return "Canon, knowledge and arcs";
  if (path === "codex/suggestions.json") return "Story Memory suggestions";
  if (path === ".openauthor/project.json") return "Book identity";
  if (path === ".openauthor/generation_budget_policy.json") return "AI budget limits";
  if (path === ".openauthor/provider_pricing.json") return "AI pricing table";
  return path;
}
