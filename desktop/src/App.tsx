import { useEffect, useMemo, useState } from "react";
import {
  addScene,
  applyProposal,
  createProposal,
  getProjectStatus,
  getScene,
  listProposals,
  listScenes,
  rejectProposal,
  updateScene
} from "./api";
import { countProposals, orderProposalsForReview } from "./state";
import type { ProposalRecord, SceneDetail, SceneSummary } from "./types";

const DEFAULT_ROOT = ".";

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

export function App() {
  const [projectRoot, setProjectRoot] = useState(DEFAULT_ROOT);
  const [projectFound, setProjectFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [draft, setDraft] = useState<DraftScene>(EMPTY_DRAFT_SCENE);
  const [addForm, setAddForm] = useState<DraftScene>(EMPTY_DRAFT_SCENE);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [proposalForm, setProposalForm] = useState<DraftProposal>(EMPTY_DRAFT_PROPOSAL);
  const [selectedProposalId, setSelectedProposalId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canSaveScene = useMemo(() => {
    return Boolean(selectedSceneId && draft.title.trim() !== "");
  }, [selectedSceneId, draft.title]);

  const proposalCounts = useMemo(() => countProposals(proposals), [proposals]);

  const selectedProposal = useMemo(
    () => proposals.find((item) => item.id === selectedProposalId) ?? null,
    [proposals, selectedProposalId]
  );

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
        return;
      }
      await Promise.all([refreshSceneList(), refreshProposalList()]);
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

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>openAuthor</h1>
          <p>Binder + Editor + Proposal Review desktop shell</p>
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
            <h2>Editor</h2>
            <button disabled={busy || !canSaveScene} onClick={handleSaveScene}>
              Save Scene
            </button>
          </div>

          {!scene ? (
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
          )}
        </section>

        <aside className="proposal-pane">
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
                setProposalForm((prev) => ({ ...prev, instruction: event.target.value }))
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
                {selectedProposal.scene_id ? `Scene: ${selectedProposal.scene_id}` : "Scene: n/a"}
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
        </aside>
      </section>

      <footer className="message-bar">
        {error ? <p className="error">{error}</p> : null}
        {message ? <p>{message}</p> : null}
      </footer>
    </main>
  );
}
