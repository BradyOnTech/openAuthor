/** The small approved-profile projection, not desktop analysis or draft storage. */
export type WritingVoice = {
  name: string;
  description: string;
  traits: Record<string, string>;
  guidance: string[];
  avoid: string[];
};

const traits: Record<string, readonly string[]> = {
  prose: ["direct", "balanced", "lyrical"],
  description: ["spare", "balanced", "lush"],
  emotion: ["restrained", "balanced", "intense"],
  distance: ["close", "balanced", "distant"],
  dialogue: ["plain", "balanced", "subtextual"],
  pacing: ["deliberate", "varied", "propulsive"],
  imagery: ["concrete", "balanced", "figurative"],
  humor: ["earnest", "dry", "playful"],
};

function invalid(): never {
  throw new Error("This snapshot's Writing Voice is invalid. Publish a fresh snapshot from desktop.");
}

export function readWritingVoice(value: unknown): WritingVoice | null {
  // Snapshots published before this field existed stay usable without a profile.
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  const text = (value: unknown, limit: number): string => {
    if (typeof value !== "string" || [...value].length > limit) return invalid();
    return value;
  };
  const lines = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length > 16) return invalid();
    return value.map((line) => text(line, 400));
  };
  if (!row.traits || typeof row.traits !== "object" || Array.isArray(row.traits)) return invalid();
  const source = row.traits as Record<string, unknown>;
  if (Object.keys(source).some((key) => !Object.hasOwn(traits, key))) return invalid();
  const selected: Record<string, string> = {};
  for (const [key, options] of Object.entries(traits)) {
    const choice = source[key];
    if (typeof choice !== "string" || !options.includes(choice)) return invalid();
    selected[key] = choice;
  }
  const name = text(row.name, 100);
  if (!name.trim()) return invalid();
  // Reconstruct the allowlisted fields so older or over-inclusive snapshots
  // cannot pass exemplar quotations, observations or private draft fields to AI.
  return { name, description: text(row.description, 2400), traits: selected,
    guidance: lines(row.guidance), avoid: lines(row.avoid) };
}

export const WRITING_VOICE_PURPOSE = "Approved craft preferences for original manuscript prose only, not the assistant's conversational personality. Preserve facts, POV, tense and character knowledge. These preferences do not authorize plot changes, imitation of a living author, or changes to the saved profile. All proposed manuscript changes still require desktop review.";
