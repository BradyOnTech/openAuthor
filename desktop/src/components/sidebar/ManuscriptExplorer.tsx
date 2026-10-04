import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { getScene, addScene, getManuscriptPlan } from "../../api";
import type { ManuscriptPlan, SceneSummary } from "../../types";

export function ManuscriptExplorer() {
  const { projectRoot } = useWorkspace();
  return <ManuscriptNavigation key={projectRoot} />;
}

function ManuscriptNavigation() {
  const { projectRoot, scenes, branches, refreshScenes, setError, setMessage } = useWorkspace();
  const { activeTabId, openTab } = useEditor();
  const [plan, setPlan] = useState<ManuscriptPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newTitle, setNewTitle] = useState("");
  const [newPov, setNewPov] = useState("");
  const [newStatus, setNewStatus] = useState("draft");
  const [adding, setAdding] = useState(false);
  const storyline = branches.find((branch) => branch.current)?.name || "";

  useEffect(() => {
    let current = true;
    setPlanError("");
    void getManuscriptPlan(projectRoot).then((result) => {
      if (current) setPlan(result);
    }).catch((error) => {
      if (current) {
        setPlan(null);
        setPlanError(`Chapter order unavailable. Showing all scenes. ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return () => { current = false; };
  }, [projectRoot, scenes, storyline, activeTabId, reload]);
  useEffect(() => { setPlan(null); }, [storyline]);

  const groups = useMemo(() => navigationGroups(plan, scenes), [plan, scenes]);
  const search = query.trim().toLocaleLowerCase();
  const visibleGroups = groups.map((group) => ({ ...group, scenes: group.scenes.filter((scene) =>
    !search || `${group.actTitle} ${group.title} ${scene.title} ${scene.pov} ${scene.id}`.toLocaleLowerCase().includes(search)
  ) })).filter((group) => !search || group.scenes.length > 0);

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
    if (!newTitle.trim() || adding) return;
    setAdding(true);
    try {
      const created = await addScene(projectRoot, {
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
      openTab({
        id: `scene:${created.id}`,
        kind: "scene",
        label: created.title,
        data: created,
      });
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
      <div className="sidebar__filter">
        <button className="btn btn--sm" style={{ width: "100%" }} disabled={scenes.length === 0} onClick={() => openTab({ id: "reader", kind: "reader", label: "Read manuscript" })}>Read manuscript</button>
        <input className="input manuscript-navigation__filter" type="search" aria-label="Filter manuscript scenes" placeholder="Find a scene, chapter or POV…" value={query} onChange={(event) => { setQuery(event.target.value); setCollapsed({}); }} />
      </div>
      <nav className="sidebar__content manuscript-navigation" aria-label="Manuscript scenes">
        {planError && <div className="manuscript-navigation__notice" role="status">{planError}<button className="btn btn--sm" onClick={() => setReload((value) => value + 1)}>Retry chapter order</button></div>}
        {visibleGroups.map((group, index) => {
          const expanded = !collapsed[group.id];
          const count = group.scenes.length;
          const words = group.scenes.reduce((total, scene) => total + (scene.word_count || 0), 0);
          return <section key={group.id} aria-label={group.title}>
            {group.actTitle && group.actId !== visibleGroups[index - 1]?.actId && <h3 className="manuscript-navigation__act">{group.actTitle}</h3>}
            <button className="manuscript-navigation__chapter" aria-expanded={expanded} aria-controls={`manuscript-group-${group.id}`} onClick={() => setCollapsed((value) => ({ ...value, [group.id]: !value[group.id] }))}>
              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span>{group.title}<small>{count} scene{count === 1 ? "" : "s"} · {words.toLocaleString()} words</small></span>
            </button>
            <div id={`manuscript-group-${group.id}`} hidden={!expanded}>
              {group.scenes.map((s) => <button type="button" key={s.id} className={`tree-item${activeTabId === `scene:${s.id}` ? " tree-item--selected" : ""}`} aria-label={`${s.title || s.id} ${s.status.slice(0, 3).toUpperCase()}`} aria-current={activeTabId === `scene:${s.id}` ? "page" : undefined} onClick={() => handleSceneClick(s.id, s.title)} title={`${s.id} — ${s.pov || "no POV"}`}>
                <span className="tree-item__icon" aria-hidden="true" style={{ color: statusColor(s.status) }}>{statusDot(s.status)}</span>
                <span className="tree-item__label">{s.title || s.id}</span>
                <span className={`tree-item__badge tree-item__badge--${s.status}`}>{s.status.slice(0, 3).toUpperCase()}</span>
              </button>)}
              {count === 0 && <p className="manuscript-navigation__notice">No scenes placed yet. Arrange this chapter in Plan.</p>}
            </div>
          </section>;
        })}

        {search && visibleGroups.length === 0 && <p className="manuscript-navigation__notice">No matching scenes. Try a scene title, chapter or POV.</p>}

        {scenes.length === 0 && (
          <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No scenes yet.
          </div>
        )}
      </nav>

      <div style={{
        padding: "var(--space-3)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}>
        <input
          id="new-scene-title"
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

// Consume the saved Plan; never create a second source of manuscript order.
// A scene added between the two reads must still remain reachable.
function navigationGroups(plan: ManuscriptPlan | null, scenes: SceneSummary[]) {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const seen = new Set<string>();
  function take(ids: string[]) {
    return ids.flatMap((id) => {
      const scene = byId.get(id);
      if (!scene || seen.has(id)) return [];
      seen.add(id);
      return [scene];
    });
  }
  const groups = (plan?.acts || []).flatMap((act) => act.chapters.map((chapter) => ({
    id: chapter.id, title: chapter.title, actId: act.id, actTitle: act.title, scenes: take(chapter.scene_ids),
  })));
  const remaining = take([...(plan?.unassigned_scene_ids || []), ...scenes.map((scene) => scene.id)]);
  if (remaining.length || groups.length === 0) groups.push({ id: "unassigned", title: plan ? "Unassigned scenes" : "All scenes", actId: "", actTitle: "", scenes: remaining });
  return groups;
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
