import { useEffect, useState } from "react";
import {
  archiveStoryline,
  compareStoryline,
  createStoryline,
  integrateStorylineScenes,
  listStorylines,
  duplicateStoryline,
  renameStoryline,
  restoreStoryline,
  saveStoryline,
  switchStoryline,
  type StorylineComparison,
  type StorylineRecord,
} from "../../api";
import { useUI } from "../../contexts/UIContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";

export function StorylineEditor() {
  const {
    projectRoot,
    refreshScenes,
    refreshCodex,
    refreshProposals,
    refreshBranches,
    setError,
    setMessage,
  } = useWorkspace();
  const { setActiveView } = useUI();
  const [storylines, setStorylines] = useState<StorylineRecord[]>([]);
  const [primaryBranch, setPrimaryBranch] = useState("");
  const [currentBranch, setCurrentBranch] = useState("");
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [scope, setScope] = useState("");
  const [success, setSuccess] = useState("");
  const [constraints, setConstraints] = useState("");
  const [comparison, setComparison] = useState<StorylineComparison | null>(
    null,
  );
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void load();
  }, [projectRoot]);
  async function load() {
    try {
      const data = await listStorylines(projectRoot);
      setStorylines(data.storylines);
      setPrimaryBranch(data.primary_branch);
      setCurrentBranch(data.current_branch);
    } catch (error) {
      setError(
        `Failed to load Storylines: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  async function refreshBook() {
    await Promise.all([
      refreshScenes(),
      refreshCodex(),
      refreshProposals(),
      refreshBranches(),
      load(),
    ]);
  }
  async function mutate(
    action: () => Promise<unknown>,
    message: string,
    refresh = false,
  ) {
    setBusy(true);
    try {
      await action();
      refresh ? await refreshBook() : await load();
      setMessage(message);
    } catch (error) {
      setError(
        `Storyline action failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    await mutate(
      () =>
        createStoryline(projectRoot, {
          name,
          hypothesis,
          scope,
          success,
          protectedConstraints: constraints
            .split("\n")
            .map((row) => row.trim())
            .filter(Boolean),
        }),
      `Entered Storyline “${name}”.`,
      true,
    );
    setName("");
    setHypothesis("");
    setScope("");
    setSuccess("");
    setConstraints("");
  }
  async function compare(row: StorylineRecord) {
    setBusy(true);
    try {
      const result = await compareStoryline(projectRoot, row.id);
      setComparison(result);
      setSelectedPaths(
        result.scenes
          .filter((scene) => scene.prose_changed)
          .map((scene) => scene.path),
      );
      await load();
    } catch (error) {
      setError(
        `Comparison failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  const currentStoryline = storylines.find((row) => row.current);
  return (
    <div
      style={{ height: "100%", overflow: "auto", background: "var(--bg-deep)" }}
    >
      <div
        style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-6)" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "end",
            marginBottom: "var(--space-5)",
          }}
        >
          <div>
            <div style={eyebrow}>Safe creative experiments</div>
            <h1 style={pageTitle}>Storylines</h1>
          </div>
          <span className="badge badge--info">
            {currentStoryline
              ? `Exploring: ${currentStoryline.name}`
              : primaryBranch
                ? "Primary manuscript"
                : "Not initialized"}
          </span>
        </div>
        <section style={panelStyle}>
          <h2 style={sectionTitle}>New Experiment</h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}
          >
            <input
              className="input"
              placeholder="Storyline name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className="input"
              placeholder="Hypothesis: why might this version be stronger?"
              value={hypothesis}
              onChange={(event) => setHypothesis(event.target.value)}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginTop: 8,
            }}
          >
            <input
              className="input"
              placeholder="Intended scope (ending, character arc, chapters…)"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
            <input
              className="input"
              placeholder="Success criteria"
              value={success}
              onChange={(event) => setSuccess(event.target.value)}
            />
          </div>
          <textarea
            className="input"
            rows={2}
            placeholder="Protected constraints, one per line"
            value={constraints}
            onChange={(event) => setConstraints(event.target.value)}
            style={{ marginTop: 8 }}
          />
          <button
            className="btn btn--primary"
            disabled={busy || !name.trim() || !hypothesis.trim()}
            onClick={() => void create()}
            style={{ marginTop: 8 }}
          >
            Start Storyline
          </button>
        </section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "var(--space-4)",
            marginTop: "var(--space-4)",
          }}
        >
          {storylines.map((row) => (
            <article
              key={row.id}
              style={{
                ...panelStyle,
                opacity: row.status === "archived" ? 0.65 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <h2 style={sectionTitle}>{row.name}</h2>
                {row.current && (
                  <span className="badge badge--applied">current</span>
                )}
              </div>
              <p style={valueStyle}>{row.experiment_brief.hypothesis}</p>
              <div style={metaStyle}>
                {row.divergence?.changed_scenes ?? 0} changed scenes ·{" "}
                {row.divergence?.changed_files ?? 0} changed artifacts
              </div>
              {row.experiment_brief.success_criteria && (
                <div style={{ ...metaStyle, marginTop: 6 }}>
                  Success: {row.experiment_brief.success_criteria}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 10,
                }}
              >
                {!row.current && row.status === "active" && (
                  <button
                    className="btn btn--sm"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () => switchStoryline(projectRoot, row.id),
                        `Entered ${row.name}.`,
                        true,
                      )
                    }
                  >
                    Enter
                  </button>
                )}
                {row.current && (
                  <button
                    className="btn btn--sm"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () => saveStoryline(projectRoot, row.id),
                        "Storyline progress saved.",
                      )
                    }
                  >
                    Save Progress
                  </button>
                )}
                <button
                  className="btn btn--sm"
                  disabled={busy || !row.branch_available}
                  onClick={() => void compare(row)}
                >
                  Compare
                </button>
                {row.status === "active" ? (
                  <button
                    className="btn btn--sm"
                    disabled={busy || row.current}
                    onClick={() =>
                      void mutate(
                        () => archiveStoryline(projectRoot, row.id),
                        "Storyline archived.",
                      )
                    }
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    className="btn btn--sm"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () => restoreStoryline(projectRoot, row.id),
                        "Storyline restored.",
                      )
                    }
                  >
                    Restore
                  </button>
                )}
                <button
                  className="btn btn--sm"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        duplicateStoryline(
                          projectRoot,
                          row.id,
                          `${row.name} Copy`,
                        ),
                      "Storyline duplicated.",
                    )
                  }
                >
                  Duplicate
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                <input
                  className="input"
                  aria-label={`Rename ${row.name}`}
                  placeholder="Rename storyline"
                  value={renameDrafts[row.id] ?? ""}
                  onChange={(event) =>
                    setRenameDrafts({
                      ...renameDrafts,
                      [row.id]: event.target.value,
                    })
                  }
                />
                <button
                  className="btn btn--sm"
                  disabled={busy || !(renameDrafts[row.id] ?? "").trim()}
                  onClick={() =>
                    void mutate(
                      () =>
                        renameStoryline(
                          projectRoot,
                          row.id,
                          renameDrafts[row.id],
                        ),
                      "Storyline renamed.",
                      true,
                    )
                  }
                >
                  Rename
                </button>
              </div>
            </article>
          ))}
        </div>
        {currentBranch !== primaryBranch && primaryBranch && (
          <div
            style={{
              ...panelStyle,
              marginTop: "var(--space-4)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <strong style={{ color: "var(--text-primary)" }}>
                You are exploring an alternate Storyline.
              </strong>
              <div style={metaStyle}>
                Switching back saves this experiment first.
              </div>
            </div>
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                void mutate(
                  () => switchStoryline(projectRoot, undefined, true),
                  "Returned to the primary manuscript.",
                  true,
                )
              }
            >
              Return to Primary
            </button>
          </div>
        )}
        {comparison && (
          <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <h2 style={sectionTitle}>
                  Compare: {comparison.storyline.name}
                </h2>
                <div style={metaStyle}>
                  {comparison.categories.scenes} scenes ·{" "}
                  {comparison.categories.story_memory} Memory artifacts ·{" "}
                  {comparison.word_count_delta >= 0 ? "+" : ""}
                  {comparison.word_count_delta} words
                </div>
              </div>
              <button
                className="btn btn--primary"
                disabled={
                  busy ||
                  currentBranch !== primaryBranch ||
                  selectedPaths.length === 0
                }
                onClick={() =>
                  void mutate(
                    async () => {
                      const result = await integrateStorylineScenes(
                        projectRoot,
                        comparison.storyline.id,
                        selectedPaths,
                      );
                      await refreshProposals();
                      setActiveView("proposals");
                      return result;
                    },
                    `${selectedPaths.length} scene Change Set${selectedPaths.length === 1 ? "" : "s"} prepared for review.`,
                  )
                }
              >
                Prepare {selectedPaths.length} Change Set
                {selectedPaths.length === 1 ? "" : "s"}
              </button>
            </div>
            <div
              style={{
                margin: "var(--space-3) 0",
                padding: "var(--space-3)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
              }}
            >
              <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                Experiment impact
              </div>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "var(--text-sm)",
                  margin: "6px 0",
                }}
              >
                {comparison.impact_analysis.after.summary}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(comparison.semantic_delta).flatMap(
                  ([kind, delta]) =>
                    [
                      ...delta.added.map((row) => ({
                        ...row,
                        label: `+ ${row.label}`,
                      })),
                      ...delta.changed.map((row) => ({
                        ...row,
                        label: `~ ${row.label}`,
                      })),
                      ...delta.removed.map((row) => ({
                        ...row,
                        label: `− ${row.label}`,
                      })),
                    ].map((row) => (
                      <span
                        key={`${kind}:${row.id}:${row.label}`}
                        className="badge badge--warning"
                      >
                            {kind.replace(/_/g, " ")}: {row.label}
                      </span>
                    )),
                )}
              </div>
              {comparison.impact_analysis.after.risks.map((risk) => (
                <div
                  key={risk}
                  style={{
                    color: "var(--warning-text)",
                    fontSize: "var(--text-xs)",
                    marginTop: 6,
                  }}
                >
                  ⚠ {risk}
                </div>
              ))}
            </div>
            {currentBranch !== primaryBranch && (
              <p
                style={{
                  color: "var(--warning-text)",
                  fontSize: "var(--text-xs)",
                }}
              >
                Return to Primary before preparing integration Changes.
              </p>
            )}
            {comparison.scenes.map((scene) => (
              <label
                key={scene.path}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 0",
                  borderTop: "1px solid var(--border)",
                  alignItems: "center",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedPaths.includes(scene.path)}
                  disabled={!scene.prose_changed}
                  onChange={(event) =>
                    setSelectedPaths(
                      event.target.checked
                        ? [...selectedPaths, scene.path]
                        : selectedPaths.filter((path) => path !== scene.path),
                    )
                  }
                />
                <span style={{ flex: 1, color: "var(--text-primary)" }}>
                  {scene.title}
                </span>
                <span style={metaStyle}>
                  {scene.status} · {scene.word_count_delta >= 0 ? "+" : ""}
                  {scene.word_count_delta} words
                </span>
              </label>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

const panelStyle = {
  padding: "var(--space-4)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-surface)",
} as const;
const eyebrow = {
  color: "var(--text-tertiary)",
  fontSize: "var(--text-xs)",
  textTransform: "uppercase",
  letterSpacing: ".1em",
} as const;
const pageTitle = {
  color: "var(--text-primary)",
  fontFamily: "var(--font-prose)",
  fontWeight: 500,
  margin: "4px 0 0",
} as const;
const sectionTitle = {
  color: "var(--text-primary)",
  fontSize: "var(--text-lg)",
  margin: 0,
} as const;
const valueStyle = {
  color: "var(--text-secondary)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.45,
} as const;
const metaStyle = {
  color: "var(--text-tertiary)",
  fontSize: "var(--text-xs)",
} as const;
