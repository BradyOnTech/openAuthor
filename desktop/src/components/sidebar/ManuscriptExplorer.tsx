import { useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { getScene, addScene } from "../../api";

export function ManuscriptExplorer() {
  const { projectRoot, scenes, refreshScenes, setError, setMessage } = useWorkspace();
  const { openTab } = useEditor();
  const [newTitle, setNewTitle] = useState("");
  const [newPov, setNewPov] = useState("");
  const [newStatus, setNewStatus] = useState("draft");
  const [adding, setAdding] = useState(false);

  async function handleSceneClick(sceneId: string, title: string) {
    try {
      const detail = await getScene(projectRoot, sceneId);
      openTab({
        id: `scene:${sceneId}`,
        kind: "scene",
        label: title,
        data: detail,
      });
    } catch (e) {
      setError(`Failed to open scene: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleAddScene() {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      await addScene(projectRoot, {
        title: newTitle.trim(),
        summary: "",
        pov: newPov.trim(),
        status: newStatus,
        body: "",
      });
      setNewTitle("");
      setNewPov("");
      setNewStatus("draft");
      setMessage("Scene created.");
      await refreshScenes();
    } catch (e) {
      setError(`Failed to add scene: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <div className="sidebar__header">
        <span className="sidebar__title">Manuscript</span>
        <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
          {scenes.length}
        </span>
      </div>
      <div className="sidebar__content">
        {scenes.map((s) => (
          <div
            key={s.id}
            className="tree-item"
            onClick={() => handleSceneClick(s.id, s.title)}
            title={`${s.id} \u2014 ${s.pov || "no POV"}`}
          >
            <span className="tree-item__icon" style={{ color: statusColor(s.status) }}>
              {statusDot(s.status)}
            </span>
            <span className="tree-item__label">{s.title || s.id}</span>
            <span className={`tree-item__badge tree-item__badge--${s.status}`}>
              {s.status.slice(0, 3).toUpperCase()}
            </span>
          </div>
        ))}

        {scenes.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No scenes yet.
          </div>
        )}
      </div>

      <div style={{
        padding: "var(--space-3)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}>
        <input
          className="input"
          placeholder="New scene title..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddScene()}
        />
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <input
            className="input"
            placeholder="POV"
            value={newPov}
            onChange={(e) => setNewPov(e.target.value)}
            style={{ flex: 1 }}
          />
          <select
            className="select"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
          >
            <option value="draft">Draft</option>
            <option value="revised">Revised</option>
            <option value="final">Final</option>
          </select>
        </div>
        <button
          className="btn btn--primary"
          disabled={!newTitle.trim() || adding}
          onClick={handleAddScene}
          style={{ width: "100%" }}
        >
          Add Scene
        </button>
      </div>
    </>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "draft": return "var(--warning)";
    case "revised": return "var(--info)";
    case "final": return "var(--success)";
    default: return "var(--text-ghost)";
  }
}

function statusDot(status: string): string {
  switch (status) {
    case "final": return "\u25CF";
    default: return "\u25CB";
  }
}
