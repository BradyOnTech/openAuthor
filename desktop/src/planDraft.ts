import type { ManuscriptPlan } from "./types";

export type PlanDraft = {
  brief: ManuscriptPlan["brief"] | null;
  baseline: ManuscriptPlan["brief"] | null;
  newAct: string;
  chapters: Record<string, string>;
  beats: Record<string, string>;
};
export const emptyPlanDraft: PlanDraft = { brief: null, baseline: null, newAct: "", chapters: {}, beats: {} };
export function nonemptyDrafts(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
}
export function acknowledgePlanEntry(draft: PlanDraft, field: "chapters" | "beats", id: string, submitted: string): PlanDraft {
  if (draft[field][id] !== submitted) return draft;
  const remaining = { ...draft[field] };
  delete remaining[id];
  return { ...draft, [field]: remaining };
}
export function isBrief(value: unknown): value is ManuscriptPlan["brief"] {
  if (!value || typeof value !== "object") return false;
  const row = value as ManuscriptPlan["brief"];
  return [row.synopsis, row.genre, row.style_guide, row.outline].every((item) => typeof item === "string")
    && Array.isArray(row.themes) && row.themes.every((item) => typeof item === "string");
}
export function isPlanDraft(value: unknown): value is PlanDraft {
  if (!value || typeof value !== "object") return false;
  const row = value as PlanDraft;
  const strings = (item: unknown) => !!item && typeof item === "object" && !Array.isArray(item) && Object.values(item).every((v) => typeof v === "string");
  return ((row.brief === null && row.baseline === null) || (isBrief(row.brief) && isBrief(row.baseline)))
    && typeof row.newAct === "string" && strings(row.chapters) && strings(row.beats);
}
