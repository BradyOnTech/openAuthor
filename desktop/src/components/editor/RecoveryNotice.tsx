import type { RetainedRecord } from "../../workspaceRetention";

export function RecoveryNotice<T>({ draft, label }: { label: string; draft: {
  warning: string; restored: boolean; alternatives: RetainedRecord<T>[];
  restore: (row: RetainedRecord<T>) => void; discard: () => void;
} }) {
  return <div>
    {draft.warning && <p role="alert">{draft.warning}</p>}
    {draft.restored && <p role="status">Recovered local {label}. Nothing was saved to your book automatically.</p>}
    {draft.alternatives.map((row) => <button className="btn btn--sm" key={row.owner} onClick={() => draft.restore(row)}>Recover other {label} · {new Date(row.at).toLocaleString()}</button>)}
    <button className="btn btn--sm" onClick={() => { if (window.confirm(`Discard the current local ${label}? Other recovered copies and saved book content will be kept.`)) draft.discard(); }}>Discard local {label}…</button>
  </div>;
}
