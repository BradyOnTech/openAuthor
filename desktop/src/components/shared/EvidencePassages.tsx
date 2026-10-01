import { getScene } from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import type { CanonEvidence } from "../../types";

export function EvidencePassages({ evidence }: { evidence: CanonEvidence[] }) {
  const { projectRoot, scenes, setError } = useWorkspace();
  const { openTab } = useEditor();
  async function open(item: CanonEvidence) {
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending writing before opening evidence.");
      const scene = await getScene(projectRoot, item.scene_id);
      openTab({ id: `scene:${scene.id}`, kind: "scene", label: scene.title || scene.id, data: scene, focusPassage: item.source_field === "pov" ? undefined : { ...item } });
    } catch (error) { setError(`Could not open evidence: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
    {evidence.map((item, index) => {
      const title = scenes.find(scene => scene.id === item.scene_id)?.title || item.scene_id;
      return <div key={`${item.scene_id}:${item.start}:${index}`}>
        <blockquote style={{ margin: 0, padding: "6px 10px", borderLeft: "2px solid var(--border)", color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.excerpt}</blockquote>
        {item.attribution && <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: 4 }}>{item.attribution}</div>}
        {item.source_field === "pov" && <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: 4 }}>From scene POV metadata, not a prose passage.</div>}
        <button className="btn btn--ghost btn--sm" style={{ minHeight: 40, whiteSpace: "normal", textAlign: "left" }} aria-label={`Open evidence ${index + 1} in ${title}`} onClick={() => void open(item)}>Open {title}</button>
      </div>;
    })}
  </div>;
}
