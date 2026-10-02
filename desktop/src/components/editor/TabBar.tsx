import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useEditor, type EditorTab } from "../../contexts/EditorContext";

const KIND_ICONS: Record<string, string> = {
  scene: "\u25CB",
  codex: "\u25C6",
  proposal: "\u2728",
  generate: "\u26A1",
  outliner: "\u25A3",
  settings: "\u2699",
};

export function editorTabId(prefix: string, id: string) { return `${prefix}-tab-${encodeURIComponent(id)}`; }
export function editorPanelId(prefix: string, id: string) { return `${prefix}-panel-${encodeURIComponent(id)}`; }

export function TabBar({ idPrefix }: { idPrefix: string }) {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditor();
  const bar = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focusedId, setFocusedId] = useState("");
  const focusAfterClose = useRef<{ id: string; area: HTMLElement | null } | null>(null);
  const keyboardId = tabs.some(tab => tab.id === focusedId) ? focusedId : activeTabId;
  useLayoutEffect(() => {
    const pending = focusAfterClose.current;
    if (pending) {
      focusAfterClose.current = null;
      if (pending.id) buttons.current.get(pending.id)?.focus();
      else pending.area?.querySelector<HTMLButtonElement>("[data-editor-empty-action]")?.focus();
    }
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

  function close(tab: EditorTab, restoreFocus: boolean) {
    if (restoreFocus) {
      const remaining = tabs.filter(row => row.id !== tab.id);
      const index = tabs.findIndex(row => row.id === tab.id);
      focusAfterClose.current = { id: remaining[Math.min(index, remaining.length - 1)]?.id || "", area: bar.current?.parentElement || null };
    }
    closeTab(tab.id);
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    buttons.current.get(tabs[next].id)?.focus();
  }

  function handleMouseDown(e: React.MouseEvent, tab: EditorTab) {
    if (e.button === 1) {
      e.preventDefault();
      close(tab, e.currentTarget.contains(document.activeElement));
    }
  }

  return (
    <div ref={bar} className="tab-bar" role="tablist" aria-label="Open documents and workspaces" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId("");
    }}>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeTabId ? " tab--active" : ""}`}
          onMouseDown={(e) => handleMouseDown(e, tab)}
        >
          <button
            type="button"
            role="tab"
            id={editorTabId(idPrefix, tab.id)}
            aria-label={tab.modified ? `${tab.label}, unsaved changes` : tab.label}
            aria-selected={tab.id === activeTabId}
            aria-controls={editorPanelId(idPrefix, tab.id)}
            tabIndex={tab.id === keyboardId ? 0 : -1}
            ref={node => { if (node) buttons.current.set(tab.id, node); else buttons.current.delete(tab.id); }}
            className="tab__select"
            onFocus={() => setFocusedId(tab.id)}
            onKeyDown={event => navigate(event, index)}
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
            tabIndex={tab.id === keyboardId ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              close(tab, e.currentTarget.parentElement?.contains(document.activeElement) || false);
            }}
          >
            {"\u00D7"}
          </button>
        </div>
      ))}
    </div>
  );
}
