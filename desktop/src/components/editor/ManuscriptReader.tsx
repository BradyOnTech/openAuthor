import { useEffect, useRef, useState } from "react";
import { getManuscriptReading, getScene } from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { ManuscriptReading } from "../../types";

const PAGE_SIZE = 25;

export function ManuscriptReader() {
  const { projectRoot } = useWorkspace();
  return <ReadingView key={projectRoot} projectRoot={projectRoot} />;
}

function ReadingView({ projectRoot }: { projectRoot: string }) {
  const { tabs, openTab, setActiveTab } = useEditor();
  const [reading, setReading] = useState<ManuscriptReading | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const pendingTab = tabs.find((tab) => tab.kind === "scene" && tab.modified);
  const pendingWriting = Boolean(pendingTab);

  useEffect(() => {
    let current = true;
    setReading(null);
    if (!pendingWriting) {
      setError("");
      void getManuscriptReading(projectRoot).then((result) => {
        if (!current) return;
        setReading(result);
        setSectionId((id) => result.sections.some((section) => section.id === id) ? id : result.sections[0]?.id || "");
        setPage(0);
      }).catch((reason) => { if (current) setError(`Could not load manuscript: ${reason instanceof Error ? reason.message : String(reason)}`); });
    }
    return () => { current = false; };
  }, [projectRoot, pendingWriting, refresh]);

  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [sectionId, page]);

  const sectionIndex = reading?.sections.findIndex((section) => section.id === sectionId) ?? -1;
  const section = reading?.sections[sectionIndex];
  const byId = new Map(reading?.scenes.map((scene) => [scene.id, scene]));
  const sceneIds = section?.scene_ids || [];
  const pages = Math.max(1, Math.ceil(sceneIds.length / PAGE_SIZE));
  function changeSection(id: string) { setSectionId(id); setPage(0); }
  async function editScene(id: string) {
    try {
      const scene = await getScene(projectRoot, id);
      openTab({ id: `scene:${scene.id}`, kind: "scene", label: scene.title, data: scene });
    } catch (reason) { setError(`Could not open scene: ${reason instanceof Error ? reason.message : String(reason)}`); }
  }

  return <div className="manuscript-reader" ref={viewport}>
    <header className="manuscript-reader__toolbar">
      <div><h1>Read manuscript</h1><p>Saved prose in Plan order. Reading here never changes your manuscript.</p></div>
      <button className="btn btn--sm" disabled={pendingWriting} onClick={() => setRefresh((value) => value + 1)}>Refresh reading copy</button>
      {reading && <>
        <label>Chapter<select className="select" aria-label="Reading chapter" value={sectionId} onChange={(event) => changeSection(event.target.value)}>
          {reading.sections.map((row) => <option key={row.id} value={row.id}>{row.act_title ? `${row.act_title} · ` : ""}{row.title}</option>)}
        </select></label>
        <span>{reading.scenes.length} scenes · {reading.word_count.toLocaleString()} words</span>
      </>}
    </header>
    {pendingTab && <div className="manuscript-reader__notice" role="status">Waiting for your scene to save. If it needs attention, return to the editor before reading.<button className="btn" onClick={() => setActiveTab(pendingTab.id)}>Return to unsaved scene</button></div>}
    {error && <p className="manuscript-reader__notice" role="alert">{error}</p>}
    {!reading && !pendingWriting && !error && <p className="manuscript-reader__notice" role="status">Loading manuscript…</p>}
    {reading && section && <main className="manuscript-reader__prose" aria-label="Manuscript reading copy">
      <p>{section.act_title}</p>
      <h2>{section.title}</h2>
      {sceneIds.length === 0 && <p>No scenes in this chapter yet. Place them in Plan to read them here.</p>}
      {sceneIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((id) => {
        const scene = byId.get(id);
        return scene && <article key={id} aria-label={scene.title}>
          <div className="manuscript-reader__scene-heading"><h3>{scene.title}</h3><button className="btn btn--sm" aria-label={`Edit ${scene.title}`} onClick={() => void editScene(id)}>Edit scene</button></div>
          <div className="manuscript-reader__body">{scene.body || "This scene has no prose yet."}</div>
        </article>;
      })}
      <nav aria-label="Manuscript reading navigation">
        {pages > 1 && <><button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous scenes</button><span>Page {page + 1} of {pages}</span><button className="btn" disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>Next scenes</button></>}
        <button className="btn" disabled={sectionIndex <= 0} onClick={() => changeSection(reading.sections[sectionIndex - 1].id)}>Previous chapter</button>
        <button className="btn" disabled={sectionIndex + 1 >= reading.sections.length} onClick={() => changeSection(reading.sections[sectionIndex + 1].id)}>Next chapter</button>
      </nav>
    </main>}
  </div>;
}
