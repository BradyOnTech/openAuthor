import { useEffect, useState } from "react";
import { getScene } from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { SceneDetail, CanonEvidence } from "../../types";
import { SceneEditor } from "./SceneEditor";

// An inactive tab is a navigation bookmark, not a current manuscript snapshot.
// Load before editing so a Storyline switch cannot make clean prose look stale.
// Dirty tabs deliberately keep their original guarded-save precondition.
export function SceneDocument({ tabId, scene, modified = false, focusPassage, zenMode, onExitZen }: {
  tabId: string;
  scene: SceneDetail;
  modified?: boolean;
  focusPassage?: CanonEvidence;
  zenMode?: boolean;
  onExitZen?: () => void;
}) {
  const { projectRoot } = useWorkspace();
  const { updateTab } = useEditor();
  const [startedDirty] = useState(modified);
  const [ready, setReady] = useState(modified);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (startedDirty) return;
    let current = true;
    setReady(false);
    setError("");
    void getScene(projectRoot, scene.id).then((fresh) => {
      if (!current) return;
      updateTab(tabId, { label: fresh.title, data: fresh });
      setReady(true);
    }).catch((reason) => {
      if (current) setError(`Could not open the saved scene: ${reason instanceof Error ? reason.message : String(reason)}`);
    });
    return () => { current = false; };
  }, [projectRoot, scene.id, tabId, startedDirty, attempt, updateTab]);

  if (!ready) return <div style={{ padding: "var(--space-5)" }}>
    {error ? <><p role="alert">{error}</p><button className="btn" onClick={() => setAttempt((value) => value + 1)}>Retry opening scene</button></> : <p role="status">Loading saved scene…</p>}
  </div>;
  return <SceneEditor tabId={tabId} scene={scene} focusPassage={focusPassage} zenMode={zenMode} onExitZen={onExitZen} />;
}
