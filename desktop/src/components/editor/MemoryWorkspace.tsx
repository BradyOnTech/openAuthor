import { useEffect, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { CanonMemoryEditor } from "./CanonMemoryEditor";
import { MemorySuggestionReview } from "./MemorySuggestionReview";

export type MemoryViewRequest = { memoryView: "suggestions" | "canon"; suggestionId?: string };
type View = MemoryViewRequest["memoryView"];

export function MemoryWorkspace({ request }: { request?: MemoryViewRequest }) {
  const { projectRoot, branches } = useWorkspace();
  const branch = branches?.find(row => row.current)?.name || "";
  return <MemoryWorkspaceSession key={JSON.stringify([projectRoot, branch])} preferenceKey={`openauthor.memoryView.v1:${JSON.stringify([projectRoot, branch])}`} request={request} />;
}

function MemoryWorkspaceSession({ preferenceKey, request }: { preferenceKey: string; request?: MemoryViewRequest }) {
  const { activeTabId, updateTab } = useEditor();
  const [view, setView] = useState<View>(() => {
    if (request) return request.memoryView;
    try { return localStorage.getItem(preferenceKey) === "suggestions" ? "suggestions" : "canon"; }
    catch { return "canon"; }
  });
  const [openedCanon, setOpenedCanon] = useState(view === "canon");
  const [openedSuggestions, setOpenedSuggestions] = useState(view === "suggestions");
  useEffect(() => {
    if (!request) return;
    setView(request.memoryView);
    // A navigation request is consumed once. Returning to this tab must use
    // its current review selection rather than replay an old sidebar command.
    updateTab(activeTabId, { data: null });
  }, [request, activeTabId, updateTab]);
  useEffect(() => {
    if (view === "canon") setOpenedCanon(true); else setOpenedSuggestions(true);
    try { localStorage.setItem(preferenceKey, view); } catch { /* View preferences contain no author writing. */ }
  }, [preferenceKey, view]);
  return <div className="memory-workspace">
    <nav className="memory-workspace__views" aria-label="Story Memory views">
      <button className="btn" aria-label="Show Canon & Continuity" aria-pressed={view === "canon"} onClick={() => setView("canon")}>Canon & Continuity</button>
      <button className="btn" aria-label="Show suggestion inbox" aria-pressed={view === "suggestions"} onClick={() => setView("suggestions")}>Suggestion inbox</button>
    </nav>
    <div className="memory-workspace__content">
      {openedCanon && <div hidden={view !== "canon"} className="memory-workspace__view"><CanonMemoryEditor /></div>}
      {openedSuggestions && <div hidden={view !== "suggestions"} className="memory-workspace__view"><MemorySuggestionReview request={request} /></div>}
    </div>
  </div>;
}
