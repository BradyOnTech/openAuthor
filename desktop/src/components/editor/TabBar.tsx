import { useLayoutEffect, useRef } from "react";
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
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const reveal = () => element.querySelector(".tab--active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    reveal();
    if (typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(reveal);
    resize.observe(element);
    return () => resize.disconnect();
  }, [activeTabId, tabs.length]);

  if (tabs.length === 0) return null;

  function handleMouseDown(e: React.MouseEvent, tab: EditorTab) {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tab.id);
    }
  }

  return (
    <div ref={bar} className="tab-bar" role="tablist" aria-label="Open documents and workspaces">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeTabId ? " tab--active" : ""}`}
          onMouseDown={(e) => handleMouseDown(e, tab)}
        >
          <button
            type="button"
            role="tab"
            aria-label={tab.modified ? `${tab.label}, unsaved changes` : tab.label}
            aria-selected={tab.id === activeTabId}
            className="tab__select"
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab__icon" aria-hidden="true">{KIND_ICONS[tab.kind] ?? "\u25CB"}</span>
            <span className="tab__label">{tab.label}</span>
            {tab.modified && <span className="tab__modified" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="tab__close"
            aria-label={`Close ${tab.label}`}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            {"\u00D7"}
          </button>
        </div>
      ))}
    </div>
  );
}
