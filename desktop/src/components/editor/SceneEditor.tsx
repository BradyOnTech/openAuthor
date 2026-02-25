import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { updateScene } from "../../api";
import type { SceneDetail } from "../../types";

type Props = {
  scene: SceneDetail;
};

export function SceneEditor({ scene }: Props) {
  const { projectRoot, refreshScenes, setError } = useWorkspace();
  const { updateTab, activeTabId } = useEditor();

  const [title, setTitle] = useState(scene.title);
  const [body, setBody] = useState(scene.body);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ title: scene.title, body: scene.body });
  const mountedRef = useRef(true);
  const saveRef = useRef<(showIndicator: boolean) => Promise<void>>(async () => {});
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const latestPayloadRef = useRef({
    sceneId: scene.id,
    summary: scene.summary,
    pov: scene.pov,
    status: scene.status,
    title,
    body,
    tabId: activeTabId,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setTitle(scene.title);
    setBody(scene.body);
    lastSavedRef.current = { title: scene.title, body: scene.body };
  }, [scene.id, scene.title, scene.body]);

  useEffect(() => {
    latestPayloadRef.current = {
      sceneId: scene.id,
      summary: scene.summary,
      pov: scene.pov,
      status: scene.status,
      title,
      body,
      tabId: activeTabId,
    };
  }, [scene.id, scene.summary, scene.pov, scene.status, title, body, activeTabId]);

  const isDirty = title !== lastSavedRef.current.title || body !== lastSavedRef.current.body;

  useEffect(() => {
    updateTab(activeTabId, { modified: isDirty });
  }, [isDirty, activeTabId, updateTab]);

  const save = useCallback(async (showIndicator: boolean) => {
    const payload = latestPayloadRef.current;
    const hasUnsavedChanges =
      payload.title !== lastSavedRef.current.title || payload.body !== lastSavedRef.current.body;
    if (!hasUnsavedChanges) return;
    if (saveInFlightRef.current) {
      await saveInFlightRef.current;
      return;
    }

    const run = (async () => {
      if (showIndicator && mountedRef.current) {
        setSaving(true);
      }
      try {
        const updated = await updateScene(projectRoot, payload.sceneId, {
          title: payload.title,
          summary: payload.summary,
          pov: payload.pov,
          status: payload.status,
          body: payload.body,
        });
        lastSavedRef.current = { title: updated.title, body: updated.body };
        updateTab(payload.tabId, {
          modified: false,
          label: updated.title || payload.sceneId,
          data: updated,
        });
        await refreshScenes();
      } catch (e) {
        setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (showIndicator && mountedRef.current) {
          setSaving(false);
        }
      }
    })();

    saveInFlightRef.current = run;
    await run;
    saveInFlightRef.current = null;
  }, [projectRoot, refreshScenes, setError, updateTab]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (!isDirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void save(true);
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isDirty, save]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      void saveRef.current(false);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save]);

  return (
    <div className="scene-editor">
      <div className="scene-editor__content">
        <input
          className="scene-editor__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Scene title..."
        />
        <div className="scene-editor__divider" />
        <textarea
          className="scene-editor__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Begin writing..."
        />
      </div>
      {saving && (
        <div style={{
          position: "absolute",
          bottom: "var(--space-3)",
          right: "var(--space-4)",
          fontSize: "var(--text-xs)",
          color: "var(--editor-text-secondary)",
          fontFamily: "var(--font-mono)",
          opacity: 0.5,
        }}>
          Saving...
        </div>
      )}
    </div>
  );
}
