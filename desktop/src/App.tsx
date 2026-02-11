import { useEffect, useMemo, useState } from "react";
import {
  addCodexEntity,
  addScene,
  applyProposal,
  createProposal,
  getCodexEntity,
  getProjectStatus,
  getScene,
  listCodexEntities,
  listProposals,
  listScenes,
  rejectProposal,
  runContinuityChecks,
  updateCodexEntity,
  updateScene
} from "./api";
import {
  continuityIssuesForScene,
  countContinuityIssues,
  countProposals,
  countSceneStatuses,
  orderScenesForOutline,
  orderCodexEntities,
  orderContinuityIssues,
  orderProposalsForReview,
  proposalsForScene
} from "./state";
import type {
  CodexEntity,
  ContinuityIssue,
  ProposalRecord,
  SceneDetail,
  SceneSummary
} from "./types";

const DEFAULT_ROOT = ".";

type RightTab = "proposals" | "codex" | "checks" | "context";
type CenterView = "editor" | "outliner";
type OutlinerStatusFilter = "all" | "draft" | "revised" | "final";

type DraftScene = {
  title: string;
  summary: string;
  pov: string;
  status: string;
  body: string;
};

type DraftProposal = {
  title: string;
  instruction: string;
  sceneId: string;
};

type DraftCodex = {
  type: CodexEntity["type"];
  name: string;
  description: string;
};

const EMPTY_DRAFT_SCENE: DraftScene = {
  title: "",
  summary: "",
  pov: "",
  status: "draft",
  body: ""
};

const EMPTY_DRAFT_PROPOSAL: DraftProposal = {
  title: "",
  instruction: "",
  sceneId: ""
};

const EMPTY_DRAFT_CODEX: DraftCodex = {
  type: "character",
  name: "",
  description: ""
};

export function App() {
  const [projectRoot, setProjectRoot] = useState(DEFAULT_ROOT);
  const [projectFound, setProjectFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("proposals");
  const [centerView, setCenterView] = useState<CenterView>("editor");
  const [outlinerQuery, setOutlinerQuery] = useState("");
  const [outlinerStatusFilter, setOutlinerStatusFilter] =
    useState<OutlinerStatusFilter>("all");

  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [draft, setDraft] = useState<DraftScene>(EMPTY_DRAFT_SCENE);
  const [addForm, setAddForm] = useState<DraftScene>(EMPTY_DRAFT_SCENE);

  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [proposalForm, setProposalForm] = useState<DraftProposal>(EMPTY_DRAFT_PROPOSAL);
  const [selectedProposalId, setSelectedProposalId] = useState<string>("");

  const [codexEntities, setCodexEntities] = useState<CodexEntity[]>([]);
  const [codexForm, setCodexForm] = useState<DraftCodex>(EMPTY_DRAFT_CODEX);
  const [selectedCodexEntityId, setSelectedCodexEntityId] = useState<string>("");
  const [codexDraft, setCodexDraft] = useState<DraftCodex>(EMPTY_DRAFT_CODEX);

  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [selectedContinuityIssueId, setSelectedContinuityIssueId] = useState<string>("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canSaveScene = useMemo(() => {
    return Boolean(selectedSceneId && draft.title.trim() !== "");
  }, [selectedSceneId, draft.title]);

  const canSaveCodex = useMemo(() => {
    return Boolean(selectedCodexEntityId && codexDraft.name.trim() !== "");
  }, [selectedCodexEntityId, codexDraft.name]);

  const proposalCounts = useMemo(() => countProposals(proposals), [proposals]);
  const sceneStatusCounts = useMemo(() => countSceneStatuses(scenes), [scenes]);
  const continuityCounts = useMemo(
    () => countContinuityIssues(continuityIssues),
    [continuityIssues]
  );
  const outlinerRows = useMemo(() => {
    const ordered = orderScenesForOutline(scenes);
    const query = outlinerQuery.trim().toLowerCase();
    return ordered.filter((item) => {
      const matchesStatus =
        outlinerStatusFilter === "all" ||
        item.status.toLowerCase() === outlinerStatusFilter;
      if (!matchesStatus) return false;
      if (query === "") return true;
      const haystack = [
        item.id,
        item.title,
        item.summary,
        item.pov,
        item.status,
        item.path
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [scenes, outlinerQuery, outlinerStatusFilter]);

  const selectedProposal = useMemo(
    () => proposals.find((item) => item.id === selectedProposalId) ?? null,
    [proposals, selectedProposalId]
  );

  const selectedContinuityIssue = useMemo(
    () => continuityIssues.find((item) => item.id === selectedContinuityIssueId) ?? null,
    [continuityIssues, selectedContinuityIssueId]
  );
  const contextProposals = useMemo(
    () => proposalsForScene(proposals, selectedSceneId),
    [proposals, selectedSceneId]
  );
  const contextProposalCounts = useMemo(
    () => countProposals(contextProposals),
    [contextProposals]
  );
  const contextContinuityIssues = useMemo(
    () => continuityIssuesForScene(continuityIssues, selectedSceneId),
    [continuityIssues, selectedSceneId]
  );
  const contextContinuityCounts = useMemo(
    () => countContinuityIssues(contextContinuityIssues),
    [contextContinuityIssues]
  );
  const povCharacterEntity = useMemo(() => {
    if (!scene?.pov) return null;
    const normalizedPov = scene.pov.trim().toLowerCase();
    return (
      codexEntities.find(
        (entity) =>
          entity.type === "character" &&
          entity.name.trim().toLowerCase() === normalizedPov
      ) ?? null
    );
  }, [codexEntities, scene?.pov]);

  const canOpenSelectedIssueScene = useMemo(() => {
    if (!selectedContinuityIssue) return false;
    return scenes.some((item) => item.id === selectedContinuityIssue.scene_id);
  }, [selectedContinuityIssue, scenes]);

  async function refreshSceneList(nextSelectedSceneId?: string) {
    const rows = await listScenes(projectRoot);
    setScenes(rows);
    if (rows.length === 0) {
      setSelectedSceneId("");
      setScene(null);
      setDraft(EMPTY_DRAFT_SCENE);
      return;
    }
    const target =
      nextSelectedSceneId && rows.some((item) => item.id === nextSelectedSceneId)
        ? nextSelectedSceneId
        : selectedSceneId && rows.some((item) => item.id === selectedSceneId)
          ? selectedSceneId
          : rows[0].id;
    setSelectedSceneId(target);
  }

  async function refreshProposalList(nextSelectedProposalId?: string) {
    const rows = await listProposals(projectRoot);
    const ordered = orderProposalsForReview(rows);
    setProposals(ordered);
    if (ordered.length === 0) {
      setSelectedProposalId("");
      return;
    }
    const target =
      nextSelectedProposalId && ordered.some((item) => item.id === nextSelectedProposalId)
        ? nextSelectedProposalId
        : selectedProposalId && ordered.some((item) => item.id === selectedProposalId)
          ? selectedProposalId
          : ordered[0].id;
    setSelectedProposalId(target);
  }

  async function refreshCodexList(nextSelectedCodexId?: string) {
    const rows = await listCodexEntities(projectRoot);
    const ordered = orderCodexEntities(rows);
    setCodexEntities(ordered);
    if (ordered.length === 0) {
      setSelectedCodexEntityId("");
      setCodexDraft(EMPTY_DRAFT_CODEX);
      return;
    }
    const target =
      nextSelectedCodexId && ordered.some((item) => item.id === nextSelectedCodexId)
        ? nextSelectedCodexId
        : selectedCodexEntityId && ordered.some((item) => item.id === selectedCodexEntityId)
          ? selectedCodexEntityId
          : ordered[0].id;
    setSelectedCodexEntityId(target);
  }

  async function loadSelectedScene(sceneId: string) {
    const row = await getScene(projectRoot, sceneId);
    setScene(row);
    setDraft({
      title: row.title,
      summary: row.summary,
      pov: row.pov,
      status: row.status,
      body: row.body
    });
  }

  async function loadSelectedCodex(entityId: string) {
    const row = await getCodexEntity(projectRoot, entityId);
    setCodexDraft({
      type: row.type,
      name: row.name,
      description: row.description
    });
  }

  async function checkProjectAndLoad() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const status = await getProjectStatus(projectRoot);
      setProjectFound(status.found);
      if (!status.found) {
        setScenes([]);
        setScene(null);
        setDraft(EMPTY_DRAFT_SCENE);
        setProposals([]);
        setSelectedProposalId("");
        setCodexEntities([]);
        setSelectedCodexEntityId("");
        setCodexDraft(EMPTY_DRAFT_CODEX);
        setContinuityIssues([]);
        setSelectedContinuityIssueId("");
        return;
      }
      await Promise.all([refreshSceneList(), refreshProposalList(), refreshCodexList()]);
      setContinuityIssues([]);
      setSelectedContinuityIssueId("");
      setMessage("Project loaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void checkProjectAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSceneId) return;
    setBusy(true);
    setError("");
    setMessage("");
    void loadSelectedScene(selectedSceneId)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));

    setProposalForm((prev) => ({
      ...prev,
      sceneId: prev.sceneId || selectedSceneId
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSceneId]);

  useEffect(() => {
    if (!selectedCodexEntityId) return;
    setBusy(true);
    setError("");
    setMessage("");
    void loadSelectedCodex(selectedCodexEntityId)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCodexEntityId]);

  async function handleCreateScene() {
    if (addForm.title.trim() === "") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await addScene(projectRoot, addForm);
      await refreshSceneList();
      const refreshed = await listScenes(projectRoot);
      const newest = refreshed[refreshed.length - 1];
      if (newest) {
        setSelectedSceneId(newest.id);
      }
      setAddForm(EMPTY_DRAFT_SCENE);
      setMessage("Scene created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveScene() {
    if (!selectedSceneId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await updateScene(projectRoot, selectedSceneId, draft);
      setScene(saved);
      await refreshSceneList(saved.id);
      setMessage("Scene saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProposal() {
    if (proposalForm.title.trim() === "" || proposalForm.instruction.trim() === "") return;
    const sceneId = proposalForm.sceneId || selectedSceneId;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await createProposal(projectRoot, {
        title: proposalForm.title,
        instruction: proposalForm.instruction,
        sceneId
      });
      await refreshProposalList(created.id);
      setProposalForm({
        title: "",
        instruction: "",
        sceneId
      });
      setMessage("Proposal created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyProposal(proposalId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await applyProposal(projectRoot, proposalId);
      await refreshProposalList(updated.id);
      setMessage("Proposal applied.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectProposal(proposalId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await rejectProposal(projectRoot, proposalId);
      await refreshProposalList(updated.id);
      setMessage("Proposal rejected.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCodex() {
    if (codexForm.name.trim() === "") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await addCodexEntity(projectRoot, codexForm);
      await refreshCodexList(created.id);
      setCodexForm(EMPTY_DRAFT_CODEX);
      setMessage("Codex entity created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCodex() {
    if (!selectedCodexEntityId || codexDraft.name.trim() === "") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await updateCodexEntity(projectRoot, selectedCodexEntityId, codexDraft);
      await refreshCodexList(updated.id);
      setMessage("Codex entity saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRunContinuityChecks() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const rows = await runContinuityChecks(projectRoot);
      const ordered = orderContinuityIssues(rows);
      setContinuityIssues(ordered);
      setSelectedContinuityIssueId((previous) => {
        if (previous && ordered.some((item) => item.id === previous)) {
          return previous;
        }
        return ordered[0]?.id ?? "";
      });
      if (ordered.length === 0) {
        setMessage("No continuity issues found.");
      } else {
        const issueLabel = ordered.length === 1 ? "issue" : "issues";
        setMessage(`Continuity check found ${ordered.length} ${issueLabel}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleOpenSceneFromOutliner(sceneId: string) {
    setCenterView("editor");
    setSelectedSceneId(sceneId);
    setMessage(`Loaded ${sceneId} in editor.`);
    setError("");
  }

  function handleOpenIssueScene() {
    if (!selectedContinuityIssue) return;
    if (!scenes.some((item) => item.id === selectedContinuityIssue.scene_id)) {
      setError(`Scene '${selectedContinuityIssue.scene_id}' no longer exists in this project.`);
      return;
    }
    setCenterView("editor");
    setError("");
    setSelectedSceneId(selectedContinuityIssue.scene_id);
    setMessage(`Loaded ${selectedContinuityIssue.scene_id} in editor.`);
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>openAuthor</h1>
          <p>Binder + Editor/Outliner + Proposal/Context/Codex/Checks desktop shell</p>
        </div>
        <div className={`status-pill ${projectFound ? "ok" : "warn"}`}>
          {projectFound ? "Project Ready" : "No Project"}
        </div>
      </header>

      <section className="project-bar">
        <label>
          <span>Project Root</span>
          <input
            value={projectRoot}
            onChange={(event) => setProjectRoot(event.target.value)}
            placeholder="/path/to/project"
          />
        </label>
        <button disabled={busy} onClick={checkProjectAndLoad}>
          Reload Project
        </button>
      </section>

      <section className="canvas">
        <aside className="binder">
          <div className="binder-header">
            <h2>Binder</h2>
            <span>{scenes.length} scenes</span>
          </div>

          <div className="new-scene-card">
            <h3>New Scene</h3>
            <input
              value={addForm.title}
              onChange={(event) =>
                setAddForm((prev) => ({ ...prev, title: event.target.value }))
              }
              placeholder="Scene title"
            />
            <input
              value={addForm.summary}
              onChange={(event) =>
                setAddForm((prev) => ({ ...prev, summary: event.target.value }))
              }
              placeholder="Summary"
            />
            <div className="row">
              <input
                value={addForm.pov}
                onChange={(event) =>
                  setAddForm((prev) => ({ ...prev, pov: event.target.value }))
                }
                placeholder="POV"
              />
              <select
                value={addForm.status}
                onChange={(event) =>
                  setAddForm((prev) => ({ ...prev, status: event.target.value }))
                }
              >
                <option value="draft">draft</option>
                <option value="revised">revised</option>
                <option value="final">final</option>
              </select>
            </div>
            <button disabled={busy || addForm.title.trim() === ""} onClick={handleCreateScene}>
              Add Scene
            </button>
          </div>

          <div className="scene-list">
            {scenes.map((item) => (
              <button
                key={item.id}
                className={`scene-item ${item.id === selectedSceneId ? "selected" : ""}`}
                onClick={() => setSelectedSceneId(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.id}</span>
                <em>{item.status}</em>
              </button>
            ))}
          </div>
        </aside>

        <section className="editor">
          <div className="editor-header">
            <div className="center-tabs">
              <button
                className={centerView === "editor" ? "active" : ""}
                onClick={() => setCenterView("editor")}
              >
                Editor
              </button>
              <button
                className={centerView === "outliner" ? "active" : ""}
                onClick={() => setCenterView("outliner")}
              >
                Outliner
              </button>
            </div>
            {centerView === "editor" ? (
              <button
                className="save-scene-btn"
                disabled={busy || !canSaveScene}
                onClick={handleSaveScene}
              >
                Save Scene
              </button>
            ) : (
              <span className="outliner-count">{outlinerRows.length} scenes shown</span>
            )}
          </div>

          {centerView === "editor" ? (
            !scene ? (
              <div className="empty-state">
                <p>Select a scene from the Binder to edit.</p>
              </div>
            ) : (
              <div className="editor-form">
                <div className="meta-grid">
                  <label>
                    <span>Title</span>
                    <input
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, title: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, status: event.target.value }))
                      }
                    >
                      <option value="draft">draft</option>
                      <option value="revised">revised</option>
                      <option value="final">final</option>
                    </select>
                  </label>
                  <label>
                    <span>POV</span>
                    <input
                      value={draft.pov}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, pov: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>Summary</span>
                    <input
                      value={draft.summary}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, summary: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <label>
                  <span>Body</span>
                  <textarea
                    value={draft.body}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, body: event.target.value }))
                    }
                  />
                </label>

                <div className="meta-row">
                  <code>{scene.path}</code>
                  <span>Updated: {scene.updated_at || "n/a"}</span>
                </div>
              </div>
            )
          ) : (
            <div className="outliner-view">
              <div className="outliner-controls">
                <input
                  value={outlinerQuery}
                  onChange={(event) => setOutlinerQuery(event.target.value)}
                  placeholder="Search title, summary, POV, id"
                />
                <select
                  value={outlinerStatusFilter}
                  onChange={(event) =>
                    setOutlinerStatusFilter(event.target.value as OutlinerStatusFilter)
                  }
                >
                  <option value="all">all statuses</option>
                  <option value="draft">draft</option>
                  <option value="revised">revised</option>
                  <option value="final">final</option>
                </select>
              </div>

              <div className="outliner-summary">
                <span>Draft: {sceneStatusCounts.draft}</span>
                <span>Revised: {sceneStatusCounts.revised}</span>
                <span>Final: {sceneStatusCounts.final}</span>
                <span>Other: {sceneStatusCounts.other}</span>
              </div>

              <div className="outliner-list">
                {outlinerRows.length === 0 ? (
                  <div className="empty-state">
                    <p>No scenes match the current filter.</p>
                  </div>
                ) : (
                  outlinerRows.map((item) => {
                    const updatedLabel = item.updated_at
                      ? new Date(item.updated_at).toLocaleString()
                      : "n/a";
                    return (
                      <article
                        key={item.id}
                        className={`outline-card ${item.id === selectedSceneId ? "selected" : ""}`}
                      >
                        <div className="outline-top">
                          <strong>{item.title}</strong>
                          <em>{item.status}</em>
                        </div>
                        <p>{item.summary || "No summary yet."}</p>
                        <div className="outline-meta">
                          <span>{item.id}</span>
                          <span>POV: {item.pov || "n/a"}</span>
                          <span>Updated: {updatedLabel}</span>
                        </div>
                        <div className="outline-actions">
                          <button
                            disabled={busy}
                            onClick={() => handleOpenSceneFromOutliner(item.id)}
                          >
                            Open In Editor
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="side-pane">
          <div className="side-tabs">
            <button
              className={rightTab === "proposals" ? "active" : ""}
              onClick={() => setRightTab("proposals")}
            >
              Proposals
            </button>
            <button
              className={rightTab === "codex" ? "active" : ""}
              onClick={() => setRightTab("codex")}
            >
              Codex
            </button>
            <button
              className={rightTab === "checks" ? "active" : ""}
              onClick={() => setRightTab("checks")}
            >
              Checks
            </button>
            <button
              className={rightTab === "context" ? "active" : ""}
              onClick={() => setRightTab("context")}
            >
              Context
            </button>
          </div>

          {rightTab === "proposals" ? (
            <div className="side-content context-content">
              <div className="proposal-header">
                <h2>Proposals</h2>
                <span>
                  {proposalCounts.pending} pending / {proposalCounts.applied} applied /{" "}
                  {proposalCounts.rejected} rejected
                </span>
              </div>

              <div className="new-proposal-card">
                <h3>New Proposal</h3>
                <input
                  value={proposalForm.title}
                  onChange={(event) =>
                    setProposalForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Proposal title"
                />
                <textarea
                  className="proposal-instruction"
                  value={proposalForm.instruction}
                  onChange={(event) =>
                    setProposalForm((prev) => ({
                      ...prev,
                      instruction: event.target.value
                    }))
                  }
                  placeholder="Instruction"
                />
                <input
                  value={proposalForm.sceneId}
                  onChange={(event) =>
                    setProposalForm((prev) => ({ ...prev, sceneId: event.target.value }))
                  }
                  placeholder="Scene id (optional)"
                />
                <button
                  disabled={
                    busy ||
                    proposalForm.title.trim() === "" ||
                    proposalForm.instruction.trim() === ""
                  }
                  onClick={handleCreateProposal}
                >
                  Add Proposal
                </button>
              </div>

              <div className="proposal-list">
                {proposals.map((item) => (
                  <button
                    key={item.id}
                    className={`proposal-item ${item.id === selectedProposalId ? "selected" : ""} status-${item.status}`}
                    onClick={() => setSelectedProposalId(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.scene_id || "global"}</span>
                    <em>{item.status}</em>
                  </button>
                ))}
              </div>

              {selectedProposal ? (
                <div className="proposal-review">
                  <h3>Review</h3>
                  <p className="proposal-title">{selectedProposal.title}</p>
                  <p className="proposal-body">{selectedProposal.instruction}</p>
                  <p className="proposal-meta">
                    {selectedProposal.scene_id
                      ? `Scene: ${selectedProposal.scene_id}`
                      : "Scene: n/a"}
                  </p>
                  <div className="proposal-actions">
                    <button
                      disabled={busy || selectedProposal.status !== "pending"}
                      onClick={() => handleApplyProposal(selectedProposal.id)}
                    >
                      Apply
                    </button>
                    <button
                      className="reject-btn"
                      disabled={busy || selectedProposal.status !== "pending"}
                      onClick={() => handleRejectProposal(selectedProposal.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div className="proposal-review empty-review">
                  <p>Select a proposal to review.</p>
                </div>
              )}
            </div>
          ) : rightTab === "codex" ? (
            <div className="side-content">
              <div className="codex-header">
                <h2>Codex</h2>
                <span>{codexEntities.length} entities</span>
              </div>

              <div className="new-codex-card">
                <h3>New Entity</h3>
                <div className="row">
                  <select
                    value={codexForm.type}
                    onChange={(event) =>
                      setCodexForm((prev) => ({
                        ...prev,
                        type: event.target.value as CodexEntity["type"]
                      }))
                    }
                  >
                    <option value="character">character</option>
                    <option value="location">location</option>
                    <option value="lore">lore</option>
                    <option value="item">item</option>
                    <option value="faction">faction</option>
                    <option value="event">event</option>
                  </select>
                  <input
                    value={codexForm.name}
                    onChange={(event) =>
                      setCodexForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Name"
                  />
                </div>
                <textarea
                  className="codex-description-input"
                  value={codexForm.description}
                  onChange={(event) =>
                    setCodexForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="Description"
                />
                <button
                  disabled={busy || codexForm.name.trim() === ""}
                  onClick={handleCreateCodex}
                >
                  Add Entity
                </button>
              </div>

              <div className="codex-list">
                {codexEntities.map((entity) => (
                  <button
                    key={entity.id}
                    className={`codex-item ${entity.id === selectedCodexEntityId ? "selected" : ""}`}
                    onClick={() => setSelectedCodexEntityId(entity.id)}
                  >
                    <strong>{entity.name}</strong>
                    <span>{entity.type}</span>
                  </button>
                ))}
              </div>

              {selectedCodexEntityId ? (
                <div className="codex-edit-card">
                  <h3>Edit Entity</h3>
                  <div className="row">
                    <select
                      value={codexDraft.type}
                      onChange={(event) =>
                        setCodexDraft((prev) => ({
                          ...prev,
                          type: event.target.value as CodexEntity["type"]
                        }))
                      }
                    >
                      <option value="character">character</option>
                      <option value="location">location</option>
                      <option value="lore">lore</option>
                      <option value="item">item</option>
                      <option value="faction">faction</option>
                      <option value="event">event</option>
                    </select>
                    <input
                      value={codexDraft.name}
                      onChange={(event) =>
                        setCodexDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                    />
                  </div>
                  <textarea
                    className="codex-description-input"
                    value={codexDraft.description}
                    onChange={(event) =>
                      setCodexDraft((prev) => ({
                        ...prev,
                        description: event.target.value
                      }))
                    }
                  />
                  <button disabled={busy || !canSaveCodex} onClick={handleSaveCodex}>
                    Save Entity
                  </button>
                </div>
              ) : (
                <div className="codex-edit-card empty-review">
                  <p>Select a codex entity to edit.</p>
                </div>
              )}
            </div>
          ) : rightTab === "checks" ? (
            <div className="side-content">
              <div className="checks-header">
                <h2>Checks</h2>
                <span>
                  {continuityCounts.error} error / {continuityCounts.warning} warning /{" "}
                  {continuityCounts.info} info
                </span>
              </div>

              <div className="checks-actions">
                <button disabled={busy || !projectFound} onClick={handleRunContinuityChecks}>
                  Run Continuity Check
                </button>
              </div>

              <div className="checks-list">
                {continuityIssues.length === 0 ? (
                  <div className="check-detail empty-review">
                    <p>Run checks to surface continuity risks.</p>
                  </div>
                ) : (
                  continuityIssues.map((issue) => (
                    <button
                      key={issue.id}
                      className={`check-item ${issue.id === selectedContinuityIssueId ? "selected" : ""} severity-${issue.severity}`}
                      onClick={() => setSelectedContinuityIssueId(issue.id)}
                    >
                      <strong>{issue.title}</strong>
                      <span>{issue.scene_id}</span>
                      <em>{issue.severity}</em>
                    </button>
                  ))
                )}
              </div>

              {selectedContinuityIssue ? (
                <div className="check-detail">
                  <h3>{selectedContinuityIssue.title}</h3>
                  <p className="check-detail-code">{selectedContinuityIssue.code}</p>
                  <p className="check-detail-message">{selectedContinuityIssue.message}</p>
                  <p className="check-detail-path">{selectedContinuityIssue.path}</p>
                  <div className="proposal-actions">
                    <button disabled={busy || !canOpenSelectedIssueScene} onClick={handleOpenIssueScene}>
                      Open Scene
                    </button>
                  </div>
                </div>
              ) : (
                <div className="check-detail empty-review">
                  <p>Select a check issue to inspect.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="side-content">
              <div className="context-header">
                <h2>Context Lens</h2>
                <span>{scene ? scene.id : "No scene selected"}</span>
              </div>

              {!scene ? (
                <div className="context-card empty-review">
                  <p>Select a scene to inspect context.</p>
                </div>
              ) : (
                <>
                  <div className="context-card">
                    <h3>Scene Snapshot</h3>
                    <p className="context-main">{scene.title}</p>
                    <p className="context-sub">POV: {scene.pov || "n/a"}</p>
                    <p className="context-sub">Status: {scene.status}</p>
                    <p className="context-sub">{scene.summary || "No summary yet."}</p>
                  </div>

                  <div className="context-card">
                    <h3>Proposal Context</h3>
                    <p className="context-sub">
                      {contextProposalCounts.pending} pending / {contextProposalCounts.applied} applied
                      / {contextProposalCounts.rejected} rejected
                    </p>
                    <div className="context-list">
                      {contextProposals.length === 0 ? (
                        <p className="context-sub">No proposals for this scene.</p>
                      ) : (
                        contextProposals.slice(0, 4).map((item) => (
                          <div key={item.id} className="context-list-item">
                            <strong>{item.title}</strong>
                            <span>{item.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="context-card">
                    <h3>Continuity Context</h3>
                    <p className="context-sub">
                      {contextContinuityCounts.error} error / {contextContinuityCounts.warning} warning
                      / {contextContinuityCounts.info} info
                    </p>
                    {continuityIssues.length === 0 ? (
                      <p className="context-sub">Run checks to populate scene-level risks.</p>
                    ) : contextContinuityIssues.length === 0 ? (
                      <p className="context-sub">No continuity issues detected for this scene.</p>
                    ) : (
                      <div className="context-list">
                        {contextContinuityIssues.slice(0, 4).map((item) => (
                          <div key={item.id} className="context-list-item">
                            <strong>{item.title}</strong>
                            <span>{item.severity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="context-actions">
                      <button disabled={busy} onClick={() => setRightTab("checks")}>
                        Open Checks Tab
                      </button>
                    </div>
                  </div>

                  <div className="context-card">
                    <h3>Codex Context</h3>
                    <p className="context-sub">
                      {povCharacterEntity
                        ? `POV matched to character '${povCharacterEntity.name}'.`
                        : "POV has no exact character match in codex."}
                    </p>
                    {povCharacterEntity ? (
                      <p className="context-sub">{povCharacterEntity.description || "No description."}</p>
                    ) : null}
                    <div className="context-actions">
                      <button disabled={busy} onClick={() => setRightTab("codex")}>
                        Open Codex Tab
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </aside>
      </section>

      <footer className="message-bar">
        {error ? <p className="error">{error}</p> : null}
        {message ? <p>{message}</p> : null}
      </footer>
    </main>
  );
}
