import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useId } from "react";
import { useUI } from "../../contexts/UIContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { getScene, getCodexEntity } from "../../api";
import { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";

type ResultItem = {
  id: string;
  kind: "scene" | "codex" | "command";
  label: string;
  detail?: string;
  shortcut?: string;
};

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUI();

  if (!commandPaletteOpen) return null;

  return <CommandPaletteInner onClose={() => setCommandPaletteOpen(false)} />;
}

function CommandPaletteInner({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const listId = useId();
  const optionId = (id: string) => `${listId}-${encodeURIComponent(id)}`;
  const restoreOnClose = useRef(true);
  const [opener] = useState(() => {
    const element = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selection = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection }
      : null;
    return { element, selection };
  });
  const {
    toggleSidebar, toggleSecondarySidebar, togglePanel,
    toggleZenMode, toggleTheme,
    setSecondaryTab, setSecondarySidebarOpen,
  } = useUI();
  const { projectRoot, scenes, codexEntities, setError } = useWorkspace();
  const { openTab, tabs, setActiveTab, beginNavigation } = useEditor();
  const navigateTo = useWorkspaceNavigation();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    inputRef.current?.focus();
    return () => {
      if (!restoreOnClose.current || !opener.element?.isConnected) return;
      if (document.activeElement !== document.body && !dialog?.contains(document.activeElement)) return;
      opener.element.focus({ preventScroll: true });
      if (opener.selection && opener.selection.start !== null && opener.selection.end !== null
        && (opener.element instanceof HTMLTextAreaElement || opener.element instanceof HTMLInputElement)) {
        opener.element.setSelectionRange(opener.selection.start, opener.selection.end, opener.selection.direction || "none");
      }
    };
  }, [opener]);

  const commands: ResultItem[] = useMemo(() => [
    { id: "cmd:zen", kind: "command", label: "Toggle Zen Mode", shortcut: "Cmd+Shift+Z" },
    { id: "cmd:theme", kind: "command", label: "Toggle Theme", shortcut: "Cmd+Shift+T" },
    { id: "cmd:sidebar", kind: "command", label: "Toggle Sidebar", shortcut: "Cmd+B" },
    { id: "cmd:secondary", kind: "command", label: "Toggle AI Chat", shortcut: "Cmd+Shift+B" },
    { id: "cmd:panel", kind: "command", label: "Toggle Panel", shortcut: "Cmd+J" },
    { id: "cmd:manuscript", kind: "command", label: "Focus Manuscript", shortcut: "Cmd+Shift+E" },
    { id: "cmd:plan", kind: "command", label: "Focus Plan", shortcut: "Cmd+Shift+P" },
    { id: "cmd:codex", kind: "command", label: "Focus Story Memory", shortcut: "Cmd+Shift+X" },
    { id: "cmd:storylines", kind: "command", label: "Focus Storylines", shortcut: "Cmd+Shift+L" },
    { id: "cmd:search", kind: "command", label: "Focus Search", shortcut: "Cmd+Shift+F" },
    { id: "cmd:proposals", kind: "command", label: "Focus Changes", shortcut: "Cmd+Shift+R" },
    { id: "cmd:checks", kind: "command", label: "Focus Checks", shortcut: "Cmd+Shift+C" },
    { id: "cmd:settings", kind: "command", label: "Open Settings", shortcut: "Cmd+," },
    { id: "cmd:chat", kind: "command", label: "Focus Chat", shortcut: "Cmd+L" },
    { id: "cmd:inspector", kind: "command", label: "Open Inspector" },
  ], []);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    const items: ResultItem[] = [];

    if (!q) {
      return [
        ...scenes.slice(0, 5).map((s): ResultItem => ({
          id: `scene:${s.id}`,
          kind: "scene",
          label: s.title || s.id,
          detail: `${s.status} \u2014 ${s.pov || "no POV"}`,
        })),
        ...commands.slice(0, 5),
      ];
    }

    const isCommandMode = q.startsWith(">");
    const isSceneMode = q.startsWith("#");
    const isCodexMode = q.startsWith("@");
    const searchQ = q.replace(/^[>#@]/, "").trim();

    if (!isCommandMode && !isCodexMode) {
      for (const s of scenes) {
        if (
          s.title.toLowerCase().includes(searchQ) ||
          s.id.toLowerCase().includes(searchQ)
        ) {
          items.push({
            id: `scene:${s.id}`,
            kind: "scene",
            label: s.title || s.id,
            detail: `${s.status} \u2014 ${s.pov || "no POV"}`,
          });
        }
        if (items.length >= 10) break;
      }
    }

    if (!isCommandMode && !isSceneMode) {
      for (const e of codexEntities) {
        if (
          e.name.toLowerCase().includes(searchQ) ||
          e.type.toLowerCase().includes(searchQ)
        ) {
          items.push({
            id: `codex:${e.id}`,
            kind: "codex",
            label: e.name,
            detail: e.type,
          });
        }
        if (items.length >= 15) break;
      }
    }

    if (!isSceneMode && !isCodexMode) {
      for (const c of commands) {
        if (c.label.toLowerCase().includes(searchQ)) {
          items.push(c);
        }
      }
    }

    return items.slice(0, 20);
  }, [query, scenes, codexEntities, commands]);

  const selectedIndex = results.length ? Math.min(focusIndex, results.length - 1) : -1;
  const selectedResult = results[selectedIndex];
  useEffect(() => {
    if (selectedResult) optionRefs.current.get(selectedResult.id)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedResult]);

  const executeCommand = useCallback((id: string) => {
    switch (id) {
      case "cmd:zen": toggleZenMode(); break;
      case "cmd:theme": toggleTheme(); break;
      case "cmd:sidebar": toggleSidebar(); break;
      case "cmd:secondary": toggleSecondarySidebar(); break;
      case "cmd:panel": togglePanel(); break;
      case "cmd:manuscript": void navigateTo("manuscript"); break;
      case "cmd:plan": void navigateTo("plan"); break;
      case "cmd:codex": void navigateTo("codex"); break;
      case "cmd:storylines": void navigateTo("storylines"); break;
      case "cmd:search": void navigateTo("search"); break;
      case "cmd:proposals": void navigateTo("proposals"); break;
      case "cmd:checks": void navigateTo("checks"); break;
      case "cmd:settings": void navigateTo("settings"); break;
      case "cmd:chat": setSecondaryTab("chat"); setSecondarySidebarOpen(true); break;
      case "cmd:inspector": setSecondaryTab("inspector"); setSecondarySidebarOpen(true); break;
    }
  }, [toggleZenMode, toggleTheme, toggleSidebar, toggleSecondarySidebar, togglePanel, navigateTo, setSecondaryTab, setSecondarySidebarOpen]);

  const handleSelect = useCallback(async (item: ResultItem) => {
    // Dismissal returns to writing; activation lets the chosen destination own
    // focus instead of replaying the old document's selection after navigation.
    restoreOnClose.current = false;
    onClose();
    if (item.kind === "command") {
      executeCommand(item.id);
      return;
    }
    if (tabs.some(tab => tab.id === item.id)) {
      setActiveTab(item.id);
      return;
    }
    const isCurrent = beginNavigation();
    if (item.kind === "scene") {
      const sceneId = item.id.replace("scene:", "");
      try {
        const scene = await getScene(projectRoot, sceneId);
        if (isCurrent()) openTab({ id: item.id, kind: "scene", label: scene.title, data: scene });
      } catch (e) {
        if (isCurrent()) setError(`Failed to open scene: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (item.kind === "codex") {
      const entityId = item.id.replace("codex:", "");
      try {
        const entity = await getCodexEntity(projectRoot, entityId);
        if (isCurrent()) openTab({ id: item.id, kind: "codex", label: entity.name, data: entity });
      } catch (e) {
        if (isCurrent()) setError(`Failed to open entity: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }, [onClose, executeCommand, projectRoot, openTab, tabs, setActiveTab, beginNavigation, setError]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      inputRef.current?.focus();
    } else if (e.altKey || e.ctrlKey || e.metaKey) {
      return;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) setFocusIndex(Math.min(selectedIndex + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setFocusIndex(Math.max(selectedIndex - 1, 0));
    } else if (e.key === "Enter" && selectedResult) {
      e.preventDefault();
      void handleSelect(selectedResult);
    }
  }

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Command Palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-palette__input-wrap">
          <span className="command-palette__icon" aria-hidden="true">{"\u2315"}</span>
          <input
            ref={inputRef}
            className="command-palette__input"
            role="combobox"
            aria-label="Search scenes, entities, commands"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={selectedResult ? optionId(selectedResult.id) : undefined}
            placeholder="Search scenes, entities, commands..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusIndex(0); }}
          />
        </div>
        <div id={listId} className="command-palette__results" role="listbox" aria-label="Search results">
          {results.map((item, i) => (
            <div
              key={item.id}
              id={optionId(item.id)}
              role="option"
              aria-label={item.label}
              aria-describedby={item.detail ? `${optionId(item.id)}-detail` : undefined}
              aria-selected={i === selectedIndex}
              ref={node => { if (node) optionRefs.current.set(item.id, node); else optionRefs.current.delete(item.id); }}
              className={`command-palette__result${i === selectedIndex ? " command-palette__result--focused" : ""}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => void handleSelect(item)}
              onMouseEnter={() => setFocusIndex(i)}
            >
              <span className="command-palette__result-icon" aria-hidden="true">
                {item.kind === "scene" ? "\u25CB" : item.kind === "codex" ? "\u25C6" : "\u25B8"}
              </span>
              <span className="command-palette__result-label">{item.label}</span>
              {item.detail && (
                <span id={`${optionId(item.id)}-detail`} className="command-palette__result-category">{item.detail}</span>
              )}
              {item.shortcut && (
                <span className="command-palette__result-shortcut">{item.shortcut}</span>
              )}
            </div>
          ))}
        </div>
        {results.length === 0 && query.trim() && (
          <div role="status" style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--text-ghost)", fontSize: "var(--text-sm)" }}>
            No results
          </div>
        )}
      </div>
    </div>
  );
}
