import { useEditor, type EditorTab } from "../../contexts/EditorContext";

const KIND_ICONS: Record<string, string> = {
  scene: "\u25CB",
  codex: "\u25C6",
  proposal: "\u2728",
  generate: "\u26A1",
  outliner: "\u25A3",
  settings: "\u2699",
};

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditor();

  if (tabs.length === 0) return null;

  function handleMouseDown(e: React.MouseEvent, tab: EditorTab) {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tab.id);
    }
  }

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeTabId ? " tab--active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
          onMouseDown={(e) => handleMouseDown(e, tab)}
        >
          <span className="tab__icon">{KIND_ICONS[tab.kind] ?? "\u25CB"}</span>
          <span className="tab__label">{tab.label}</span>
          {tab.modified && <span className="tab__modified" />}
          <span
            className="tab__close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            \u00D7
          </span>
        </div>
      ))}
    </div>
  );
}
