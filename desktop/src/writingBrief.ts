import type { SceneWritingBrief } from "./types";

export const briefTextFields = [
  { key: "purpose", label: "Scene purpose", placeholder: "What this scene contributes to the book" },
  { key: "turn", label: "What changes", placeholder: "The choice, realization or change in the relationship" },
  { key: "ending", label: "Where it stops", placeholder: "The ending beat and what remains unresolved" },
  { key: "character_goals", label: "Character goals and tactics", placeholder: "What each person wants here, conceals, and will or will not do" },
  { key: "knowledge", label: "What characters know now", placeholder: "What each character knows or suspects at this point in the story" },
  { key: "reveal_limits", label: "Keep unrevealed", placeholder: "Secrets, conclusions and discoveries this scene must not reveal" },
  { key: "voice_direction", label: "Voice direction for this scene", placeholder: "Specific rhythm, perception or speech choices; use Writing Voice for book-wide examples" },
  { key: "allowed_changes", label: "Allowed inventions or story changes", placeholder: "Describe the specific freedom you give the writer" },
] as const;

export const creativeFreedomLabels = {
  preserve: "Revise expression; preserve story decisions",
  details: "Allow local sensory and staging details",
  story: "Allow the story changes I describe",
};

export function validSceneWritingBrief(value: unknown): value is SceneWritingBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const brief = value as SceneWritingBrief;
  return briefTextFields.every(({ key }) => brief[key] === undefined || typeof brief[key] === "string")
    && (brief.change_permission === undefined || ["preserve", "details", "story"].includes(brief.change_permission))
    && (brief.editable_scope === undefined || brief.editable_scope === "quoted_text")
    && (brief.word_range === undefined || Array.isArray(brief.word_range) && brief.word_range.length === 2
      && brief.word_range.every(value => Number.isInteger(value)));
}
