import type { WritingVoice } from "../src/core/writingVoice";

export const writingVoice: WritingVoice = {
  name: "Winter restraint", description: "Let physical choices carry emotion.",
  traits: { prose: "direct", description: "spare", emotion: "restrained", distance: "close",
    dialogue: "subtextual", pacing: "varied", imagery: "concrete", humor: "dry" },
  guidance: ["Keep action spatially clear."], avoid: ["Melodrama."],
};
