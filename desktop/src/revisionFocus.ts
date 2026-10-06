import type { DraftRevisionFocus } from "./types";

export const draftRevisionFocusOptions: Array<{ value: DraftRevisionFocus; label: string }> = [
  { value: "", label: "General" },
  { value: "dialogue", label: "Dialogue" },
  { value: "motivation", label: "Character motivation" },
  { value: "pov", label: "Viewpoint and knowledge" },
  { value: "pacing", label: "Pacing" },
  { value: "setup-payoff", label: "Setup and payoff" },
  { value: "prose clarity", label: "Prose clarity" },
];

export function draftRevisionFocusLabel(focus?: DraftRevisionFocus): string {
  return draftRevisionFocusOptions.find(option => option.value === focus)?.label ?? "General";
}
