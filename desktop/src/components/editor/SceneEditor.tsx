import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { sceneSaveSession } from "../../sceneSaveSession";
import { clearSceneRecoveryDraft, readSceneRecoveryDraft, recoveryDraftMatchesScene } from "../../recoveryJournal";
import type { CanonEvidence, SceneDetail } from "../../types";
import { evidenceRange } from "../../evidenceRange";

export function SceneEditor({ scene, focusPassage }: { scene: SceneDetail; focusPassage?: CanonEvidence }) {
  const { projectRoot } = useWorkspace();
  return <SceneEditorSession key={`${projectRoot}:${scene.id}`} scene={scene} focusPassage={focusPassage} />;
}

function SceneEditorSession({ scene, focusPassage }: { scene: SceneDetail; focusPassage?: CanonEvidence }) {
  const { projectRoot, refreshScenes, setError } = useWorkspace();
  const { updateTab, activeTabId } = useEditor();
  const [session] = useState(() => sceneSaveSession(projectRoot, scene));
  const { title, body, saving, error, readOnly } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [recoveryDraft, setRecoveryDraft] = useState(() => {
    if (session.dirty) return null;
    const draft = readSceneRecoveryDraft(projectRoot, scene.id);
    return draft && !recoveryDraftMatchesScene(draft, scene) ? draft : null;
  });
  const isDirty = session.dirty;
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  useEffect(() => { session.acceptScene(scene); }, [scene, session]);

  useEffect(() => {
    if (!focusPassage || !bodyRef.current) return;
    const range = evidenceRange(session.getSnapshot().body, focusPassage);
    if (range) {
      bodyRef.current.focus();
      bodyRef.current.setSelectionRange(...range);
    } else {
      setError("This evidence passage changed or is ambiguous. The scene is open; run a fresh scan before relying on the old passage.");
    }
    updateTab(`scene:${scene.id}`, { focusPassage: undefined });
  }, [focusPassage, session, scene.id, setError, updateTab]);

  useEffect(() => {
    let mounted = true;
    session.setOnSaved((updated, dirty) => {
      updateTab(activeTabId, { modified: dirty, label: updated.title || scene.id, data: updated });
      if (mounted && !dirty) {
        setRecoveryDraft(null);
        void refreshScenes();
      }
    });
    return () => { mounted = false; };
  }, [session, activeTabId, scene.id, updateTab, refreshScenes]);

  useEffect(() => { updateTab(activeTabId, { modified: isDirty }); }, [isDirty, activeTabId, updateTab]);
  useEffect(() => { if (error) setError(error); }, [error, setError]);

  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => { void session.flush(); }, 2000);
    return () => clearTimeout(timer);
  }, [isDirty, title, body, session]);

  useEffect(() => () => { void session.flush(); }, [session]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void session.flush();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session]);

  return (
    <div className="scene-editor">
      <div className="scene-editor__status" aria-live="polite">
        <span>{wordCount.toLocaleString()} word{wordCount === 1 ? "" : "s"}</span>
        <span aria-hidden="true">·</span>
        <span className={isDirty ? "scene-editor__status--dirty" : ""}>{readOnly ? "Changing book version…" : saving ? "Saving…" : isDirty ? "Unsaved" : "Saved"}</span>
        {error && <button className="btn btn--ghost btn--sm" onClick={() => void session.flush()}>Retry save</button>}
      </div>
      {recoveryDraft && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)", background: "var(--warning-subtle)", borderBottom: "1px solid var(--warning-border)", color: "var(--warning-text)", fontSize: "var(--text-sm)" }}>
          <span style={{ flex: 1 }}>Unsaved writing from {new Date(recoveryDraft.journaledAt).toLocaleString()} is available.</span>
          <button className="btn btn--primary btn--sm" onClick={() => {
            session.edit({ title: recoveryDraft.title, body: recoveryDraft.body });
            setRecoveryDraft(null);
          }}>Restore</button>
          <button className="btn btn--ghost btn--sm" onClick={() => {
            clearSceneRecoveryDraft(projectRoot, scene.id);
            setRecoveryDraft(null);
          }}>Discard</button>
        </div>
      )}
      <div className="scene-editor__content">
        <input className="scene-editor__title" readOnly={readOnly} value={title} onChange={event => session.edit({ title: event.target.value })} placeholder="Scene title..." />
        <div className="scene-editor__divider" />
        <textarea ref={bodyRef} className="scene-editor__body" aria-label="Scene prose" readOnly={readOnly} value={body} onChange={event => session.edit({ body: event.target.value })} placeholder="Begin writing..." />
      </div>
    </div>
  );
}
