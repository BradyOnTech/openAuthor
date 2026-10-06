import type { SceneWritingBrief } from "../../types";
import { briefTextFields, creativeFreedomLabels } from "../../writingBrief";

export function WritingBriefFields({ value, onChange, inherited = false, saved = false }: {
  value: SceneWritingBrief; onChange: (value: SceneWritingBrief) => void; inherited?: boolean; saved?: boolean;
}) {
  const field = ({ key, label, placeholder }: typeof briefTextFields[number]) => <label key={key} style={{ display: "grid", gap: 6 }}>{saved ? `Saved ${label[0].toLowerCase()}${label.slice(1)}` : label}
    <textarea className="input" rows={2} maxLength={1200} value={value[key] ?? ""}
      onChange={event => onChange({ ...value, [key]: event.target.value })} placeholder={placeholder} />
  </label>;
  return <div style={{ display: "grid", gap: 12 }}>
    <label style={{ display: "grid", gap: 6 }}>{saved ? "Saved creative freedom" : "Creative freedom"}
      <select className="input" value={value.change_permission ?? ""} onChange={event => {
        const next = { ...value };
        if (event.target.value) next.change_permission = event.target.value as SceneWritingBrief["change_permission"];
        else delete next.change_permission;
        onChange(next);
      }}>
        <option value="">{inherited ? "Use saved brief or scene default" : "Scene default: preserve existing story; local details for a new scene"}</option>
        {Object.entries(creativeFreedomLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <p style={{ margin: 0 }}>Local details cannot introduce promises, consequential actions, history or revelations. Story changes require a specific description below. Protected details still apply.</p>
    {briefTextFields.slice(0, 3).map(field)}
    <details open={value.change_permission === "story" || undefined}>
      <summary>Character knowledge, voice and invention limits</summary>
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>{briefTextFields.slice(3).map(field)}</div>
    </details>
    {inherited && <small>Blank fields use the saved scene brief. To remove saved direction, edit the saved brief above.</small>}
  </div>;
}
