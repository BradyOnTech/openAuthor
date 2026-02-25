import { useUI } from "../../contexts/UIContext";
import { RunsPanel } from "./RunsPanel";

const TABS = [
  { id: "runs" as const, label: "Runs" },
  { id: "merge" as const, label: "Merge" },
  { id: "budget" as const, label: "Budget" },
];

export function PanelArea() {
  const { panelOpen, panelTab, setPanelTab } = useUI();

  if (!panelOpen) return null;

  return (
    <div className="panel-area">
      <div className="panel-area__tabs">
        {TABS.map((t) => (
          <div
            key={t.id}
            className={`panel-area__tab${panelTab === t.id ? " panel-area__tab--active" : ""}`}
            onClick={() => setPanelTab(t.id)}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="panel-area__content">
        {panelTab === "runs" && <RunsPanel />}
        {panelTab === "merge" && <MergePlaceholder />}
        {panelTab === "budget" && <BudgetPlaceholder />}
      </div>
    </div>
  );
}

function MergePlaceholder() {
  return (
    <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
      Merge operations will be ported in Phase 4.
    </div>
  );
}

function BudgetPlaceholder() {
  return (
    <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
      Budget management will be ported in Phase 4.
    </div>
  );
}
