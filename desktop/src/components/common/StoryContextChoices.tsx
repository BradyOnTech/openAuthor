import type { StoryContextChoice } from "../../api";

type Props = {
  choices: StoryContextChoice[];
  selected: string[];
  disabled: boolean;
  reviewed: boolean;
  onChange: (ids: string[]) => void;
};

export function StoryContextChoices({ choices, selected, disabled, reviewed, onChange }: Props) {
  return <fieldset className="story-context-choices" disabled={disabled}>
    <legend>Canon and relationships</legend>
    <p>Choose records for this request only. Nothing is shared by default. Approved facts include their evidence quotes, which may come from other scenes. Private notes are never included.</p>
    {!choices.length && <p>No Canon Facts or relationships saved yet.</p>}
    <div className="story-context-choices__list">
      {choices.map(choice => {
        const kind = choice.kind === "fact" ? "Canon fact" : "Relationship";
        const checked = selected.includes(choice.id);
        const status = !choice.eligible ? choice.reason : !reviewed ? "Review context to confirm what will be sent."
          : choice.included ? "Included in the reviewed payload." : choice.approved ? choice.reason : "Not shared.";
        return <div key={choice.id} className="story-context-choices__entry">
          <label><input type="checkbox" aria-label={`Allow ${kind}: ${choice.label} for this request`} disabled={!choice.eligible && !checked} checked={checked}
            onChange={event => onChange(event.target.checked ? [...selected, choice.id] : selected.filter(id => id !== choice.id))} />
            <span>{kind}: {choice.label}</span>
          </label>
          <p>{status}</p>
        </div>;
      })}
    </div>
  </fieldset>;
}
