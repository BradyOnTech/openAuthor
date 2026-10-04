import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getManuscriptReading, getScene } from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { ManuscriptReading } from "../../types";
import { readPosition, retentionKey, savePosition } from "../../workspaceRetention";
import { isReadingPosition, locateReadingPosition, READING_PAGE_SIZE as PAGE_SIZE, type ReadingPosition } from "../../readingPosition";


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
  const positionKey = useRef("");
  const restore = useRef<ReadingPosition | null>(null);
  const [retentionWarning, setRetentionWarning] = useState("");
  const pendingTab = tabs.find((tab) => tab.kind === "scene" && tab.modified);
  const pendingWriting = Boolean(pendingTab);

  useEffect(() => {
    let current = true;
    setReading(null);
    if (!pendingWriting) {
      setError("");
      void getManuscriptReading(projectRoot).then((result) => {
        if (!current) return;
        positionKey.current = retentionKey(projectRoot, result.workspace || "legacy", "reading");
        let saved = null;
        try { saved = readPosition(positionKey.current, isReadingPosition); }
        catch { setRetentionWarning("Could not restore your reading position. The saved manuscript is unchanged."); }
        const located = locateReadingPosition(result, saved);
        restore.current = located.anchor;
        setReading(result);
        setSectionId(located.sectionId);
        setPage(located.page);
      }).catch((reason) => { if (current) setError(`Could not load manuscript: ${reason instanceof Error ? reason.message : String(reason)}`); });
    }
    return () => { current = false; };
  }, [projectRoot, pendingWriting, refresh]);

  useLayoutEffect(() => {
    const view = viewport.current;
    if (!reading || !view) return;
    const anchor = restore.current;
    const element = Array.from(view.querySelectorAll<HTMLElement>("[data-reading-scene]")).find((item) => item.dataset.readingScene === anchor?.sceneId);
    const top = element ? element.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop : 0;
    view.scrollTop = element && anchor?.offset != null ? Math.max(0, top + anchor.offset) : 0;
    restore.current = null;
  }, [reading, sectionId, page]);

  function retain(position: ReadingPosition) {
    try { savePosition(positionKey.current, position); }
    catch { setRetentionWarning("Reading position could not be retained on this device."); }
  }
  function onScroll() {
    const view = viewport.current;
    if (!view || !reading || restore.current) return;
    const elements = Array.from(view.querySelectorAll<HTMLElement>("[data-reading-scene]"));
    const top = view.getBoundingClientRect().top;
    const passed = elements.filter((item) => item.getBoundingClientRect().top <= top + 10);
    const element = passed[passed.length - 1] || elements[0];
    retain({ sectionId, sceneId: element?.dataset.readingScene || "", offset: element ? top - element.getBoundingClientRect().top : null });
  }

  const sectionIndex = reading?.sections.findIndex((section) => section.id === sectionId) ?? -1;
  const section = reading?.sections[sectionIndex];
  const byId = new Map(reading?.scenes.map((scene) => [scene.id, scene]));
  const sceneIds = section?.scene_ids || [];
  const pages = Math.max(1, Math.ceil(sceneIds.length / PAGE_SIZE));
  function changeSection(id: string) {
    retain({ sectionId: id, sceneId: reading?.sections.find((row) => row.id === id)?.scene_ids[0] || "", offset: null });
    setSectionId(id); setPage(0);
  }
  function changePage(next: number) {
    retain({ sectionId, sceneId: sceneIds[next * PAGE_SIZE] || "", offset: null }); setPage(next);
  }
  async function editScene(id: string) {
    try {
      const scene = await getScene(projectRoot, id);
      openTab({ id: `scene:${scene.id}`, kind: "scene", label: scene.title, data: scene });
    } catch (reason) { setError(`Could not open scene: ${reason instanceof Error ? reason.message : String(reason)}`); }
  }

  return <div className="manuscript-reader" ref={viewport} onScroll={onScroll}>
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
    {retentionWarning && <p className="manuscript-reader__notice" role="status">{retentionWarning}</p>}
    {!reading && !pendingWriting && !error && <p className="manuscript-reader__notice" role="status">Loading manuscript…</p>}
    {reading && section && <main className="manuscript-reader__prose" aria-label="Manuscript reading copy">
      <p>{section.act_title}</p>
      <h2>{section.title}</h2>
      {sceneIds.length === 0 && <p>No scenes in this chapter yet. Place them in Plan to read them here.</p>}
      {sceneIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((id) => {
        const scene = byId.get(id);
        return scene && <article key={id} data-reading-scene={id} aria-label={scene.title}>
          <div className="manuscript-reader__scene-heading"><h3>{scene.title}</h3><button className="btn btn--sm" aria-label={`Edit ${scene.title}`} onClick={() => void editScene(id)}>Edit scene</button></div>
          <div className="manuscript-reader__body">{scene.body || "This scene has no prose yet."}</div>
        </article>;
      })}
      <nav aria-label="Manuscript reading navigation">
        {pages > 1 && <><button className="btn" disabled={page === 0} onClick={() => changePage(page - 1)}>Previous scenes</button><span>Page {page + 1} of {pages}</span><button className="btn" disabled={page + 1 === pages} onClick={() => changePage(page + 1)}>Next scenes</button></>}
        <button className="btn" disabled={sectionIndex <= 0} onClick={() => changeSection(reading.sections[sectionIndex - 1].id)}>Previous chapter</button>
        <button className="btn" disabled={sectionIndex + 1 >= reading.sections.length} onClick={() => changeSection(reading.sections[sectionIndex + 1].id)}>Next chapter</button>
      </nav>
    </main>}
  </div>;
}
