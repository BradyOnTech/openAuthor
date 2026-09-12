import { useUI } from "../../contexts/UIContext";
import { BudgetPanel } from "./BudgetPanel";
import { MergePanel } from "./MergePanel";
import { MobileInboxPanel } from "./MobileInboxPanel";
import { RunsPanel } from "./RunsPanel";

const TABS = [
  { id: "runs" as const, label: "Runs" },
  { id: "merge" as const, label: "Merge" },
  { id: "budget" as const, label: "Budget" },
  { id: "mobile" as const, label: "Mobile" },
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
        {panelTab === "merge" && <MergePanel />}
        {panelTab === "budget" && <BudgetPanel />}
        {panelTab === "mobile" && <MobileInboxPanel />}
      </div>
    </div>
  );
}
