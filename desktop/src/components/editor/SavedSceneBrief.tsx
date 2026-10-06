import { useEffect, useState } from "react";
import { getManuscriptPlan } from "../../api";
import type { ManuscriptPlan } from "../../types";
import { PlanMetadataEditor } from "./PlanMetadataEditor";

export function SavedSceneBrief({ projectRoot, sceneId, title }: { projectRoot: string; sceneId: string; title: string }) {
  const [plan, setPlan] = useState<ManuscriptPlan | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setPlan(null); setError("");
    void getManuscriptPlan(projectRoot).then(value => { if (current) setPlan(value); })
      .catch(cause => { if (current) setError(String(cause)); });
    return () => { current = false; };
  }, [projectRoot, sceneId]);
  if (error) return <p role="alert">Could not load the saved scene brief: {error}</p>;
  if (!plan) return <p role="status">Loading saved scene direction…</p>;
  return <PlanMetadataEditor key={`${projectRoot}:${plan.workspace}:${sceneId}`} project={projectRoot} scope={plan.workspace || "legacy"}
    sceneId={sceneId} title={title} metadata={plan.scene_metadata[sceneId]} />;
}
