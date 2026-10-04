import { useUI } from "../../contexts/UIContext";
import { useRef, type KeyboardEvent } from "react";
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
  const controls = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
      : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
        : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    controls.current[next]?.focus();
  }

  if (!panelOpen) return null;

  return (
    <div className="panel-area">
      <div className="panel-area__tabs" role="tablist" aria-label="Project tools">
        {TABS.map((t, index) => (
          <button
            type="button"
            role="tab"
            id={`project-tool-${t.id}`}
            aria-controls={`project-tool-panel-${t.id}`}
            aria-selected={panelTab === t.id}
            tabIndex={panelTab === t.id ? 0 : -1}
            ref={element => { controls.current[index] = element; }}
            key={t.id}
            className={`panel-area__tab${panelTab === t.id ? " panel-area__tab--active" : ""}`}
            onClick={() => setPanelTab(t.id)}
            onKeyDown={event => moveFocus(event, index)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-area__content" role="tabpanel" id={`project-tool-panel-${panelTab}`} aria-labelledby={`project-tool-${panelTab}`}>
        {panelTab === "runs" && <RunsPanel />}
        {panelTab === "merge" && <MergePanel />}
        {panelTab === "budget" && <BudgetPanel />}
        {panelTab === "mobile" && <MobileInboxPanel />}
      </div>
    </div>
  );
}
