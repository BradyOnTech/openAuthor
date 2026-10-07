import type { SceneWritingBrief } from "../../types";
import { briefTextFields, creativeFreedomLabels } from "../../writingBrief";

export function WritingBriefDirection({ value, permission }: { value: SceneWritingBrief; permission?: SceneWritingBrief["change_permission"] }) {
  const mode = permission ?? value.change_permission;
  return <div style={{ display: "grid", gap: 10 }}>
    {mode && <strong>Creative freedom: {creativeFreedomLabels[mode]}</strong>}
    {briefTextFields.map(({ key, label }) => value[key] && <div key={key}>
      <strong>{label}</strong><p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{value[key]}</p>
    </div>)}
    {value.word_range && <p>Word target: {value.word_range.join("–")}</p>}
  </div>;
}
