import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useUI } from "../../contexts/UIContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { getScene, getCodexEntity } from "../../api";

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
  const {
    toggleSidebar, toggleSecondarySidebar, togglePanel,
    toggleZenMode, toggleTheme,
    setActiveView, setSidebarOpen,
    setSecondaryTab, setSecondarySidebarOpen,
  } = useUI();
  const { projectRoot, scenes, codexEntities, setError } = useWorkspace();
  const { openTab } = useEditor();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands: ResultItem[] = useMemo(() => [
    { id: "cmd:zen", kind: "command", label: "Toggle Zen Mode", shortcut: "Cmd+Shift+Z" },
    { id: "cmd:theme", kind: "command", label: "Toggle Theme", shortcut: "Cmd+Shift+T" },
    { id: "cmd:sidebar", kind: "command", label: "Toggle Sidebar", shortcut: "Cmd+B" },
    { id: "cmd:secondary", kind: "command", label: "Toggle AI Chat", shortcut: "Cmd+Shift+B" },
    { id: "cmd:panel", kind: "command", label: "Toggle Panel", shortcut: "Cmd+J" },
    { id: "cmd:manuscript", kind: "command", label: "Focus Manuscript", shortcut: "Cmd+Shift+E" },
    { id: "cmd:codex", kind: "command", label: "Focus Codex", shortcut: "Cmd+Shift+X" },
    { id: "cmd:search", kind: "command", label: "Focus Search", shortcut: "Cmd+Shift+F" },
    { id: "cmd:proposals", kind: "command", label: "Focus Proposals", shortcut: "Cmd+Shift+R" },
    { id: "cmd:checks", kind: "command", label: "Focus Checks", shortcut: "Cmd+Shift+C" },
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

  useEffect(() => {
    setFocusIndex(0);
  }, [query]);

  const executeCommand = useCallback((id: string) => {
    switch (id) {
      case "cmd:zen": toggleZenMode(); break;
      case "cmd:theme": toggleTheme(); break;
      case "cmd:sidebar": toggleSidebar(); break;
      case "cmd:secondary": toggleSecondarySidebar(); break;
      case "cmd:panel": togglePanel(); break;
      case "cmd:manuscript": setActiveView("manuscript"); setSidebarOpen(true); break;
      case "cmd:codex": setActiveView("codex"); setSidebarOpen(true); break;
      case "cmd:search": setActiveView("search"); setSidebarOpen(true); break;
      case "cmd:proposals": setActiveView("proposals"); setSidebarOpen(true); break;
      case "cmd:checks": setActiveView("checks"); setSidebarOpen(true); break;
      case "cmd:chat": setSecondaryTab("chat"); setSecondarySidebarOpen(true); break;
      case "cmd:inspector": setSecondaryTab("inspector"); setSecondarySidebarOpen(true); break;
    }
  }, [toggleZenMode, toggleTheme, toggleSidebar, toggleSecondarySidebar, togglePanel, setActiveView, setSidebarOpen, setSecondaryTab, setSecondarySidebarOpen]);

  const handleSelect = useCallback(async (item: ResultItem) => {
    onClose();
    if (item.kind === "command") {
      executeCommand(item.id);
    } else if (item.kind === "scene") {
      const sceneId = item.id.replace("scene:", "");
      try {
        const scene = await getScene(projectRoot, sceneId);
        openTab({ id: item.id, kind: "scene", label: item.label, data: scene });
      } catch (e) {
        setError(`Failed to open scene: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (item.kind === "codex") {
      const entityId = item.id.replace("codex:", "");
      try {
        const entity = await getCodexEntity(projectRoot, entityId);
        openTab({ id: item.id, kind: "codex", label: item.label, data: entity });
      } catch (e) {
        setError(`Failed to open entity: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }, [onClose, executeCommand, projectRoot, openTab, setError]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[focusIndex]) {
      e.preventDefault();
      handleSelect(results[focusIndex]);
    }
  }

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-palette__input-wrap">
          <span className="command-palette__icon">{"\u2315"}</span>
          <input
            ref={inputRef}
            className="command-palette__input"
            placeholder="Search scenes, entities, commands..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="command-palette__results">
          {results.map((item, i) => (
            <div
              key={item.id}
              className={`command-palette__result${i === focusIndex ? " command-palette__result--focused" : ""}`}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setFocusIndex(i)}
            >
              <span className="command-palette__result-icon">
                {item.kind === "scene" ? "\u25CB" : item.kind === "codex" ? "\u25C6" : "\u25B8"}
              </span>
              <span className="command-palette__result-label">{item.label}</span>
              {item.detail && (
                <span className="command-palette__result-category">{item.detail}</span>
              )}
              {item.shortcut && (
                <span className="command-palette__result-shortcut">{item.shortcut}</span>
              )}
            </div>
          ))}
          {results.length === 0 && query.trim() && (
            <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--text-ghost)", fontSize: "var(--text-sm)" }}>
              No results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
