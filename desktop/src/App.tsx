import { useEffect, useMemo, useState } from "react";
import {
  addCodexEntity,
  addScene,
  applyProposal,
  createProposal,
  generateProposal,
  getGenerationRun,
  getGenerationRuntimeConfig,
  getCodexEntity,
  getProjectStatus,
  getScene,
  listCodexEntities,
  listGenerationRuns,
  listProposals,
  listScenes,
  rejectProposal,
  rerunGeneration,
  runContinuityChecks,
  updateCodexEntity,
  updateScene
} from "./api";
import {
  continuityIssuesForScene,
  countGenerationRuns,
  countContinuityIssues,
  countProposals,
  countSceneStatuses,
  orderGenerationRuns,
  orderScenesForOutline,
  orderCodexEntities,
  orderContinuityIssues,
  orderProposalsForReview,
  proposalsForScene
} from "./state";
import {
  EMPTY_RERUN_DRAFT,
  buildRerunPayload,
  draftRerunFromRun,
  type RerunDraft
} from "./rerun";
import { formatRunLogJson, generationRunLogFilename } from "./runLog";
import {
  buildRunComparison,
  formatNumericDelta,
  formatRunComparisonJson,
  formatRunComparisonMarkdown,
  pickPreviousRunId,
  runComparisonBaseFilename
} from "./runCompare";
import type {
  CodexEntity,
  ContinuityIssue,
  GenerationRunDetail,
  GenerationRuntimeConfig,
  GenerationRunSummary,
  ProposalProvider,
  ProposalRecord,
  SceneDetail,
  SceneSummary
} from "./types";

const PROJECT_ROOT_STORAGE_KEY = "openauthor.projectRoot";

function loadDefaultRoot(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PROJECT_ROOT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

type RightTab = "proposals" | "codex" | "checks" | "context" | "runs";
type CenterView = "editor" | "outliner";
type OutlinerStatusFilter = "all" | "draft" | "revised" | "final";
type GenerationStatusFilter = "all" | "succeeded" | "failed";
type GenerationQualityFilter = "all" | "high" | "medium" | "low";
type GenerationProviderFilter = "all" | ProposalProvider;

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

type DraftGeneratedProposal = {
  title: string;
  instruction: string;
  sceneId: string;
  provider: ProposalProvider;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  contextScenes: number;
  codexLimit: number;
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

const EMPTY_DRAFT_GENERATED_PROPOSAL: DraftGeneratedProposal = {
  title: "",
  instruction: "",
  sceneId: "",
  provider: "local",
  model: "",
  temperature: 0.2,
  maxOutputTokens: 700,
  contextScenes: 1,
  codexLimit: 20
};

const PROVIDER_MODEL_HINTS: Record<ProposalProvider, string> = {
  local: "heuristic-v1",
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-haiku-latest"
};

const EMPTY_DRAFT_CODEX: DraftCodex = {
  type: "character",
  name: "",
  description: ""
};

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (copied) return;
  }
  throw new Error("Clipboard is unavailable in this environment.");
}

function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8"
): void {
  if (typeof document === "undefined") {
    throw new Error("Download is unavailable in this environment.");
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function App() {
  const [projectRoot, setProjectRoot] = useState(loadDefaultRoot);
  const [projectFound, setProjectFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("proposals");
  const [centerView, setCenterView] = useState<CenterView>("editor");
  const [outlinerQuery, setOutlinerQuery] = useState("");
  const [outlinerStatusFilter, setOutlinerStatusFilter] =
    useState<OutlinerStatusFilter>("all");
  const [generationStatusFilter, setGenerationStatusFilter] =
    useState<GenerationStatusFilter>("all");
  const [generationQualityFilter, setGenerationQualityFilter] =
    useState<GenerationQualityFilter>("all");
  const [generationProviderFilter, setGenerationProviderFilter] =
    useState<GenerationProviderFilter>("all");

  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [draft, setDraft] = useState<DraftScene>(EMPTY_DRAFT_SCENE);
  const [addForm, setAddForm] = useState<DraftScene>(EMPTY_DRAFT_SCENE);

  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [proposalForm, setProposalForm] = useState<DraftProposal>(EMPTY_DRAFT_PROPOSAL);
  const [proposalGenerateForm, setProposalGenerateForm] = useState<DraftGeneratedProposal>(
    EMPTY_DRAFT_GENERATED_PROPOSAL
  );
  const [selectedProposalId, setSelectedProposalId] = useState<string>("");

  const [codexEntities, setCodexEntities] = useState<CodexEntity[]>([]);
  const [codexForm, setCodexForm] = useState<DraftCodex>(EMPTY_DRAFT_CODEX);
  const [selectedCodexEntityId, setSelectedCodexEntityId] = useState<string>("");
  const [codexDraft, setCodexDraft] = useState<DraftCodex>(EMPTY_DRAFT_CODEX);

  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [selectedContinuityIssueId, setSelectedContinuityIssueId] = useState<string>("");
  const [generationRuns, setGenerationRuns] = useState<GenerationRunSummary[]>([]);
  const [selectedGenerationRunId, setSelectedGenerationRunId] = useState<string>("");
  const [selectedGenerationRun, setSelectedGenerationRun] =
    useState<GenerationRunDetail | null>(null);
  const [comparisonSceneRuns, setComparisonSceneRuns] = useState<GenerationRunSummary[]>(
    []
  );
  const [comparisonBaselineRunId, setComparisonBaselineRunId] = useState<string>("");
  const [comparisonBaselineRun, setComparisonBaselineRun] =
    useState<GenerationRunDetail | null>(null);
  const [generationRuntimeConfig, setGenerationRuntimeConfig] =
    useState<GenerationRuntimeConfig | null>(null);
  const [rerunDraft, setRerunDraft] = useState<RerunDraft>(EMPTY_RERUN_DRAFT);

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
  const generationRunCounts = useMemo(
    () => countGenerationRuns(generationRuns),
    [generationRuns]
  );
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
  const runComparison = useMemo(() => {
    if (!selectedGenerationRun || !comparisonBaselineRun) return null;
    return buildRunComparison(comparisonBaselineRun, selectedGenerationRun);
  }, [selectedGenerationRun, comparisonBaselineRun]);
  const comparisonCandidateRuns = useMemo(() => {
    if (!selectedGenerationRun) return [];
    return comparisonSceneRuns.filter(
      (row) => row.run_id !== selectedGenerationRun.run_id
    );
  }, [comparisonSceneRuns, selectedGenerationRun]);
  const previousComparisonRunId = useMemo(() => {
    if (!selectedGenerationRun) return null;
    return pickPreviousRunId(
      comparisonSceneRuns.map((row) => row.run_id),
      selectedGenerationRun.run_id
    );
  }, [comparisonSceneRuns, selectedGenerationRun]);
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

  async function refreshGenerationRuns(nextSelectedRunId?: string) {
    const status =
      generationStatusFilter === "all" ? undefined : generationStatusFilter;
    const quality =
      generationQualityFilter === "all" ? undefined : generationQualityFilter;
    const provider =
      generationProviderFilter === "all" ? undefined : generationProviderFilter;
    const rows = await listGenerationRuns(projectRoot, {
      status,
      quality,
      provider,
      limit: 50
    });
    const ordered = orderGenerationRuns(rows);
    setGenerationRuns(ordered);
    if (ordered.length === 0) {
      setSelectedGenerationRunId("");
      setSelectedGenerationRun(null);
      return;
    }
    const target =
      nextSelectedRunId && ordered.some((item) => item.run_id === nextSelectedRunId)
        ? nextSelectedRunId
        : selectedGenerationRunId &&
            ordered.some((item) => item.run_id === selectedGenerationRunId)
          ? selectedGenerationRunId
          : ordered[0].run_id;
    setSelectedGenerationRunId(target);
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

  async function loadSelectedGenerationRun(runId: string) {
    const row = await getGenerationRun(projectRoot, runId);
    setSelectedGenerationRun(row);
  }

  async function refreshGenerationRuntimeConfig() {
    const row = await getGenerationRuntimeConfig(projectRoot);
    setGenerationRuntimeConfig(row);
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
        setProposalForm(EMPTY_DRAFT_PROPOSAL);
        setProposalGenerateForm(EMPTY_DRAFT_GENERATED_PROPOSAL);
        setSelectedProposalId("");
        setCodexEntities([]);
        setSelectedCodexEntityId("");
        setCodexDraft(EMPTY_DRAFT_CODEX);
        setContinuityIssues([]);
        setSelectedContinuityIssueId("");
        setGenerationRuns([]);
        setSelectedGenerationRunId("");
        setSelectedGenerationRun(null);
        setGenerationRuntimeConfig(null);
        return;
      }
      await Promise.all([
        refreshSceneList(),
        refreshProposalList(),
        refreshCodexList(),
        refreshGenerationRuns(),
        refreshGenerationRuntimeConfig()
      ]);
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
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PROJECT_ROOT_STORAGE_KEY, projectRoot);
    } catch {
      // Ignore storage errors; path editing still works.
    }
  }, [projectRoot]);

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
    setProposalGenerateForm((prev) => ({
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

  useEffect(() => {
    if (projectFound !== true) return;
    setBusy(true);
    setError("");
    setMessage("");
    void refreshGenerationRuns()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationStatusFilter, generationQualityFilter, generationProviderFilter]);

  useEffect(() => {
    if (!selectedGenerationRunId) return;
    setBusy(true);
    setError("");
    setMessage("");
    void loadSelectedGenerationRun(selectedGenerationRunId)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGenerationRunId]);

  useEffect(() => {
    if (!selectedGenerationRun) {
      setRerunDraft(EMPTY_RERUN_DRAFT);
      setComparisonSceneRuns([]);
      setComparisonBaselineRunId("");
      setComparisonBaselineRun(null);
      return;
    }
    setRerunDraft(draftRerunFromRun(selectedGenerationRun));
    setComparisonBaselineRunId("");
    setComparisonBaselineRun(null);
    let cancelled = false;
    void listGenerationRuns(projectRoot, {
      sceneId: selectedGenerationRun.scene_id,
      limit: 100
    })
      .then((rows) => {
        if (cancelled) return;
        setComparisonSceneRuns(orderGenerationRuns(rows));
      })
      .catch((err) => {
        if (cancelled) return;
        setComparisonSceneRuns([]);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, selectedGenerationRun]);

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

  async function handleSelectComparisonBaseline(runId: string) {
    if (!selectedGenerationRun) return;
    if (!runId) {
      setComparisonBaselineRunId("");
      setComparisonBaselineRun(null);
      setMessage("Comparison cleared.");
      setError("");
      return;
    }
    if (runId === selectedGenerationRun.run_id) {
      setError("Pick a different run as baseline.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const baseline = await getGenerationRun(projectRoot, runId);
      setComparisonBaselineRunId(runId);
      setComparisonBaselineRun(baseline);
      setMessage(`Comparing ${selectedGenerationRun.run_id} against ${runId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCompareToPreviousGenerationRun() {
    if (!selectedGenerationRun?.scene_id) return;
    const previousId = previousComparisonRunId;
    if (!previousId) {
      setComparisonBaselineRunId("");
      setComparisonBaselineRun(null);
      setMessage("No previous run found for this scene.");
      setError("");
      return;
    }
    await handleSelectComparisonBaseline(previousId);
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

  async function handleGenerateProposal() {
    if (proposalGenerateForm.instruction.trim() === "") return;
    const sceneId = proposalGenerateForm.sceneId || selectedSceneId;
    if (!sceneId) {
      setError("Select a scene (or enter a scene id) before generating a proposal.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const generated = await generateProposal(projectRoot, {
        sceneId,
        instruction: proposalGenerateForm.instruction,
        provider: proposalGenerateForm.provider,
        title: proposalGenerateForm.title,
        model: proposalGenerateForm.model,
        temperature: proposalGenerateForm.temperature,
        maxOutputTokens: proposalGenerateForm.maxOutputTokens,
        contextScenes: proposalGenerateForm.contextScenes,
        codexLimit: proposalGenerateForm.codexLimit
      });
      await refreshProposalList(generated.id);
      const generatedRunId = generated.generation?.id;
      if (generatedRunId) {
        await refreshGenerationRuns(generatedRunId);
      }
      setProposalGenerateForm((prev) => ({
        ...prev,
        title: "",
        instruction: "",
        sceneId
      }));
      const providerLabel = generated.generation?.provider ?? proposalGenerateForm.provider;
      const modelLabel = generated.generation?.model ?? "default";
      setMessage(`Proposal generated via ${providerLabel}/${modelLabel}.`);
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

  function handleOpenGenerationScene(sceneId: string) {
    if (!sceneId) return;
    if (!scenes.some((item) => item.id === sceneId)) {
      setError(`Scene '${sceneId}' no longer exists in this project.`);
      return;
    }
    setCenterView("editor");
    setSelectedSceneId(sceneId);
    setMessage(`Loaded ${sceneId} in editor.`);
    setError("");
  }

  async function handleOpenGenerationProposal(proposalId: string) {
    if (!proposalId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await refreshProposalList(proposalId);
      setRightTab("proposals");
      setSelectedProposalId(proposalId);
      setMessage(`Loaded ${proposalId} in proposals.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRerunGeneration() {
    if (!selectedGenerationRun) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const regenerated = await rerunGeneration(
        projectRoot,
        buildRerunPayload(selectedGenerationRun.run_id, rerunDraft)
      );
      await refreshProposalList(regenerated.id);
      const rerunRunId = regenerated.generation?.id;
      if (rerunRunId) {
        await refreshGenerationRuns(rerunRunId);
      }
      setRightTab("proposals");
      setSelectedProposalId(regenerated.id);
      const providerLabel = regenerated.generation?.provider ?? "unknown";
      const modelLabel = regenerated.generation?.model ?? "default";
      setMessage(`Re-ran generation via ${providerLabel}/${modelLabel}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyGenerationLog() {
    if (!selectedGenerationRun) return;
    setError("");
    setMessage("");
    try {
      const payload = formatRunLogJson(selectedGenerationRun);
      await copyTextToClipboard(payload);
      setMessage(`Copied ${selectedGenerationRun.run_id} log JSON.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDownloadGenerationLog() {
    if (!selectedGenerationRun) return;
    setError("");
    setMessage("");
    try {
      const payload = formatRunLogJson(selectedGenerationRun);
      const filename = generationRunLogFilename(selectedGenerationRun.run_id);
      downloadTextFile(filename, payload, "application/json;charset=utf-8");
      setMessage(`Downloaded ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyRunComparisonJson() {
    if (!runComparison) return;
    setError("");
    setMessage("");
    try {
      const payload = formatRunComparisonJson(runComparison);
      await copyTextToClipboard(payload);
      setMessage("Copied comparison JSON.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyRunComparisonMarkdown() {
    if (!runComparison) return;
    setError("");
    setMessage("");
    try {
      const payload = formatRunComparisonMarkdown(runComparison);
      await copyTextToClipboard(payload);
      setMessage("Copied comparison Markdown.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDownloadRunComparisonJson() {
    if (!runComparison) return;
    setError("");
    setMessage("");
    try {
      const payload = formatRunComparisonJson(runComparison);
      const filename = `${runComparisonBaseFilename(runComparison)}.json`;
      downloadTextFile(filename, payload, "application/json;charset=utf-8");
      setMessage(`Downloaded ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDownloadRunComparisonMarkdown() {
    if (!runComparison) return;
    setError("");
    setMessage("");
    try {
      const payload = formatRunComparisonMarkdown(runComparison);
      const filename = `${runComparisonBaseFilename(runComparison)}.md`;
      downloadTextFile(filename, payload, "text/markdown;charset=utf-8");
      setMessage(`Downloaded ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>openAuthor</h1>
          <p>Binder + Editor/Outliner + Proposal/Runs/Context/Codex/Checks desktop shell</p>
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
            <button
              className={rightTab === "runs" ? "active" : ""}
              onClick={() => setRightTab("runs")}
            >
              Runs
            </button>
          </div>

          {rightTab === "proposals" ? (
            <div className="side-content">
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

              <div className="generate-proposal-card">
                <h3>Generate Proposal</h3>
                <textarea
                  className="proposal-instruction"
                  value={proposalGenerateForm.instruction}
                  onChange={(event) =>
                    setProposalGenerateForm((prev) => ({
                      ...prev,
                      instruction: event.target.value
                    }))
                  }
                  placeholder="What change should the model propose?"
                />
                <div className="row">
                  <input
                    value={proposalGenerateForm.sceneId}
                    onChange={(event) =>
                      setProposalGenerateForm((prev) => ({
                        ...prev,
                        sceneId: event.target.value
                      }))
                    }
                    placeholder="Scene id"
                  />
                  <select
                    value={proposalGenerateForm.provider}
                    onChange={(event) =>
                      setProposalGenerateForm((prev) => ({
                        ...prev,
                        provider: event.target.value as ProposalProvider
                      }))
                    }
                  >
                    <option value="local">local</option>
                    <option value="openai">openai</option>
                    <option value="anthropic">anthropic</option>
                  </select>
                </div>
                <div className="row">
                  <input
                    value={proposalGenerateForm.title}
                    onChange={(event) =>
                      setProposalGenerateForm((prev) => ({
                        ...prev,
                        title: event.target.value
                      }))
                    }
                    placeholder="Optional title override"
                  />
                  <input
                    value={proposalGenerateForm.model}
                    onChange={(event) =>
                      setProposalGenerateForm((prev) => ({
                        ...prev,
                        model: event.target.value
                      }))
                    }
                    placeholder={`Model (default: ${PROVIDER_MODEL_HINTS[proposalGenerateForm.provider]})`}
                  />
                </div>
                <div className="generate-grid">
                  <label>
                    <span>Temperature</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={proposalGenerateForm.temperature}
                      onChange={(event) =>
                        setProposalGenerateForm((prev) => ({
                          ...prev,
                          temperature: Number(event.target.value || 0)
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Max Tokens</span>
                    <input
                      type="number"
                      min="64"
                      value={proposalGenerateForm.maxOutputTokens}
                      onChange={(event) =>
                        setProposalGenerateForm((prev) => ({
                          ...prev,
                          maxOutputTokens: Number(event.target.value || 64)
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Context Scenes</span>
                    <input
                      type="number"
                      min="0"
                      value={proposalGenerateForm.contextScenes}
                      onChange={(event) =>
                        setProposalGenerateForm((prev) => ({
                          ...prev,
                          contextScenes: Number(event.target.value || 0)
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Codex Limit</span>
                    <input
                      type="number"
                      min="1"
                      value={proposalGenerateForm.codexLimit}
                      onChange={(event) =>
                        setProposalGenerateForm((prev) => ({
                          ...prev,
                          codexLimit: Number(event.target.value || 1)
                        }))
                      }
                    />
                  </label>
                </div>
                <button
                  disabled={busy || proposalGenerateForm.instruction.trim() === ""}
                  onClick={handleGenerateProposal}
                >
                  Generate Proposal
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
                  <p className="proposal-meta">
                    Source: {selectedProposal.source ?? "manual"}
                    {selectedProposal.generation
                      ? ` (${selectedProposal.generation.provider}/${selectedProposal.generation.model})`
                      : ""}
                  </p>
                  {selectedProposal.generation ? (
                    <p className="proposal-meta">
                      Usage: in {selectedProposal.generation.input_tokens} / out{" "}
                      {selectedProposal.generation.output_tokens} tokens,{" "}
                      {selectedProposal.generation.latency_ms} ms,{" "}
                      {selectedProposal.generation.provider_attempts} attempt(s)
                      {selectedProposal.generation.estimated_cost_usd !== null
                        ? `, est $${selectedProposal.generation.estimated_cost_usd.toFixed(6)}`
                        : ""}
                    </p>
                  ) : null}
                  {selectedProposal.generation?.log_path ? (
                    <p className="proposal-meta">Log: {selectedProposal.generation.log_path}</p>
                  ) : null}
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
          ) : rightTab === "runs" ? (
            <div className="side-content">
              <div className="runs-header">
                <h2>Runs</h2>
                <span>
                  {generationRunCounts.succeeded} succeeded / {generationRunCounts.failed} failed /{" "}
                  {generationRunCounts.other} other
                </span>
              </div>

              <div className="runs-controls">
                <select
                  value={generationStatusFilter}
                  onChange={(event) =>
                    setGenerationStatusFilter(event.target.value as GenerationStatusFilter)
                  }
                >
                  <option value="all">all statuses</option>
                  <option value="succeeded">succeeded</option>
                  <option value="failed">failed</option>
                </select>
                <select
                  value={generationProviderFilter}
                  onChange={(event) =>
                    setGenerationProviderFilter(event.target.value as GenerationProviderFilter)
                  }
                >
                  <option value="all">all providers</option>
                  <option value="local">local</option>
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                </select>
                <select
                  value={generationQualityFilter}
                  onChange={(event) =>
                    setGenerationQualityFilter(event.target.value as GenerationQualityFilter)
                  }
                >
                  <option value="all">all quality</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
                <button
                  disabled={busy || !projectFound}
                  onClick={() =>
                    void Promise.all([
                      refreshGenerationRuns(),
                      refreshGenerationRuntimeConfig()
                    ])
                  }
                >
                  Refresh Runs
                </button>
              </div>

              <div className="run-config-card">
                <h3>Provider Runtime</h3>
                {generationRuntimeConfig ? (
                  <>
                    <p className="run-meta">
                      Retry: {generationRuntimeConfig.retry.max_retries} max /{" "}
                      {generationRuntimeConfig.retry.base_delay_ms}ms base delay
                    </p>
                    <p className="run-meta">
                      OpenAI key:{" "}
                      {generationRuntimeConfig.providers.openai.credential_present
                        ? "present"
                        : "missing"}
                    </p>
                    <p className="run-meta">
                      Anthropic key:{" "}
                      {generationRuntimeConfig.providers.anthropic.credential_present
                        ? "present"
                        : "missing"}
                    </p>
                  </>
                ) : (
                  <p className="run-meta">Config unavailable.</p>
                )}
              </div>

              <div className="runs-list">
                {generationRuns.length === 0 ? (
                  <div className="run-detail empty-review">
                    <p>No generation runs found for this filter.</p>
                  </div>
                ) : (
                  generationRuns.map((run) => (
                    <button
                      key={run.run_id}
                      className={`run-item ${run.run_id === selectedGenerationRunId ? "selected" : ""} status-${run.status}`}
                      onClick={() => setSelectedGenerationRunId(run.run_id)}
                    >
                      <strong>{run.run_id}</strong>
                      <span>
                        {run.provider || "unknown provider"} / {run.quality_tier || "n/a"}
                      </span>
                      <em>{run.status}</em>
                    </button>
                  ))
                )}
              </div>

              {selectedGenerationRun ? (
                <div className="run-detail">
                  <h3>{selectedGenerationRun.run_id}</h3>
                  <p className="run-meta">
                    {selectedGenerationRun.provider}/{selectedGenerationRun.model}
                  </p>
                  <p className="run-meta">
                    Settings: temp {selectedGenerationRun.temperature ?? "n/a"} / max{" "}
                    {selectedGenerationRun.max_output_tokens ?? "n/a"} / context{" "}
                    {selectedGenerationRun.context_scene_radius ?? "n/a"} / codex{" "}
                    {selectedGenerationRun.codex_limit ?? "n/a"}
                  </p>
                  <p className="run-meta">Scene: {selectedGenerationRun.scene_id || "n/a"}</p>
                  <p className="run-meta">Status: {selectedGenerationRun.status}</p>
                  {selectedGenerationRun.status === "succeeded" ? (
                    <>
                      <p className="run-meta">
                        Usage: in {selectedGenerationRun.usage?.input_tokens ?? "n/a"} / out{" "}
                        {selectedGenerationRun.usage?.output_tokens ?? "n/a"} tokens,{" "}
                        {selectedGenerationRun.usage?.latency_ms ?? "n/a"} ms,{" "}
                        {selectedGenerationRun.usage?.provider_attempts ?? "n/a"} attempt(s)
                        {typeof selectedGenerationRun.usage?.estimated_cost_usd === "number"
                          ? `, est $${selectedGenerationRun.usage.estimated_cost_usd.toFixed(6)}`
                          : ""}
                      </p>
                      <p className="run-meta">Proposal: {selectedGenerationRun.proposal_id || "n/a"}</p>
                      <p className="run-meta">
                        Quality: {selectedGenerationRun.quality?.tier || "n/a"} /{" "}
                        {typeof selectedGenerationRun.quality?.score === "number"
                          ? selectedGenerationRun.quality?.score
                          : "n/a"}
                      </p>
                      {selectedGenerationRun.quality?.flags?.length ? (
                        <p className="run-meta">
                          Quality flags: {selectedGenerationRun.quality.flags.join(", ")}
                        </p>
                      ) : null}
                      <p className="run-meta">
                        Normalization changed:{" "}
                        {selectedGenerationRun.normalization?.normalization_changed
                          ? "yes"
                          : "no"}
                      </p>
                      {selectedGenerationRun.normalization?.missing_sections_filled?.length ? (
                        <p className="run-meta">
                          Filled sections:{" "}
                          {selectedGenerationRun.normalization.missing_sections_filled.join(", ")}
                        </p>
                      ) : null}
                      {selectedGenerationRun.normalization?.detected_headers?.length ? (
                        <p className="run-meta">
                          Detected headers:{" "}
                          {selectedGenerationRun.normalization.detected_headers.join(", ")}
                        </p>
                      ) : null}
                      {selectedGenerationRun.normalized_instruction ? (
                        <p className="run-text">{selectedGenerationRun.normalized_instruction}</p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="run-meta">
                        Error: {selectedGenerationRun.error?.category || "unknown_error"}
                      </p>
                      <p className="run-text">
                        {selectedGenerationRun.error?.message || "No error message."}
                      </p>
                    </>
                  )}
                  <p className="run-meta">Log: {selectedGenerationRun.log_path}</p>
                  <div className="run-rerun-card">
                    <h4>Re-run Options</h4>
                    <label>
                      <span>Title Override</span>
                      <input
                        value={rerunDraft.title}
                        onChange={(event) =>
                          setRerunDraft((prev) => ({ ...prev, title: event.target.value }))
                        }
                        placeholder="Optional proposal title"
                      />
                    </label>
                    <div className="generate-grid">
                      <label>
                        <span>Provider</span>
                        <select
                          value={rerunDraft.provider}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              provider: event.target.value as ProposalProvider
                            }))
                          }
                        >
                          <option value="local">local</option>
                          <option value="openai">openai</option>
                          <option value="anthropic">anthropic</option>
                        </select>
                      </label>
                      <label>
                        <span>Model Override</span>
                        <input
                          value={rerunDraft.model}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({ ...prev, model: event.target.value }))
                          }
                          placeholder={`Model (default: ${PROVIDER_MODEL_HINTS[rerunDraft.provider]})`}
                        />
                      </label>
                      <label>
                        <span>Temperature</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={rerunDraft.temperature}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              temperature: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Max Tokens</span>
                        <input
                          type="number"
                          min="64"
                          value={rerunDraft.maxOutputTokens}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              maxOutputTokens: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Context Scenes</span>
                        <input
                          type="number"
                          min="0"
                          value={rerunDraft.contextScenes}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              contextScenes: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Codex Limit</span>
                        <input
                          type="number"
                          min="1"
                          value={rerunDraft.codexLimit}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              codexLimit: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div className="run-compare-select-card">
                    <h4>Compare Baseline</h4>
                    <label>
                      <span>Baseline Run</span>
                      <select
                        value={comparisonBaselineRunId}
                        onChange={(event) =>
                          void handleSelectComparisonBaseline(event.target.value)
                        }
                      >
                        <option value="">none selected</option>
                        {comparisonCandidateRuns.map((run) => (
                          <option key={run.run_id} value={run.run_id}>
                            {run.run_id} | {run.status} | {run.provider}/{run.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="run-meta">
                      {comparisonCandidateRuns.length} candidate run(s) for this scene
                    </p>
                  </div>
                  <div className="proposal-actions">
                    <button
                      disabled={busy}
                      onClick={() => void handleRerunGeneration()}
                    >
                      Re-run With Settings
                    </button>
                    <button
                      disabled={busy || !selectedGenerationRun.scene_id || !previousComparisonRunId}
                      onClick={() => void handleCompareToPreviousGenerationRun()}
                    >
                      Compare To Previous
                    </button>
                    <button
                      disabled={busy || !comparisonBaselineRun}
                      onClick={() => setComparisonBaselineRun(null)}
                    >
                      Clear Comparison
                    </button>
                    <button disabled={busy} onClick={() => void handleCopyGenerationLog()}>
                      Copy Log JSON
                    </button>
                    <button disabled={busy} onClick={handleDownloadGenerationLog}>
                      Download Log JSON
                    </button>
                    <button
                      disabled={busy || !selectedGenerationRun.scene_id}
                      onClick={() => handleOpenGenerationScene(selectedGenerationRun.scene_id)}
                    >
                      Open Scene
                    </button>
                    <button
                      disabled={busy || !selectedGenerationRun.proposal_id}
                      onClick={() =>
                        void handleOpenGenerationProposal(selectedGenerationRun.proposal_id || "")
                      }
                    >
                      Open Proposal
                    </button>
                  </div>
                  {runComparison ? (
                    <div className="run-compare-card">
                      <h4>Run Comparison</h4>
                      <p className="run-meta">
                        Baseline: {runComparison.baselineRunId} / Current:{" "}
                        {runComparison.currentRunId}
                      </p>
                      <p className="run-meta">
                        Instruction changed: {runComparison.instructionChanged ? "yes" : "no"}
                      </p>
                      <div className="run-compare-grid">
                        <article>
                          <h5>Baseline Instruction</h5>
                          <pre className="run-compare-text">
                            {runComparison.baselineInstruction || "(empty)"}
                          </pre>
                        </article>
                        <article>
                          <h5>Current Instruction</h5>
                          <pre className="run-compare-text">
                            {runComparison.currentInstruction || "(empty)"}
                          </pre>
                        </article>
                      </div>
                      <div className="run-compare-table">
                        <h5>Metric Deltas</h5>
                        {runComparison.metrics.map((row) => (
                          <p key={row.label} className="run-meta">
                            {row.label}: baseline {row.baseline ?? "n/a"} / current{" "}
                            {row.current ?? "n/a"} / delta {formatNumericDelta(row.delta)}
                          </p>
                        ))}
                      </div>
                      <div className="run-compare-table">
                        <h5>Settings</h5>
                        {runComparison.settings.map((row) => (
                          <p key={row.label} className="run-meta">
                            {row.label}: {row.baseline} → {row.current}
                            {row.changed ? " (changed)" : ""}
                          </p>
                        ))}
                      </div>
                      <div className="run-compare-table">
                        <h5>Outcome</h5>
                        {runComparison.outcome.map((row) => (
                          <p key={row.label} className="run-meta">
                            {row.label}: {row.baseline} → {row.current}
                            {row.changed ? " (changed)" : ""}
                          </p>
                        ))}
                      </div>
                      <div className="proposal-actions">
                        <button disabled={busy} onClick={() => void handleCopyRunComparisonJson()}>
                          Copy Comparison JSON
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void handleCopyRunComparisonMarkdown()}
                        >
                          Copy Comparison MD
                        </button>
                        <button disabled={busy} onClick={handleDownloadRunComparisonJson}>
                          Download Comparison JSON
                        </button>
                        <button disabled={busy} onClick={handleDownloadRunComparisonMarkdown}>
                          Download Comparison MD
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="run-detail empty-review">
                  <p>Select a run to inspect details.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="side-content context-content">
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
