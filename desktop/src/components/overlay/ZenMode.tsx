import { useState, useEffect, useRef, useCallback } from "react";
import { useUI } from "../../contexts/UIContext";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { updateScene } from "../../api";
import type { SceneDetail } from "../../types";

export function ZenMode() {
  const { zenMode, toggleZenMode } = useUI();
  const { tabs, activeTabId, updateTab } = useEditor();
  const { projectRoot, refreshScenes, setError } = useWorkspace();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const scene = activeTab?.kind === "scene" ? (activeTab.data as SceneDetail | undefined) : undefined;

  if (!zenMode || !scene) return null;

  return <ZenEditor scene={scene} onExit={toggleZenMode} />;
}

function ZenEditor({
  scene,
  onExit,
}: {
  scene: SceneDetail;
  onExit: () => void;
}) {
  const { projectRoot, refreshScenes, setError } = useWorkspace();
  const { activeTabId, updateTab } = useEditor();

  const [title, setTitle] = useState(scene.title);
  const [body, setBody] = useState(scene.body);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ title: scene.title, body: scene.body });

  const isDirty = title !== lastSavedRef.current.title || body !== lastSavedRef.current.body;
  const wordCount = body.split(/\s+/).filter(Boolean).length;

  const save = useCallback(async () => {
    if (!isDirty) return;
    try {
      const updated = await updateScene(projectRoot, scene.id, {
        title,
        summary: scene.summary,
        pov: scene.pov,
        status: scene.status,
        body,
      });
      lastSavedRef.current = { title: updated.title, body: updated.body };
      updateTab(activeTabId, { modified: false, data: updated, label: updated.title || scene.id });
      await refreshScenes();
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [isDirty, projectRoot, scene, title, body, activeTabId, updateTab, refreshScenes, setError]);

  useEffect(() => {
    if (!isDirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(), 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isDirty, save]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        save().then(onExit);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Z") {
        e.preventDefault();
        save().then(onExit);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save, onExit]);

  return (
    <div className="zen-mode">
      <div className="zen-mode__exit" onClick={() => save().then(onExit)}>
        Press Esc to exit Zen Mode
      </div>
      <div className="zen-mode__content">
        <input
          className="scene-editor__title"
          style={{ color: "var(--editor-title)" }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Scene title..."
        />
        <div className="scene-editor__divider" style={{ background: "var(--editor-border)" }} />
        <textarea
          className="scene-editor__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Begin writing..."
          autoFocus
        />
      </div>
      <div className="zen-mode__word-count">
        {wordCount} word{wordCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
