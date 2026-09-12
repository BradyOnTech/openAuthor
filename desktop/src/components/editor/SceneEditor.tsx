import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { getScene, updateScene } from "../../api";
import { SceneEditConflictError, type SceneConflict } from "../../sceneConflicts";
import {
  clearSceneRecoveryDraft,
  listSceneRecoveryDrafts,
  recoveryDraftMatchesScene,
  writeSceneRecoveryDraft,
  type SceneRecoveryDraft,
} from "../../recoveryJournal";
import type { SceneDetail } from "../../types";
import { ZenMode } from "../overlay/ZenMode";

type Props = {
  scene: SceneDetail;
  zenMode?: boolean;
  onExitZen?: () => void;
};

export function SceneEditor({ scene, zenMode = false, onExitZen }: Props) {
  const { projectRoot, refreshScenes, setError } = useWorkspace();
  const { updateTab, activeTabId } = useEditor();

  const [title, setTitle] = useState(scene.title);
  const [body, setBody] = useState(scene.body);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<SceneConflict | null>(null);
  const [refreshingConflict, setRefreshingConflict] = useState(false);
  const [allowStorylineTransfer, setAllowStorylineTransfer] = useState(false);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [recoveryDrafts, setRecoveryDrafts] = useState(() =>
    listSceneRecoveryDrafts(projectRoot, scene.id).filter((draft) => !recoveryDraftMatchesScene(draft, scene)));
  const [recoveryIndex, setRecoveryIndex] = useState(0);
  const recoveryDraft = recoveryDrafts[recoveryIndex] || recoveryDrafts[0];
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ title: scene.title, body: scene.body });
  const baseVersionRef = useRef(scene.edit_version);
  const conflictRef = useRef<SceneConflict | null>(null);
  const mountedRef = useRef(true);
  const saveRef = useRef<(showIndicator: boolean) => Promise<void>>(async () => {});
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const acknowledgedSceneRef = useRef<SceneDetail | null>(null);
  const ownedRecoveryDraftRef = useRef<SceneRecoveryDraft | null>(null);
  const [recoveryOwner] = useState(() => crypto.randomUUID());
  const recoverySequenceRef = useRef(0);
  const restoredRecoveryRef = useRef<SceneRecoveryDraft | null>(null);
  const refreshRecoveryDrafts = useCallback((savedScene: SceneDetail) => {
    setRecoveryDrafts(listSceneRecoveryDrafts(projectRoot, savedScene.id).filter((draft) =>
      draft.draftId !== recoveryOwner && !recoveryDraftMatchesScene(draft, savedScene)));
    setRecoveryIndex(0);
  }, [projectRoot, recoveryOwner]);
  const latestPayloadRef = useRef({
    sceneId: scene.id,
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

  useEffect(() => setAllowStorylineTransfer(false), [conflict]);

  useEffect(() => {
    // A save response describes the submitted draft, which may already be
    // older than the text on screen. Never reload our own acknowledgement.
    if (scene === acknowledgedSceneRef.current) return;
    if (conflictRef.current) return;
    const latest = latestPayloadRef.current;
    if (latest.title !== lastSavedRef.current.title || latest.body !== lastSavedRef.current.body) return;
    setTitle(scene.title);
    setBody(scene.body);
    lastSavedRef.current = { title: scene.title, body: scene.body };
    baseVersionRef.current = scene.edit_version;
    refreshRecoveryDrafts(scene);
  }, [projectRoot, scene.id, scene.title, scene.body, scene.edit_version, refreshRecoveryDrafts]);

  useEffect(() => {
    const refresh = () => refreshRecoveryDrafts(scene);
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [scene, refreshRecoveryDrafts]);

  useEffect(() => {
    latestPayloadRef.current = {
      sceneId: scene.id,
      title,
      body,
      tabId: activeTabId,
    };
  }, [scene.id, title, body, activeTabId]);

  const isDirty = Boolean(conflict) || title !== lastSavedRef.current.title || body !== lastSavedRef.current.body;
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  useEffect(() => {
    if (!isDirty && !saving) {
      if (ownedRecoveryDraftRef.current) {
        clearSceneRecoveryDraft(projectRoot, scene.id, ownedRecoveryDraftRef.current);
        ownedRecoveryDraftRef.current = null;
      }
      return;
    }
    const draft = writeSceneRecoveryDraft({
      projectRoot,
      sceneId: scene.id,
      baseUpdatedAt: scene.updated_at,
      baseVersion: baseVersionRef.current,
      draftId: recoveryOwner,
      sequence: ++recoverySequenceRef.current,
      title,
      body,
    });
    ownedRecoveryDraftRef.current = draft;
    setRecoveryUnavailable(draft === null);
  }, [body, isDirty, saving, projectRoot, scene.id, scene.updated_at, title, recoveryOwner]);

  useEffect(() => {
    updateTab(activeTabId, { modified: isDirty });
  }, [isDirty, activeTabId, updateTab]);

  const save = useCallback(async (showIndicator: boolean) => {
    if (conflictRef.current) return;
    if (saveInFlightRef.current) {
      await saveInFlightRef.current;
      return;
    }

    const hasUnsavedChanges = () =>
      latestPayloadRef.current.title !== lastSavedRef.current.title ||
      latestPayloadRef.current.body !== lastSavedRef.current.body;
    if (!hasUnsavedChanges()) return;

    let wroteScene = false;
    const run = (async () => {
      if (showIndicator && mountedRef.current) {
        setSaving(true);
        setSaveError("");
      }
      try {
        // Drain edits made during a request, including after this tab closes.
        // Only one request for this editor may write at a time.
        while (hasUnsavedChanges()) {
          const payload = latestPayloadRef.current;
          const submittedRecovery = ownedRecoveryDraftRef.current;
          const updated = await updateScene(projectRoot, payload.sceneId, {
            title: payload.title,
            body: payload.body,
            expectedVersion: baseVersionRef.current,
          });
          wroteScene = true;
          if (updated.save_warnings?.length) setError(updated.save_warnings.join(" "));
          lastSavedRef.current = { title: payload.title, body: payload.body };
          baseVersionRef.current = updated.edit_version;
          acknowledgedSceneRef.current = updated;
          const hasNewerWriting = hasUnsavedChanges();
          if (submittedRecovery && recoveryDraftMatchesScene(submittedRecovery, payload)) {
            clearSceneRecoveryDraft(projectRoot, payload.sceneId, submittedRecovery);
          }
          if (!hasNewerWriting) {
            const latestRecovery = ownedRecoveryDraftRef.current;
            if (latestRecovery && recoveryDraftMatchesScene(latestRecovery, payload)) {
              clearSceneRecoveryDraft(projectRoot, payload.sceneId, latestRecovery);
              ownedRecoveryDraftRef.current = null;
            }
            if (restoredRecoveryRef.current) {
              clearSceneRecoveryDraft(projectRoot, payload.sceneId, restoredRecoveryRef.current);
              restoredRecoveryRef.current = null;
            }
            if (mountedRef.current) refreshRecoveryDrafts(updated);
          }
          updateTab(payload.tabId, {
            modified: hasNewerWriting,
            label: updated.title || payload.sceneId,
            data: updated,
          });
        }
      } catch (e) {
        if (e instanceof SceneEditConflictError) {
          conflictRef.current = e.conflict;
          if (mountedRef.current) setConflict(e.conflict);
        }
        const message = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
        if (mountedRef.current) setSaveError(message);
        setError(message);
      } finally {
        if (showIndicator && mountedRef.current) {
          setSaving(false);
        }
      }
    })();

    saveInFlightRef.current = run;
    await run;
    saveInFlightRef.current = null;
    // Refreshing navigation is independent of writing the manuscript. A slow
    // list refresh must not hold the save queue or make saved prose look dirty.
    if (wroteScene) {
      try {
        await refreshScenes();
      } catch (error) {
        setError(`Scene written, but the manuscript list could not refresh: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [projectRoot, refreshScenes, setError, updateTab, refreshRecoveryDrafts]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (!isDirty || conflict) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void save(true);
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [body, title, isDirty, conflict, save]);

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save]);

  return (
    <div className={`scene-editor${zenMode ? " zen-mode" : ""}`} role={zenMode ? "dialog" : undefined} aria-modal={zenMode || undefined} aria-label={zenMode ? "Focused writing" : undefined}>
      {zenMode && onExitZen && <ZenMode onExit={onExitZen} />}
      <div className="scene-editor__status" aria-live="polite">
        <span>{wordCount.toLocaleString()} word{wordCount === 1 ? "" : "s"}</span>
        <span aria-hidden="true">·</span>
        <span className={isDirty ? "scene-editor__status--dirty" : ""}>{saving ? "Saving…" : conflict ? "Review conflict" : saveError ? "Save failed" : isDirty ? "Unsaved" : "Saved"}</span>
      </div>
      {saveError && !conflict && (
        <div role="alert" className="scene-editor__save-error">
          <span>{saveError}. Keep this scene open until your writing is saved.</span>
          <button className="btn btn--sm" disabled={saving} onClick={() => void save(true)}>Retry save</button>
        </div>
      )}
      {conflict && (
        <section className="scene-conflict" aria-label="Scene conflict review">
          <h2>Scene changed elsewhere</h2>
          <p role="alert">Autosave is paused. Your writing is still in the editor below; the saved scene has not been replaced.</p>
          <p>{conflict.reason === "storyline_changed"
            ? `This draft belongs to ${baseVersionRef.current?.storyline || "another Storyline"}. Switch back and reload the comparison, or explicitly choose to transfer this draft into ${conflict.current.edit_version?.storyline}.`
            : "Compare the saved version here with your draft below. Edit your draft to reconcile them, then explicitly save the reviewed version."}</p>
          {conflict.recovery_path && <details><summary>Local conflict backup</summary><p>Both submitted versions are preserved in {conflict.recovery_path}. Further unsaved edits remain in this editor and its recovery journal.</p></details>}
          <label>Saved title<input className="input" readOnly value={conflict.current.title} /></label>
          <label>Saved prose<textarea className="input" readOnly rows={5} value={conflict.current.body} /></label>
          {conflict.reason === "storyline_changed" && <label className="scene-conflict__transfer"><input type="checkbox" checked={allowStorylineTransfer} onChange={(event) => setAllowStorylineTransfer(event.target.checked)} />Save this reviewed draft into {conflict.current.edit_version?.storyline}</label>}
          <div className="scene-conflict__actions">
            <button className="btn btn--sm" disabled={saving || refreshingConflict} onClick={() => {
              setRefreshingConflict(true);
              void getScene(projectRoot, scene.id).then((current) => {
                if (!mountedRef.current) return;
                const next: SceneConflict = { ...conflict, current, reason: baseVersionRef.current && current.edit_version?.workspace !== baseVersionRef.current.workspace ? "storyline_changed" : "scene_changed" };
                conflictRef.current = next;
                setConflict(next);
              }).catch((error) => setError(`Could not reload the saved scene: ${String(error)}`))
                .finally(() => { if (mountedRef.current) setRefreshingConflict(false); });
            }}>{refreshingConflict ? "Loading…" : "Reload latest comparison"}</button>
            <button className="btn btn--primary btn--sm" disabled={saving || refreshingConflict || (conflict.reason === "storyline_changed" && !allowStorylineTransfer) || !conflict.current.edit_version} onClick={() => {
              const current = conflict.current;
              baseVersionRef.current = current.edit_version;
              lastSavedRef.current = { title: current.title, body: current.body };
              acknowledgedSceneRef.current = current;
              updateTab(activeTabId, { data: current });
              conflictRef.current = null;
              setConflict(null);
              setSaveError("");
              void save(true);
            }}>Save reconciled version</button>
          </div>
        </section>
      )}
      {recoveryUnavailable && isDirty && (
        <div role="alert" className="scene-editor__save-error">
          Recovery storage is unavailable. Keep this scene open until its status is Saved.
        </div>
      )}
      {recoveryDraft && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)", background: "var(--warning-subtle)", borderBottom: "1px solid var(--warning-border)", color: "var(--warning-text)", fontSize: "var(--text-sm)" }}>
          <span style={{ flex: 1 }}>Unsaved writing from {new Date(recoveryDraft.journaledAt).toLocaleString()} is available.{isDirty && " Save your current writing before restoring another draft."}</span>
          {recoveryDrafts.length > 1 && <select aria-label="Recovery draft" className="input" value={recoveryIndex} onChange={(event) => setRecoveryIndex(Number(event.target.value))}>
            {recoveryDrafts.map((draft, index) => <option key={draft.draftId || "legacy"} value={index}>{index + 1}. {draft.baseVersion?.storyline || "Unknown Storyline"} · {new Date(draft.journaledAt).toLocaleString()}</option>)}
          </select>}
          <button className="btn btn--primary btn--sm" disabled={isDirty || saving} onClick={() => {
            // Recovery must retain its original precondition. Adopting the
            // newly loaded scene's version would silently authorize replacement.
            baseVersionRef.current = recoveryDraft.baseVersion;
            restoredRecoveryRef.current = recoveryDraft;
            setTitle(recoveryDraft.title);
            setBody(recoveryDraft.body);
            if (!recoveryDraft.baseVersion) {
              const review: SceneConflict = { code: "scene_edit_conflict", reason: "scene_changed", current: scene, conflicting_fields: ["body"], recovery_path: "" };
              conflictRef.current = review;
              setConflict(review);
            }
            setRecoveryDrafts([]);
            setRecoveryIndex(0);
          }}>Restore</button>
          <button className="btn btn--ghost btn--sm" onClick={() => {
            clearSceneRecoveryDraft(projectRoot, scene.id, recoveryDraft);
            refreshRecoveryDrafts(scene);
          }}>Discard</button>
        </div>
      )}
      <div className="scene-editor__content">
        <input
          aria-label="Scene title"
          className="scene-editor__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Scene title..."
        />
        <div className="scene-editor__divider" />
        <textarea
          aria-label="Scene prose"
          className="scene-editor__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Begin writing..."
        />
      </div>
    </div>
  );
}
