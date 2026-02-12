import { useEffect, useMemo, useRef, useState } from "react";
import {
  addCodexEntity,
  addScene,
  applyProposal,
  createBranch,
  createProposal,
  diffBranches,
  generateProposal,
  getGenerationBudget,
  getGenerationRun,
  getGenerationRuntimeConfig,
  getCodexEntity,
  getProjectStatus,
  getScene,
  listBranches,
  listCodexEntities,
  listGenerationPins,
  listGenerationRuns,
  listProposals,
  listScenes,
  mergeBranches,
  pinGenerationRun,
  preflightMerge,
  rejectProposal,
  rerunGeneration,
  resetGenerationBudget,
  runContinuityChecks,
  switchBranch,
  unpinGenerationRun,
  updateGenerationBudget,
  updateCodexEntity,
  updateScene
} from "./api";
import {
  continuityIssuesForScene,
  evaluatePreferredPipelineHealth,
  findPreferredProposalForScene,
  countGenerationRuns,
  countContinuityIssues,
  countProposals,
  countSceneStatuses,
  orderGenerationRuns,
  orderScenesForOutline,
  orderCodexEntities,
  orderContinuityIssues,
  orderProposalsForReview,
  selectProposalReviewRows,
  proposalsForScene
} from "./state";
import { resolveShortcutAction } from "./shortcuts";
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
  listRunComparisonProfiles,
  pickPreviousRunId,
  runComparisonBaseFilename,
  runComparisonVerdictLabel,
  type RunComparisonProfileId
} from "./runCompare";
import {
  loadRunComparisonPrefs,
  saveRunComparisonPrefs
} from "./runComparePrefs";
import { mergeGuidanceFromPreflight } from "./merge";
import {
  buildBudgetUpdatePayload,
  draftFromBudgetPolicy,
  EMPTY_BUDGET_DRAFT,
  type GenerationBudgetDraft
} from "./budget";
import { createBrowserVoiceStt } from "./voiceStt";
import { parseVoiceCommand, type VoiceIntent } from "./voice";
import {
  appendVoiceCommandLog,
  clearVoiceCommandLog,
  listVoiceCommandLog,
  type VoiceCommandLogEntry
} from "./voiceLog";
import type {
  BranchDiffReport,
  BranchMergeResult,
  BranchPreflightReport,
  BranchSummary,
  CodexEntity,
  ContinuityIssue,
  GenerationBudgetReport,
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

type RightTab = "proposals" | "codex" | "checks" | "context" | "runs" | "merge";
type CenterView = "editor" | "outliner";
type OutlinerStatusFilter = "all" | "draft" | "revised" | "final";
type GenerationStatusFilter = "all" | "succeeded" | "failed";
type GenerationQualityFilter = "all" | "high" | "medium" | "low";
type GenerationProviderFilter = "all" | ProposalProvider;
type ProposalReviewMode =
  | "all"
  | "scene_priority"
  | "preferred_priority"
  | "preferred_only";
type ProposalReviewStatusFilter = "all" | "pending" | "applied" | "rejected";
type DraftBranchCreate = {
  name: string;
  fromRef: string;
  noSwitch: boolean;
};

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
  retrievalMode: "off" | "auto" | "required";
  retrievalLimit: number;
  retrievalMinScore: number;
  retrievalRequireFresh: boolean;
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
  codexLimit: 20,
  retrievalMode: "auto",
  retrievalLimit: 5,
  retrievalMinScore: 0,
  retrievalRequireFresh: false
};

const PROVIDER_MODEL_HINTS: Record<ProposalProvider, string> = {
  local: "heuristic-v1",
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-haiku-latest"
};

const DEFAULT_LIST_LIMIT = 120;
const LIST_LIMIT_STEP = 120;

const EMPTY_DRAFT_CODEX: DraftCodex = {
  type: "character",
  name: "",
  description: ""
};

const EMPTY_DRAFT_BRANCH_CREATE: DraftBranchCreate = {
  name: "",
  fromRef: "",
  noSwitch: false
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

function toUserErrorMessage(
  err: unknown,
  context: string,
  nextStep?: string
): string {
  const detail =
    err instanceof Error && err.message.trim() !== ""
      ? err.message.trim()
      : "Unexpected error.";
  if (!nextStep) {
    return `${context}: ${detail}`;
  }
  return `${context}: ${detail} ${nextStep}`;
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
  const [sceneListLimit, setSceneListLimit] = useState(DEFAULT_LIST_LIMIT);
  const [proposalListLimit, setProposalListLimit] = useState(DEFAULT_LIST_LIMIT);
  const [runsListLimit, setRunsListLimit] = useState(DEFAULT_LIST_LIMIT);

  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [draft, setDraft] = useState<DraftScene>(EMPTY_DRAFT_SCENE);
  const [addForm, setAddForm] = useState<DraftScene>(EMPTY_DRAFT_SCENE);

  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [proposalReviewMode, setProposalReviewMode] = useState<ProposalReviewMode>("all");
  const [proposalReviewStatusFilter, setProposalReviewStatusFilter] =
    useState<ProposalReviewStatusFilter>("all");
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
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [mergeBaseBranch, setMergeBaseBranch] = useState<string>("");
  const [mergeHeadBranch, setMergeHeadBranch] = useState<string>("");
  const [branchCreateDraft, setBranchCreateDraft] =
    useState<DraftBranchCreate>(EMPTY_DRAFT_BRANCH_CREATE);
  const [branchDiffReport, setBranchDiffReport] = useState<BranchDiffReport | null>(null);
  const [branchPreflightReport, setBranchPreflightReport] =
    useState<BranchPreflightReport | null>(null);
  const [branchMergeResult, setBranchMergeResult] = useState<BranchMergeResult | null>(
    null
  );
  const [generationRuns, setGenerationRuns] = useState<GenerationRunSummary[]>([]);
  const [generationPins, setGenerationPins] = useState<Record<string, string>>({});
  const [selectedGenerationRunId, setSelectedGenerationRunId] = useState<string>("");
  const [selectedGenerationRun, setSelectedGenerationRun] =
    useState<GenerationRunDetail | null>(null);
  const [comparisonSceneRuns, setComparisonSceneRuns] = useState<GenerationRunSummary[]>(
    []
  );
  const [comparisonBaselineRunId, setComparisonBaselineRunId] = useState<string>("");
  const [comparisonProfileId, setComparisonProfileId] =
    useState<RunComparisonProfileId>(
      () => loadRunComparisonPrefs(loadDefaultRoot()).profileId
    );
  const [comparisonAutoPrevious, setComparisonAutoPrevious] = useState<boolean>(
    () => loadRunComparisonPrefs(loadDefaultRoot()).autoComparePrevious
  );
  const [comparisonPrefsRoot, setComparisonPrefsRoot] = useState<string>(loadDefaultRoot);
  const [comparisonBaselineRun, setComparisonBaselineRun] =
    useState<GenerationRunDetail | null>(null);
  const [generationRuntimeConfig, setGenerationRuntimeConfig] =
    useState<GenerationRuntimeConfig | null>(null);
  const [generationBudget, setGenerationBudget] =
    useState<GenerationBudgetReport | null>(null);
  const [budgetDraft, setBudgetDraft] =
    useState<GenerationBudgetDraft>(EMPTY_BUDGET_DRAFT);
  const [rerunDraft, setRerunDraft] = useState<RerunDraft>(EMPTY_RERUN_DRAFT);
  const [selectedScenePinnedRunDetail, setSelectedScenePinnedRunDetail] =
    useState<GenerationRunDetail | null>(null);
  const [selectedScenePinnedRunStale, setSelectedScenePinnedRunStale] = useState(false);
  const voiceSttRef = useRef<ReturnType<typeof createBrowserVoiceStt> | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceProviderLabel, setVoiceProviderLabel] = useState("none");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceInterimTranscript, setVoiceInterimTranscript] = useState("");
  const [voiceDraftTranscript, setVoiceDraftTranscript] = useState("");
  const [voiceLogRows, setVoiceLogRows] = useState<VoiceCommandLogEntry[]>([]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function reportError(context: string, err: unknown, nextStep?: string) {
    setError(toUserErrorMessage(err, context, nextStep));
    setMessage("");
  }

  function refreshVoiceLog(limit = 8) {
    setVoiceLogRows(listVoiceCommandLog(projectRoot, limit));
  }

  function recordVoiceCommand(row: {
    source: "stt" | "manual";
    transcript: string;
    normalized: string;
    confidence: number;
    status: "executed" | "rejected" | "failed" | "ignored";
    intent: VoiceIntent | null;
    detail: string;
  }) {
    appendVoiceCommandLog(projectRoot, row);
    refreshVoiceLog();
  }

  async function executeVoiceIntent(
    intent: VoiceIntent,
    transcript: string,
    normalized: string,
    confidence: number,
    source: "stt" | "manual"
  ) {
    if (intent.kind === "open_tab") {
      setRightTab(intent.tab);
      setError("");
      const detail = `Opened ${intent.tab} tab.`;
      setMessage(detail);
      recordVoiceCommand({
        source,
        transcript,
        normalized,
        confidence,
        status: "executed",
        intent,
        detail
      });
      return;
    }

    if (intent.kind === "open_view") {
      setCenterView(intent.view);
      setError("");
      const detail = `Opened ${intent.view} view.`;
      setMessage(detail);
      recordVoiceCommand({
        source,
        transcript,
        normalized,
        confidence,
        status: "executed",
        intent,
        detail
      });
      return;
    }

    if (intent.kind === "open_scene") {
      handleOpenGenerationScene(intent.sceneId);
      recordVoiceCommand({
        source,
        transcript,
        normalized,
        confidence,
        status: "executed",
        intent,
        detail: `Loaded ${intent.sceneId}.`
      });
      return;
    }

    if (intent.kind === "save_scene") {
      if (busy || centerView !== "editor" || !canSaveScene) {
        const detail = "Cannot save scene in current state.";
        recordVoiceCommand({
          source,
          transcript,
          normalized,
          confidence,
          status: "rejected",
          intent,
          detail
        });
        setError(detail);
        return;
      }
      await handleSaveScene();
      recordVoiceCommand({
        source,
        transcript,
        normalized,
        confidence,
        status: "executed",
        intent,
        detail: "Saved current scene."
      });
      return;
    }

    if (intent.kind === "run_continuity_checks") {
      if (busy || !projectFound) {
        const detail = "Cannot run continuity checks before project load.";
        recordVoiceCommand({
          source,
          transcript,
          normalized,
          confidence,
          status: "rejected",
          intent,
          detail
        });
        setError(detail);
        return;
      }
      setRightTab("checks");
      await handleRunContinuityChecks();
      recordVoiceCommand({
        source,
        transcript,
        normalized,
        confidence,
        status: "executed",
        intent,
        detail: "Ran continuity checks."
      });
      return;
    }

    if (intent.kind === "generate_proposal") {
      const nextDraft: DraftGeneratedProposal = {
        ...proposalGenerateForm,
        sceneId:
          intent.sceneId ||
          proposalGenerateForm.sceneId ||
          selectedSceneId,
        instruction:
          intent.instruction && intent.instruction.trim() !== ""
            ? intent.instruction.trim()
            : proposalGenerateForm.instruction
      };
      setRightTab("proposals");
      setProposalGenerateForm(nextDraft);
      if (nextDraft.sceneId === "" || nextDraft.instruction.trim() === "") {
        const detail =
          "Prepared proposal generate form from voice command; provide missing scene/instruction.";
        recordVoiceCommand({
          source,
          transcript,
          normalized,
          confidence,
          status: "rejected",
          intent,
          detail
        });
        setMessage(detail);
        setError("");
        return;
      }
      await generateProposalFromDraft(nextDraft);
      recordVoiceCommand({
        source,
        transcript,
        normalized,
        confidence,
        status: "executed",
        intent,
        detail: "Generated proposal from voice command."
      });
    }
  }

  async function submitVoiceTranscript(transcript: string, source: "stt" | "manual") {
    const parsed = parseVoiceCommand(transcript);
    if (!parsed.intent) {
      const detail = `Voice command not recognized: ${parsed.reason}`;
      recordVoiceCommand({
        source,
        transcript,
        normalized: parsed.normalized,
        confidence: parsed.confidence,
        status: "ignored",
        intent: null,
        detail
      });
      setError(detail);
      setMessage("");
      return;
    }
    try {
      await executeVoiceIntent(
        parsed.intent,
        transcript,
        parsed.normalized,
        parsed.confidence,
        source
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      recordVoiceCommand({
        source,
        transcript,
        normalized: parsed.normalized,
        confidence: parsed.confidence,
        status: "failed",
        intent: parsed.intent,
        detail
      });
      reportError("Voice command failed", err, "Review transcript and retry.");
    }
  }

  const canSaveScene = useMemo(() => {
    return Boolean(selectedSceneId && draft.title.trim() !== "");
  }, [selectedSceneId, draft.title]);

  const canSaveCodex = useMemo(() => {
    return Boolean(selectedCodexEntityId && codexDraft.name.trim() !== "");
  }, [selectedCodexEntityId, codexDraft.name]);
  const budgetDraftPayload = useMemo(
    () => buildBudgetUpdatePayload(budgetDraft),
    [budgetDraft]
  );
  const canSaveBudgetPolicy = useMemo(() => {
    return Object.values(budgetDraftPayload).some((value) => typeof value === "number");
  }, [budgetDraftPayload]);
  const currentBranchName = useMemo(() => {
    return branches.find((item) => item.current)?.name ?? "";
  }, [branches]);
  const mergeGuidance = useMemo(
    () => mergeGuidanceFromPreflight(branchPreflightReport),
    [branchPreflightReport]
  );

  const proposalCounts = useMemo(() => countProposals(proposals), [proposals]);
  const preferredProposalIds = useMemo(() => {
    const next = new Set<string>();
    for (const proposal of proposals) {
      if (!proposal.scene_id) continue;
      const generationId = proposal.generation?.id;
      if (!generationId) continue;
      if (generationPins[proposal.scene_id] === generationId) {
        next.add(proposal.id);
      }
    }
    return next;
  }, [proposals, generationPins]);
  const proposalReviewRows = useMemo(() => {
    return selectProposalReviewRows(
      proposals,
      selectedSceneId,
      preferredProposalIds,
      proposalReviewMode,
      proposalReviewStatusFilter
    );
  }, [
    proposals,
    selectedSceneId,
    preferredProposalIds,
    proposalReviewMode,
    proposalReviewStatusFilter
  ]);
  const proposalListRows = useMemo(() => {
    const sliced = proposalReviewRows.slice(0, proposalListLimit);
    if (!selectedProposalId || sliced.some((item) => item.id === selectedProposalId)) {
      return sliced;
    }
    const selected = proposalReviewRows.find((item) => item.id === selectedProposalId);
    if (!selected) return sliced;
    return [...sliced, selected];
  }, [proposalReviewRows, proposalListLimit, selectedProposalId]);
  const hasMoreProposalRows = proposalReviewRows.length > proposalListLimit;
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
  const sceneListRows = useMemo(() => {
    const sliced = scenes.slice(0, sceneListLimit);
    if (!selectedSceneId || sliced.some((item) => item.id === selectedSceneId)) {
      return sliced;
    }
    const selected = scenes.find((item) => item.id === selectedSceneId);
    if (!selected) return sliced;
    return [...sliced, selected];
  }, [scenes, sceneListLimit, selectedSceneId]);
  const hasMoreSceneRows = scenes.length > sceneListLimit;

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
  const comparisonProfiles = useMemo(() => listRunComparisonProfiles(), []);
  const runComparison = useMemo(() => {
    if (!selectedGenerationRun || !comparisonBaselineRun) return null;
    return buildRunComparison(
      comparisonBaselineRun,
      selectedGenerationRun,
      comparisonProfileId
    );
  }, [selectedGenerationRun, comparisonBaselineRun, comparisonProfileId]);
  const comparisonProfileLabel = useMemo(() => {
    const match = comparisonProfiles.find((item) => item.id === comparisonProfileId);
    return match?.label ?? "Balanced";
  }, [comparisonProfiles, comparisonProfileId]);
  const runComparisonActionHint = useMemo(() => {
    if (!runComparison) return "";
    if (runComparison.recommendation.verdict === "likely_better") {
      return "Recommendation action: promote current run as preferred if instruction quality fits intent.";
    }
    if (runComparison.recommendation.verdict === "likely_worse") {
      return "Recommendation action: keep baseline preferred, or promote baseline again.";
    }
    if (runComparison.recommendation.verdict === "mixed") {
      return "Recommendation action: inspect instruction/output deltas before promoting either run.";
    }
    return "Recommendation action: insufficient evidence; collect more runs before deciding.";
  }, [runComparison]);
  const selectedGenerationRunPinned = useMemo(() => {
    if (!selectedGenerationRun?.scene_id) return false;
    return generationPins[selectedGenerationRun.scene_id] === selectedGenerationRun.run_id;
  }, [generationPins, selectedGenerationRun]);
  const selectedProposalGenerationPinned = useMemo(() => {
    if (!selectedProposal?.scene_id || !selectedProposal.generation?.id) return false;
    return generationPins[selectedProposal.scene_id] === selectedProposal.generation.id;
  }, [generationPins, selectedProposal]);
  const selectedProposalPinnedRunId = useMemo(() => {
    if (!selectedProposal?.scene_id) return "";
    return generationPins[selectedProposal.scene_id] ?? "";
  }, [generationPins, selectedProposal]);
  const selectedGenerationScenePinnedRunId = useMemo(() => {
    if (!selectedGenerationRun?.scene_id) return "";
    return generationPins[selectedGenerationRun.scene_id] ?? "";
  }, [generationPins, selectedGenerationRun]);
  const comparisonCandidateRuns = useMemo(() => {
    if (!selectedGenerationRun) return [];
    return comparisonSceneRuns.filter(
      (row) => row.run_id !== selectedGenerationRun.run_id
    );
  }, [comparisonSceneRuns, selectedGenerationRun]);
  const runsListRows = useMemo(() => {
    const sliced = generationRuns.slice(0, runsListLimit);
    if (
      !selectedGenerationRunId ||
      sliced.some((item) => item.run_id === selectedGenerationRunId)
    ) {
      return sliced;
    }
    const selected = generationRuns.find(
      (item) => item.run_id === selectedGenerationRunId
    );
    if (!selected) return sliced;
    return [...sliced, selected];
  }, [generationRuns, runsListLimit, selectedGenerationRunId]);
  const hasMoreRunsRows = generationRuns.length > runsListLimit;
  const selectedScenePinnedRunId = useMemo(() => {
    if (!selectedSceneId) return "";
    return generationPins[selectedSceneId] ?? "";
  }, [generationPins, selectedSceneId]);
  const selectedScenePreferredProposal = useMemo(
    () =>
      findPreferredProposalForScene(proposals, selectedSceneId, generationPins),
    [proposals, selectedSceneId, generationPins]
  );
  const selectedScenePinnedRunProposalId = useMemo(() => {
    const proposalId = selectedScenePinnedRunDetail?.proposal_id;
    if (typeof proposalId !== "string") return "";
    return proposalId.trim();
  }, [selectedScenePinnedRunDetail]);
  const selectedSceneLinkedProposal = useMemo(() => {
    if (!selectedSceneId) return null;
    if (selectedScenePinnedRunProposalId) {
      return (
        proposals.find((item) => item.id === selectedScenePinnedRunProposalId) ?? null
      );
    }
    return selectedScenePreferredProposal;
  }, [
    proposals,
    selectedSceneId,
    selectedScenePinnedRunProposalId,
    selectedScenePreferredProposal
  ]);
  const preferredPipelineHealth = useMemo(() => {
    return evaluatePreferredPipelineHealth(
      selectedScenePinnedRunId,
      selectedScenePinnedRunId !== "" && !selectedScenePinnedRunStale,
      selectedSceneLinkedProposal?.status ?? null
    );
  }, [
    selectedScenePinnedRunId,
    selectedScenePinnedRunStale,
    selectedSceneLinkedProposal
  ]);
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

  async function refreshBranches() {
    const rows = await listBranches(projectRoot);
    setBranches(rows);
    if (rows.length === 0) {
      setMergeBaseBranch("");
      setMergeHeadBranch("");
      return;
    }
    const current = rows.find((item) => item.current)?.name ?? rows[0].name;
    if (!rows.some((item) => item.name === mergeBaseBranch)) {
      setMergeBaseBranch(current);
    }
    const nonBase = rows.find((item) => item.name !== current)?.name ?? current;
    if (!rows.some((item) => item.name === mergeHeadBranch)) {
      setMergeHeadBranch(nonBase);
    }
    setBranchCreateDraft((prev) => ({
      ...prev,
      fromRef: prev.fromRef || current
    }));
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

  async function refreshGenerationPins() {
    const rows = await listGenerationPins(projectRoot);
    const next: Record<string, string> = {};
    for (const row of rows) {
      if (row.scene_id && row.run_id) {
        next[row.scene_id] = row.run_id;
      }
    }
    setGenerationPins(next);
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

  async function refreshGenerationBudget() {
    const row = await getGenerationBudget(projectRoot);
    setGenerationBudget(row);
    setBudgetDraft(draftFromBudgetPolicy(row.policy));
  }

  async function refreshProjectDataAfterBranchChange() {
    await Promise.all([
      refreshSceneList(),
      refreshProposalList(),
      refreshCodexList(),
      refreshBranches(),
      refreshGenerationRuns(),
      refreshGenerationPins(),
      refreshGenerationRuntimeConfig(),
      refreshGenerationBudget()
    ]);
    setContinuityIssues([]);
    setSelectedContinuityIssueId("");
  }

  async function checkProjectAndLoad() {
    setBusy(true);
    setError("");
    setMessage("Loading project...");
    setSceneListLimit(DEFAULT_LIST_LIMIT);
    setProposalListLimit(DEFAULT_LIST_LIMIT);
    setRunsListLimit(DEFAULT_LIST_LIMIT);
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
        setBranches([]);
        setMergeBaseBranch("");
        setMergeHeadBranch("");
        setBranchCreateDraft(EMPTY_DRAFT_BRANCH_CREATE);
        setBranchDiffReport(null);
        setBranchPreflightReport(null);
        setBranchMergeResult(null);
        setGenerationRuns([]);
        setGenerationPins({});
        setSelectedGenerationRunId("");
        setSelectedGenerationRun(null);
        setGenerationBudget(null);
        setBudgetDraft(EMPTY_BUDGET_DRAFT);
        setSelectedScenePinnedRunDetail(null);
        setSelectedScenePinnedRunStale(false);
        setGenerationRuntimeConfig(null);
        return;
      }
      await Promise.all([
        refreshSceneList(),
        refreshProposalList(),
        refreshCodexList(),
        refreshBranches(),
        refreshGenerationRuns(),
        refreshGenerationPins(),
        refreshGenerationRuntimeConfig(),
        refreshGenerationBudget()
      ]);
      setContinuityIssues([]);
      setSelectedContinuityIssueId("");
      setMessage("Project loaded.");
    } catch (err) {
      reportError("Project load failed", err, "Verify the project root and retry.");
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
    refreshVoiceLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot]);

  useEffect(() => {
    const controller = createBrowserVoiceStt({
      onStart: () => {
        setVoiceListening(true);
        setVoiceInterimTranscript("");
      },
      onResult: (row) => {
        if (!row.transcript) return;
        if (row.isFinal) {
          setVoiceInterimTranscript("");
          setVoiceDraftTranscript(row.transcript);
          void submitVoiceTranscript(row.transcript, "stt");
        } else {
          setVoiceInterimTranscript(row.transcript);
        }
      },
      onError: (messageText) => {
        setVoiceListening(false);
        setError(`Voice capture error: ${messageText}`);
      },
      onEnd: () => {
        setVoiceListening(false);
      }
    });
    voiceSttRef.current = controller;
    setVoiceSupported(controller.supported);
    setVoiceProviderLabel(controller.provider);
    return () => {
      voiceSttRef.current?.stop();
      voiceSttRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcutAction(event);
      if (!action) return;

      if (action === "save_scene") {
        if (busy || centerView !== "editor" || !canSaveScene) return;
        event.preventDefault();
        void handleSaveScene();
        return;
      }

      if (action === "generate_proposal") {
        if (busy) return;
        event.preventDefault();
        setRightTab("proposals");
        if (proposalGenerateForm.instruction.trim() === "") {
          setMessage("Opened Proposals tab. Enter instruction, then trigger generate.");
          setError("");
          return;
        }
        void handleGenerateProposal();
        return;
      }

      if (action === "run_continuity_checks") {
        if (busy) return;
        event.preventDefault();
        setRightTab("checks");
        if (!projectFound) {
          setError("Load a project before running continuity checks.");
          setMessage("");
          return;
        }
        void handleRunContinuityChecks();
        return;
      }

      if (action === "open_runs_tab") {
        event.preventDefault();
        setRightTab("runs");
        setError("");
        setMessage("Opened Runs tab.");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    busy,
    centerView,
    canSaveScene,
    projectFound,
    proposalGenerateForm.instruction
  ]);

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
    if (proposalReviewRows.length === 0) {
      setSelectedProposalId("");
      return;
    }
    if (!proposalReviewRows.some((item) => item.id === selectedProposalId)) {
      setSelectedProposalId(proposalReviewRows[0].id);
    }
  }, [proposalReviewRows, selectedProposalId]);

  useEffect(() => {
    if (!selectedSceneId) {
      setSelectedScenePinnedRunDetail(null);
      setSelectedScenePinnedRunStale(false);
      return;
    }
    const pinnedRunId = generationPins[selectedSceneId];
    if (!pinnedRunId) {
      setSelectedScenePinnedRunDetail(null);
      setSelectedScenePinnedRunStale(false);
      return;
    }
    let cancelled = false;
    setSelectedScenePinnedRunStale(false);
    void getGenerationRun(projectRoot, pinnedRunId)
      .then((row) => {
        if (cancelled) return;
        setSelectedScenePinnedRunDetail(row);
        setSelectedScenePinnedRunStale(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedScenePinnedRunDetail(null);
        setSelectedScenePinnedRunStale(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, selectedSceneId, generationPins]);

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
    setProposalListLimit(DEFAULT_LIST_LIMIT);
  }, [proposalReviewMode, proposalReviewStatusFilter, selectedSceneId]);

  useEffect(() => {
    setRunsListLimit(DEFAULT_LIST_LIMIT);
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
    const prefs = loadRunComparisonPrefs(projectRoot);
    setComparisonProfileId(prefs.profileId);
    setComparisonAutoPrevious(prefs.autoComparePrevious);
    setComparisonPrefsRoot(projectRoot);
  }, [projectRoot]);

  useEffect(() => {
    if (comparisonPrefsRoot !== projectRoot) return;
    saveRunComparisonPrefs(projectRoot, {
      profileId: comparisonProfileId,
      autoComparePrevious: comparisonAutoPrevious
    });
  }, [
    projectRoot,
    comparisonPrefsRoot,
    comparisonProfileId,
    comparisonAutoPrevious
  ]);

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
        const ordered = orderGenerationRuns(rows);
        setComparisonSceneRuns(ordered);
        if (!comparisonAutoPrevious) return;
        const previousId = pickPreviousRunId(
          ordered.map((row) => row.run_id),
          selectedGenerationRun.run_id
        );
        if (!previousId) return;
        void getGenerationRun(projectRoot, previousId)
          .then((baseline) => {
            if (cancelled) return;
            setComparisonBaselineRunId(previousId);
            setComparisonBaselineRun(baseline);
          })
          .catch((err) => {
            if (cancelled) return;
            setError(err instanceof Error ? err.message : String(err));
          });
      })
      .catch((err) => {
        if (cancelled) return;
        setComparisonSceneRuns([]);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, selectedGenerationRun, comparisonAutoPrevious]);

  async function handleCreateScene() {
    if (addForm.title.trim() === "") return;
    setBusy(true);
    setError("");
    setMessage("Creating scene...");
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
      reportError("Scene create failed", err, "Check required fields and retry.");
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
    setMessage("Loading baseline run...");
    try {
      const baseline = await getGenerationRun(projectRoot, runId);
      setComparisonBaselineRunId(runId);
      setComparisonBaselineRun(baseline);
      setMessage(`Comparing ${selectedGenerationRun.run_id} against ${runId}.`);
    } catch (err) {
      reportError("Baseline load failed", err, "Pick another run or refresh runs.");
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

  async function handlePinBaselineGenerationRun() {
    if (!comparisonBaselineRun?.scene_id) return;
    setBusy(true);
    setError("");
    setMessage("Pinning baseline as preferred...");
    try {
      await pinGenerationRun(projectRoot, {
        sceneId: comparisonBaselineRun.scene_id,
        runId: comparisonBaselineRun.run_id
      });
      await refreshGenerationPins();
      setMessage(
        `Pinned baseline ${comparisonBaselineRun.run_id} for ${comparisonBaselineRun.scene_id}.`
      );
    } catch (err) {
      reportError("Pin baseline failed", err, "Refresh runs and retry.");
    } finally {
      setBusy(false);
    }
  }

  function handleOpenBaselineRun() {
    if (!comparisonBaselineRun) return;
    setSelectedGenerationRunId(comparisonBaselineRun.run_id);
    setMessage(`Loaded baseline run ${comparisonBaselineRun.run_id}.`);
    setError("");
  }

  async function handleOpenBaselineProposal() {
    const proposalId = comparisonBaselineRun?.proposal_id?.trim() ?? "";
    if (!proposalId) {
      setError("Baseline run has no linked proposal.");
      setMessage("");
      return;
    }
    await handleOpenGenerationProposal(proposalId);
  }

  async function handleSaveScene() {
    if (!selectedSceneId) return;
    setBusy(true);
    setError("");
    setMessage("Saving scene...");
    try {
      const saved = await updateScene(projectRoot, selectedSceneId, draft);
      setScene(saved);
      await refreshSceneList(saved.id);
      setMessage("Scene saved.");
    } catch (err) {
      reportError("Scene save failed", err, "Review edits and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProposal() {
    if (proposalForm.title.trim() === "" || proposalForm.instruction.trim() === "") return;
    const sceneId = proposalForm.sceneId || selectedSceneId;
    setBusy(true);
    setError("");
    setMessage("Creating proposal...");
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
      reportError("Proposal create failed", err, "Validate inputs and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function generateProposalFromDraft(input: DraftGeneratedProposal) {
    if (input.instruction.trim() === "") return;
    const sceneId = input.sceneId || selectedSceneId;
    if (!sceneId) {
      setError("Select a scene (or enter a scene id) before generating a proposal.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Generating proposal...");
    try {
      const generated = await generateProposal(projectRoot, {
        sceneId,
        instruction: input.instruction,
        provider: input.provider,
        title: input.title,
        model: input.model,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        contextScenes: input.contextScenes,
        codexLimit: input.codexLimit,
        retrievalMode: input.retrievalMode,
        retrievalLimit: input.retrievalLimit,
        retrievalMinScore: input.retrievalMinScore,
        retrievalRequireFresh: input.retrievalRequireFresh
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
      const providerLabel = generated.generation?.provider ?? input.provider;
      const modelLabel = generated.generation?.model ?? "default";
      setMessage(`Proposal generated via ${providerLabel}/${modelLabel}.`);
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      const budgetBlocked = details.toLowerCase().includes("budget policy");
      const retrievalBlocked = details.toLowerCase().includes("retrieval");
      reportError(
        "Proposal generation failed",
        err,
        budgetBlocked
          ? "Open Runs and adjust generation budget policy, then retry."
          : retrievalBlocked
            ? "Build or refresh retrieval index and retry."
            : "Check provider credentials/settings and retry."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateProposal() {
    await generateProposalFromDraft(proposalGenerateForm);
  }

  async function handleApplyProposal(proposalId: string) {
    setBusy(true);
    setError("");
    setMessage("Applying proposal...");
    try {
      const updated = await applyProposal(projectRoot, proposalId);
      await refreshProposalList(updated.id);
      setMessage("Proposal applied.");
    } catch (err) {
      reportError("Proposal apply failed", err, "Reload proposals and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectProposal(proposalId: string) {
    setBusy(true);
    setError("");
    setMessage("Rejecting proposal...");
    try {
      const updated = await rejectProposal(projectRoot, proposalId);
      await refreshProposalList(updated.id);
      setMessage("Proposal rejected.");
    } catch (err) {
      reportError("Proposal reject failed", err, "Reload proposals and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCodex() {
    if (codexForm.name.trim() === "") return;
    setBusy(true);
    setError("");
    setMessage("Creating codex entity...");
    try {
      const created = await addCodexEntity(projectRoot, codexForm);
      await refreshCodexList(created.id);
      setCodexForm(EMPTY_DRAFT_CODEX);
      setMessage("Codex entity created.");
    } catch (err) {
      reportError("Codex create failed", err, "Review fields and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCodex() {
    if (!selectedCodexEntityId || codexDraft.name.trim() === "") return;
    setBusy(true);
    setError("");
    setMessage("Saving codex entity...");
    try {
      const updated = await updateCodexEntity(projectRoot, selectedCodexEntityId, codexDraft);
      await refreshCodexList(updated.id);
      setMessage("Codex entity saved.");
    } catch (err) {
      reportError("Codex save failed", err, "Review edits and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunContinuityChecks() {
    setBusy(true);
    setError("");
    setMessage("Running continuity checks...");
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
      reportError(
        "Continuity check failed",
        err,
        "Confirm project integrity and run checks again."
      );
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
    setMessage("Opening proposal...");
    try {
      await refreshProposalList(proposalId);
      setRightTab("proposals");
      setSelectedProposalId(proposalId);
      setMessage(`Loaded ${proposalId} in proposals.`);
    } catch (err) {
      reportError("Open proposal failed", err, "Refresh proposals and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenPinnedGenerationRun(sceneId: string) {
    const pinnedRunId = generationPins[sceneId];
    if (!pinnedRunId) {
      setError(`No preferred run pinned for ${sceneId}.`);
      setMessage("");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Resolving preferred run...");
    try {
      const run = await getGenerationRun(projectRoot, pinnedRunId);
      setSelectedScenePinnedRunDetail(run);
      setSelectedScenePinnedRunStale(false);
      setRightTab("runs");
      setSelectedGenerationRunId(run.run_id);
      setSelectedGenerationRun(run);
      setMessage(`Loaded preferred run ${pinnedRunId} for ${sceneId}.`);
    } catch (err) {
      setSelectedScenePinnedRunDetail(null);
      setSelectedScenePinnedRunStale(true);
      reportError(
        "Open preferred run failed",
        err,
        `Pinned run '${pinnedRunId}' for ${sceneId} is stale. Clear the pin to recover.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenPinnedProposal(sceneId: string) {
    const pinnedRunId = generationPins[sceneId];
    if (!pinnedRunId) {
      setError(`No preferred run pinned for ${sceneId}.`);
      setMessage("");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Resolving preferred proposal...");
    try {
      let run: GenerationRunDetail;
      try {
        run = await getGenerationRun(projectRoot, pinnedRunId);
      } catch {
        setSelectedScenePinnedRunDetail(null);
        setSelectedScenePinnedRunStale(true);
        setError(
          `Pinned run '${pinnedRunId}' for ${sceneId} is stale. Clear the pin to recover.`
        );
        setMessage("");
        return;
      }
      setSelectedScenePinnedRunDetail(run);
      setSelectedScenePinnedRunStale(false);
      const proposalId =
        typeof run.proposal_id === "string" ? run.proposal_id.trim() : "";
      if (!proposalId) {
        throw new Error(
          `Pinned run ${pinnedRunId} has no linked proposal. Re-run or generate a new proposal.`
        );
      }
      const rows = orderProposalsForReview(await listProposals(projectRoot));
      setProposals(rows);
      if (!rows.some((item) => item.id === proposalId)) {
        throw new Error(
          `Linked proposal '${proposalId}' was not found in the current queue.`
        );
      }
      setRightTab("proposals");
      setSelectedProposalId(proposalId);
      setMessage(`Loaded preferred proposal ${proposalId} for ${sceneId}.`);
    } catch (err) {
      reportError(
        "Open preferred proposal failed",
        err,
        "Refresh proposals or regenerate from preferred run."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClearPreferredPin(sceneId: string) {
    if (!sceneId) return;
    setBusy(true);
    setError("");
    setMessage("Clearing preferred pin...");
    try {
      const result = await unpinGenerationRun(projectRoot, sceneId);
      await refreshGenerationPins();
      setSelectedScenePinnedRunDetail(null);
      setSelectedScenePinnedRunStale(false);
      if (result.cleared) {
        setMessage(`Cleared stale preferred pin for ${sceneId}.`);
      } else {
        setMessage(`No preferred pin was set for ${sceneId}.`);
      }
    } catch (err) {
      reportError("Clear preferred pin failed", err, "Retry the unpin action.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshProposalsForRecovery() {
    setBusy(true);
    setError("");
    setMessage("Refreshing proposal queue...");
    try {
      await refreshProposalList();
      setMessage("Proposal queue refreshed.");
    } catch (err) {
      reportError("Proposal refresh failed", err, "Retry refresh.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveBudgetPolicy() {
    if (!canSaveBudgetPolicy) {
      setError("Enter at least one budget value before saving.");
      setMessage("");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Saving generation budget policy...");
    try {
      const row = await updateGenerationBudget(projectRoot, budgetDraftPayload);
      setGenerationBudget(row);
      setBudgetDraft(draftFromBudgetPolicy(row.policy));
      await refreshGenerationRuntimeConfig();
      setMessage("Generation budget policy updated.");
    } catch (err) {
      reportError("Budget policy update failed", err, "Review values and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetBudgetPolicy() {
    setBusy(true);
    setError("");
    setMessage("Resetting generation budget policy...");
    try {
      const row = await resetGenerationBudget(projectRoot);
      setGenerationBudget(row);
      setBudgetDraft(draftFromBudgetPolicy(row.policy));
      await refreshGenerationRuntimeConfig();
      setMessage("Generation budget policy reset.");
    } catch (err) {
      reportError("Budget policy reset failed", err, "Retry reset.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBranchWorkspace() {
    if (branchCreateDraft.name.trim() === "") {
      setError("Enter a branch name.");
      setMessage("");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Creating branch workspace...");
    try {
      const created = await createBranch(projectRoot, {
        name: branchCreateDraft.name.trim(),
        fromRef: branchCreateDraft.fromRef.trim() || undefined,
        noSwitch: branchCreateDraft.noSwitch
      });
      await refreshProjectDataAfterBranchChange();
      setBranchCreateDraft((prev) => ({
        ...prev,
        name: "",
        noSwitch: false
      }));
      setBranchDiffReport(null);
      setBranchPreflightReport(null);
      setBranchMergeResult(null);
      setMessage(
        created.current
          ? `Created and switched to ${created.name}.`
          : `Created branch ${created.name}.`
      );
    } catch (err) {
      reportError("Branch create failed", err, "Resolve branch naming/state issues and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchBranchWorkspace(branchName: string) {
    if (!branchName) return;
    setBusy(true);
    setError("");
    setMessage("Switching branch workspace...");
    try {
      await switchBranch(projectRoot, branchName);
      await refreshProjectDataAfterBranchChange();
      setBranchDiffReport(null);
      setBranchPreflightReport(null);
      setBranchMergeResult(null);
      setMessage(`Switched to branch ${branchName}.`);
    } catch (err) {
      reportError(
        "Branch switch failed",
        err,
        "Create a snapshot or clean branch state before switching."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyzeMergePlan() {
    if (!mergeBaseBranch || !mergeHeadBranch) {
      setError("Select both base and head branches.");
      setMessage("");
      return;
    }
    if (mergeBaseBranch === mergeHeadBranch) {
      setError("Base and head branches must differ.");
      setMessage("");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Analyzing merge preflight...");
    try {
      const [diff, preflight] = await Promise.all([
        diffBranches(projectRoot, { base: mergeBaseBranch, head: mergeHeadBranch }),
        preflightMerge(projectRoot, { base: mergeBaseBranch, head: mergeHeadBranch })
      ]);
      setBranchDiffReport(diff);
      setBranchPreflightReport(preflight);
      setBranchMergeResult(null);
      setMessage(
        `Preflight complete: risk ${preflight.risk_level}, overlap ${preflight.overlap_count}.`
      );
    } catch (err) {
      reportError("Merge analysis failed", err, "Refresh branches and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyMergePlan() {
    if (!mergeBaseBranch || !mergeHeadBranch) {
      setError("Select both base and head branches.");
      setMessage("");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Applying branch merge...");
    try {
      const row = await mergeBranches(projectRoot, {
        base: mergeBaseBranch,
        head: mergeHeadBranch
      });
      setBranchMergeResult(row);
      await refreshProjectDataAfterBranchChange();
      const [diff, preflight] = await Promise.all([
        diffBranches(projectRoot, { base: mergeBaseBranch, head: mergeHeadBranch }),
        preflightMerge(projectRoot, { base: mergeBaseBranch, head: mergeHeadBranch })
      ]);
      setBranchDiffReport(diff);
      setBranchPreflightReport(preflight);
      setMessage(`Merged ${row.head} into ${row.base} at ${row.merge_commit}.`);
    } catch (err) {
      reportError(
        "Merge apply failed",
        err,
        "Run preflight, resolve overlap risk, and retry."
      );
    } finally {
      setBusy(false);
    }
  }

  function handlePrepareGenerateProposalForScene(sceneId: string) {
    if (!sceneId) return;
    setRightTab("proposals");
    setProposalGenerateForm((prev) => ({
      ...prev,
      sceneId
    }));
    setMessage(`Generate form set to ${sceneId}.`);
    setError("");
  }

  function handleFocusPreferredProposalQueue(sceneId: string) {
    setRightTab("proposals");
    setProposalReviewMode("preferred_priority");
    if (sceneId) {
      setSelectedSceneId(sceneId);
    }
    if (selectedSceneLinkedProposal) {
      setSelectedProposalId(selectedSceneLinkedProposal.id);
    }
    setMessage("Focused proposal review on preferred-linked entries.");
    setError("");
  }

  function handleStartVoiceCapture() {
    const controller = voiceSttRef.current;
    if (!controller || !controller.supported) {
      setError("Voice capture unavailable in this runtime.");
      setMessage("");
      return;
    }
    setError("");
    setMessage("Listening for voice command...");
    controller.start();
  }

  function handleStopVoiceCapture() {
    voiceSttRef.current?.stop();
    setMessage("Stopped listening.");
    setError("");
  }

  function handleSubmitVoiceDraft() {
    if (voiceDraftTranscript.trim() === "") return;
    void submitVoiceTranscript(voiceDraftTranscript.trim(), "manual");
  }

  function handleClearVoiceLog() {
    clearVoiceCommandLog(projectRoot);
    refreshVoiceLog();
    setMessage("Cleared voice transcript log.");
    setError("");
  }

  async function handleRerunGeneration() {
    if (!selectedGenerationRun) return;
    setBusy(true);
    setError("");
    setMessage("Re-running generation...");
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
      const details = err instanceof Error ? err.message : String(err);
      const budgetBlocked = details.toLowerCase().includes("budget policy");
      const retrievalBlocked = details.toLowerCase().includes("retrieval");
      reportError(
        "Generation rerun failed",
        err,
        budgetBlocked
          ? "Open Runs and adjust generation budget policy, then retry."
          : retrievalBlocked
            ? "Build or refresh retrieval index and retry."
            : "Check provider settings and retry."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePinPreferredGenerationRun() {
    if (!selectedGenerationRun?.scene_id) return;
    setBusy(true);
    setError("");
    setMessage("Pinning preferred run...");
    try {
      await pinGenerationRun(projectRoot, {
        sceneId: selectedGenerationRun.scene_id,
        runId: selectedGenerationRun.run_id
      });
      await refreshGenerationPins();
      setMessage(
        `Pinned ${selectedGenerationRun.run_id} as preferred for ${selectedGenerationRun.scene_id}.`
      );
    } catch (err) {
      reportError("Pin preferred run failed", err, "Refresh runs and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpinPreferredGenerationRun() {
    if (!selectedGenerationRun?.scene_id) return;
    setBusy(true);
    setError("");
    setMessage("Clearing preferred run...");
    try {
      const result = await unpinGenerationRun(projectRoot, selectedGenerationRun.scene_id);
      await refreshGenerationPins();
      if (result.cleared) {
        setMessage(`Cleared preferred run for ${selectedGenerationRun.scene_id}.`);
      } else {
        setMessage(`No preferred run was set for ${selectedGenerationRun.scene_id}.`);
      }
    } catch (err) {
      reportError("Unpin preferred run failed", err, "Retry unpin.");
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
          <p className="shortcut-hints">
            Shortcuts: Cmd/Ctrl+S save scene, Cmd/Ctrl+Shift+G generate proposal,
            Cmd/Ctrl+Shift+K run checks, Cmd/Ctrl+Shift+L open runs.
          </p>
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

      <section className="voice-bar">
        <div className="voice-header">
          <h2>Voice Command</h2>
          <span>
            {voiceSupported ? `${voiceProviderLabel}${voiceListening ? " / listening" : ""}` : "unsupported"}
          </span>
        </div>
        <div className="voice-controls">
          <input
            value={voiceDraftTranscript}
            onChange={(event) => setVoiceDraftTranscript(event.target.value)}
            placeholder="Voice command transcript (manual fallback)"
          />
          <button
            disabled={busy || voiceDraftTranscript.trim() === ""}
            onClick={handleSubmitVoiceDraft}
          >
            Run Command
          </button>
          <button
            disabled={busy || !voiceSupported || voiceListening}
            onClick={handleStartVoiceCapture}
          >
            Start Listening
          </button>
          <button
            disabled={busy || !voiceListening}
            onClick={handleStopVoiceCapture}
          >
            Stop Listening
          </button>
          <button disabled={busy || voiceLogRows.length === 0} onClick={handleClearVoiceLog}>
            Clear Log
          </button>
        </div>
        {voiceInterimTranscript ? (
          <p className="voice-interim">Interim: {voiceInterimTranscript}</p>
        ) : null}
        <div className="voice-log">
          {voiceLogRows.length === 0 ? (
            <p className="voice-log-empty">No voice commands logged yet.</p>
          ) : (
            voiceLogRows.slice(0, 6).map((row) => (
              <p key={row.id} className={`voice-log-item status-${row.status}`}>
                {new Date(row.timestamp).toLocaleTimeString()} [{row.source}] {row.intentLabel} -{" "}
                {row.status}
              </p>
            ))
          )}
        </div>
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
            {sceneListRows.map((item) => (
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
            {hasMoreSceneRows ? (
              <button
                className="list-load-more"
                disabled={busy}
                onClick={() =>
                  setSceneListLimit((prev) => prev + LIST_LIMIT_STEP)
                }
              >
                Load More Scenes
              </button>
            ) : null}
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
            <button
              className={rightTab === "merge" ? "active" : ""}
              onClick={() => setRightTab("merge")}
            >
              Merge
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
              <div className="proposal-filters">
                <label>
                  <span>Queue Mode</span>
                  <select
                    value={proposalReviewMode}
                    onChange={(event) =>
                      setProposalReviewMode(event.target.value as ProposalReviewMode)
                    }
                  >
                    <option value="all">all proposals</option>
                    <option value="scene_priority">selected scene first</option>
                    <option value="preferred_priority">preferred-linked first</option>
                    <option value="preferred_only">preferred-linked only</option>
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={proposalReviewStatusFilter}
                    onChange={(event) =>
                      setProposalReviewStatusFilter(
                        event.target.value as ProposalReviewStatusFilter
                      )
                    }
                  >
                    <option value="all">all statuses</option>
                    <option value="pending">pending</option>
                    <option value="applied">applied</option>
                    <option value="rejected">rejected</option>
                  </select>
                </label>
                <p className="proposal-filter-summary">
                  {proposalReviewRows.length} in review queue
                </p>
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
                  <label>
                    <span>Retrieval Mode</span>
                    <select
                      value={proposalGenerateForm.retrievalMode}
                      onChange={(event) =>
                        setProposalGenerateForm((prev) => ({
                          ...prev,
                          retrievalMode: event.target.value as "off" | "auto" | "required"
                        }))
                      }
                    >
                      <option value="off">off</option>
                      <option value="auto">auto</option>
                      <option value="required">required</option>
                    </select>
                  </label>
                  <label>
                    <span>Retrieval Limit</span>
                    <input
                      type="number"
                      min="1"
                      value={proposalGenerateForm.retrievalLimit}
                      onChange={(event) =>
                        setProposalGenerateForm((prev) => ({
                          ...prev,
                          retrievalLimit: Number(event.target.value || 1)
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Retrieval Min Score</span>
                    <input
                      type="number"
                      min="0"
                      step="0.05"
                      value={proposalGenerateForm.retrievalMinScore}
                      onChange={(event) =>
                        setProposalGenerateForm((prev) => ({
                          ...prev,
                          retrievalMinScore: Number(event.target.value || 0)
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="run-compare-toggle">
                  <input
                    type="checkbox"
                    checked={proposalGenerateForm.retrievalRequireFresh}
                    onChange={(event) =>
                      setProposalGenerateForm((prev) => ({
                        ...prev,
                        retrievalRequireFresh: event.target.checked
                      }))
                    }
                  />
                  <span>Require fresh retrieval index</span>
                </label>
                <button
                  disabled={busy || proposalGenerateForm.instruction.trim() === ""}
                  onClick={handleGenerateProposal}
                >
                  Generate Proposal
                </button>
              </div>

              <div className="proposal-list">
                {proposalListRows.length === 0 ? (
                  <div className="proposal-review empty-review">
                    <p>No proposals match the current review filters.</p>
                  </div>
                ) : (
                  proposalListRows.map((item) => {
                    const isPreferredLinked = preferredProposalIds.has(item.id);
                    const isSceneMatch =
                      selectedSceneId !== "" && item.scene_id === selectedSceneId;
                    return (
                      <button
                        key={item.id}
                        className={`proposal-item ${isPreferredLinked ? "preferred-linked" : ""} ${isSceneMatch ? "scene-match" : ""} ${item.id === selectedProposalId ? "selected" : ""} status-${item.status}`}
                        onClick={() => setSelectedProposalId(item.id)}
                      >
                        <strong>{item.title}</strong>
                        <span>
                          {item.scene_id || "global"}
                          {isSceneMatch ? " / selected scene" : ""}
                          {isPreferredLinked ? " / preferred-linked" : ""}
                        </span>
                        <em>{item.status}</em>
                      </button>
                    );
                  })
                )}
                {hasMoreProposalRows ? (
                  <button
                    className="list-load-more"
                    disabled={busy}
                    onClick={() =>
                      setProposalListLimit((prev) => prev + LIST_LIMIT_STEP)
                    }
                  >
                    Load More Proposals
                  </button>
                ) : null}
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
                  {selectedProposal.generation?.retrieval ? (
                    <div className="run-compare-table provenance-card">
                      <h5>Retrieval Provenance</h5>
                      <p className="proposal-meta">
                        Mode: {selectedProposal.generation.retrieval.mode} / used:{" "}
                        {selectedProposal.generation.retrieval.used ? "yes" : "no"} / results:{" "}
                        {selectedProposal.generation.retrieval.result_count}
                      </p>
                      <p className="proposal-meta">
                        Query: {selectedProposal.generation.retrieval.query || "n/a"}
                      </p>
                      {selectedProposal.generation.retrieval.degraded ? (
                        <p className="proposal-meta">
                          Retrieval degraded: {selectedProposal.generation.retrieval.error}
                        </p>
                      ) : null}
                      {selectedProposal.generation.retrieval.citations?.length ? (
                        <div className="provenance-list">
                          {selectedProposal.generation.retrieval.citations
                            .slice(0, 4)
                            .map((row) => (
                              <div key={row.chunk_id} className="provenance-item">
                                <p className="proposal-meta">
                                  {row.source_type}/{row.source_ref} ({row.source_title})
                                </p>
                                <p className="proposal-meta">
                                  score {row.score ?? "n/a"} / coverage {row.coverage ?? "n/a"}
                                </p>
                                <p className="proposal-meta">
                                  terms: {row.matched_terms.join(", ") || "n/a"}
                                </p>
                                <p className="proposal-meta">{row.excerpt}</p>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="proposal-meta">No citations attached.</p>
                      )}
                    </div>
                  ) : null}
                  {selectedProposalGenerationPinned ? (
                    <p className="proposal-meta">Preferred generation for this scene.</p>
                  ) : null}
                  {selectedProposalPinnedRunId ? (
                    <p className="proposal-meta">
                      Preferred run id: {selectedProposalPinnedRunId}
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
                    <button
                      disabled={busy || !selectedProposal.scene_id || !selectedProposalPinnedRunId}
                      onClick={() =>
                        void handleOpenPinnedGenerationRun(selectedProposal.scene_id)
                      }
                    >
                      Open Preferred Run
                    </button>
                    <button
                      disabled={busy || !selectedProposal.scene_id || !selectedProposalPinnedRunId}
                      onClick={() => void handleOpenPinnedProposal(selectedProposal.scene_id)}
                    >
                      Open Preferred Proposal
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
                      refreshGenerationPins(),
                      refreshGenerationRuntimeConfig(),
                      refreshGenerationBudget()
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
                    <p className="run-meta">
                      Budget enforcement:{" "}
                      {generationBudget?.policy.enforcement ?? "fail_closed"}
                    </p>
                  </>
                ) : (
                  <p className="run-meta">Config unavailable.</p>
                )}
                {generationBudget ? (
                  <div className="run-budget-card">
                    <h4>Budget Policy</h4>
                    <p className="run-meta">
                      Per-run caps: in {generationBudget.policy.per_run.max_input_tokens ?? "none"} / out{" "}
                      {generationBudget.policy.per_run.max_output_tokens ?? "none"} / total{" "}
                      {generationBudget.policy.per_run.max_total_tokens ?? "none"} / cost{" "}
                      {generationBudget.policy.per_run.max_estimated_cost_usd ?? "none"}
                    </p>
                    <p className="run-meta">
                      Rolling caps: daily tokens {generationBudget.policy.rolling.daily_tokens ?? "none"} / daily cost{" "}
                      {generationBudget.policy.rolling.daily_estimated_cost_usd ?? "none"} / weekly tokens{" "}
                      {generationBudget.policy.rolling.weekly_tokens ?? "none"} / weekly cost{" "}
                      {generationBudget.policy.rolling.weekly_estimated_cost_usd ?? "none"}
                    </p>
                    <p className="run-meta">
                      Usage daily: {generationBudget.usage.daily.total_tokens} tokens / $
                      {generationBudget.usage.daily.estimated_cost_usd} (unknown cost runs:{" "}
                      {generationBudget.usage.daily.unknown_cost_runs})
                    </p>
                    <p className="run-meta">
                      Usage weekly: {generationBudget.usage.weekly.total_tokens} tokens / $
                      {generationBudget.usage.weekly.estimated_cost_usd} (unknown cost runs:{" "}
                      {generationBudget.usage.weekly.unknown_cost_runs})
                    </p>
                    <div className="generate-grid">
                      <label>
                        <span>Max Input Tokens</span>
                        <input
                          value={budgetDraft.maxInputTokens}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              maxInputTokens: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                      <label>
                        <span>Max Output Tokens</span>
                        <input
                          value={budgetDraft.maxOutputTokens}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              maxOutputTokens: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                      <label>
                        <span>Max Total Tokens</span>
                        <input
                          value={budgetDraft.maxTotalTokens}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              maxTotalTokens: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                      <label>
                        <span>Max Cost (USD)</span>
                        <input
                          value={budgetDraft.maxEstimatedCostUsd}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              maxEstimatedCostUsd: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                      <label>
                        <span>Daily Tokens</span>
                        <input
                          value={budgetDraft.dailyTokens}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              dailyTokens: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                      <label>
                        <span>Daily Cost (USD)</span>
                        <input
                          value={budgetDraft.dailyEstimatedCostUsd}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              dailyEstimatedCostUsd: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                      <label>
                        <span>Weekly Tokens</span>
                        <input
                          value={budgetDraft.weeklyTokens}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              weeklyTokens: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                      <label>
                        <span>Weekly Cost (USD)</span>
                        <input
                          value={budgetDraft.weeklyEstimatedCostUsd}
                          onChange={(event) =>
                            setBudgetDraft((prev) => ({
                              ...prev,
                              weeklyEstimatedCostUsd: event.target.value
                            }))
                          }
                          placeholder="none"
                        />
                      </label>
                    </div>
                    <div className="proposal-actions">
                      <button
                        disabled={busy || !canSaveBudgetPolicy}
                        onClick={() => void handleSaveBudgetPolicy()}
                      >
                        Save Budget Policy
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void handleResetBudgetPolicy()}
                      >
                        Reset Budget Policy
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="run-meta">Budget policy unavailable.</p>
                )}
              </div>

              <div className="runs-list">
                {generationRuns.length === 0 ? (
                  <div className="run-detail empty-review">
                    <p>No generation runs found for this filter.</p>
                  </div>
                ) : (
                  runsListRows.map((run) => {
                    const isPreferredForScene =
                      run.scene_id !== "" &&
                      generationPins[run.scene_id] === run.run_id;
                    return (
                      <button
                        key={run.run_id}
                        className={`run-item ${isPreferredForScene ? "preferred" : ""} ${run.run_id === selectedGenerationRunId ? "selected" : ""} status-${run.status}`}
                        onClick={() => setSelectedGenerationRunId(run.run_id)}
                      >
                        <strong>{run.run_id}</strong>
                        <span>
                          {run.provider || "unknown provider"} / {run.quality_tier || "n/a"}
                          {run.retrieval_mode && run.retrieval_mode !== "off"
                            ? ` / retrieval ${run.retrieval_result_count ?? 0}`
                            : ""}
                          {isPreferredForScene ? " / preferred" : ""}
                        </span>
                        <em>{run.status}</em>
                      </button>
                    );
                  })
                )}
                {hasMoreRunsRows ? (
                  <button
                    className="list-load-more"
                    disabled={busy}
                    onClick={() =>
                      setRunsListLimit((prev) => prev + LIST_LIMIT_STEP)
                    }
                  >
                    Load More Runs
                  </button>
                ) : null}
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
                  <p className="run-meta">
                    Preferred for scene: {selectedGenerationRunPinned ? "yes" : "no"}
                  </p>
                  {selectedGenerationScenePinnedRunId ? (
                    <p className="run-meta">
                      Preferred run id: {selectedGenerationScenePinnedRunId}
                    </p>
                  ) : null}
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
                  {selectedGenerationRun.retrieval ? (
                    <div className="run-compare-table provenance-card">
                      <h5>Retrieval Provenance</h5>
                      <p className="run-meta">
                        Mode: {selectedGenerationRun.retrieval.mode || "off"} / used:{" "}
                        {selectedGenerationRun.retrieval.used ? "yes" : "no"} / results:{" "}
                        {selectedGenerationRun.retrieval.result_count ?? 0}
                      </p>
                      <p className="run-meta">
                        Query: {selectedGenerationRun.retrieval.query || "n/a"}
                      </p>
                      <p className="run-meta">
                        Index: {selectedGenerationRun.retrieval.index?.path || "n/a"} / stale:{" "}
                        {selectedGenerationRun.retrieval.index?.stale ? "yes" : "no"}
                      </p>
                      {selectedGenerationRun.retrieval.degraded ? (
                        <p className="run-meta">
                          Retrieval degraded: {selectedGenerationRun.retrieval.error || "unknown"}
                        </p>
                      ) : null}
                      {selectedGenerationRun.retrieval.citations?.length ? (
                        <div className="provenance-list">
                          {selectedGenerationRun.retrieval.citations.slice(0, 6).map((row) => (
                            <div
                              key={`${row.chunk_id || "chunk"}-${row.source_ref || "source"}`}
                              className="provenance-item"
                            >
                              <p className="run-meta">
                                {row.source_type || "unknown"}/{row.source_ref || "n/a"} (
                                {row.source_title || "untitled"})
                              </p>
                              <p className="run-meta">
                                score {row.score ?? "n/a"} / coverage {row.coverage ?? "n/a"}
                              </p>
                              <p className="run-meta">
                                terms: {row.matched_terms?.join(", ") || "n/a"}
                              </p>
                              <p className="run-meta">{row.excerpt || ""}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="run-meta">No citations attached.</p>
                      )}
                    </div>
                  ) : null}
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
                      <label>
                        <span>Retrieval Mode</span>
                        <select
                          value={rerunDraft.retrievalMode}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              retrievalMode: event.target.value as "off" | "auto" | "required"
                            }))
                          }
                        >
                          <option value="off">off</option>
                          <option value="auto">auto</option>
                          <option value="required">required</option>
                        </select>
                      </label>
                      <label>
                        <span>Retrieval Limit</span>
                        <input
                          type="number"
                          min="1"
                          value={rerunDraft.retrievalLimit}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              retrievalLimit: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Retrieval Min Score</span>
                        <input
                          type="number"
                          min="0"
                          step="0.05"
                          value={rerunDraft.retrievalMinScore}
                          onChange={(event) =>
                            setRerunDraft((prev) => ({
                              ...prev,
                              retrievalMinScore: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="run-compare-toggle">
                      <input
                        type="checkbox"
                        checked={rerunDraft.retrievalRequireFresh}
                        onChange={(event) =>
                          setRerunDraft((prev) => ({
                            ...prev,
                            retrievalRequireFresh: event.target.checked
                          }))
                        }
                      />
                      <span>Require fresh retrieval index</span>
                    </label>
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
                    <label>
                      <span>Recommendation Profile</span>
                      <select
                        value={comparisonProfileId}
                        onChange={(event) =>
                          setComparisonProfileId(event.target.value as RunComparisonProfileId)
                        }
                      >
                        {comparisonProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="run-compare-toggle">
                      <input
                        type="checkbox"
                        checked={comparisonAutoPrevious}
                        onChange={(event) => setComparisonAutoPrevious(event.target.checked)}
                      />
                      <span>Auto-select previous baseline</span>
                    </label>
                  </div>
                  <div className="proposal-actions">
                    <button
                      disabled={
                        busy ||
                        !selectedGenerationRun.scene_id ||
                        selectedGenerationRunPinned
                      }
                      onClick={() => void handlePinPreferredGenerationRun()}
                    >
                      Pin As Preferred
                    </button>
                    <button
                      disabled={busy || !selectedGenerationRun.scene_id}
                      onClick={() => void handleUnpinPreferredGenerationRun()}
                    >
                      Unpin Preferred
                    </button>
                    <button
                      disabled={
                        busy ||
                        !selectedGenerationRun.scene_id ||
                        !selectedGenerationScenePinnedRunId
                      }
                      onClick={() =>
                        void handleOpenPinnedGenerationRun(selectedGenerationRun.scene_id)
                      }
                    >
                      Open Preferred For Scene
                    </button>
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
                      <p className="run-meta">Profile: {comparisonProfileLabel}</p>
                      <p className="run-meta">
                        Instruction changed: {runComparison.instructionChanged ? "yes" : "no"}
                      </p>
                      <p
                        className={`run-meta run-recommendation verdict-${runComparison.recommendation.verdict}`}
                      >
                        Recommendation:{" "}
                        {runComparisonVerdictLabel(runComparison.recommendation.verdict)} (score{" "}
                        {runComparison.recommendation.score})
                      </p>
                      <p className="run-meta">{runComparisonActionHint}</p>
                      <p className="run-meta">{runComparison.recommendation.summary}</p>
                      {runComparison.recommendation.reasons.length ? (
                        <div className="run-recommendation-reasons">
                          {runComparison.recommendation.reasons.map((reason, index) => (
                            <p key={`${index}-${reason}`} className="run-meta">
                              - {reason}
                            </p>
                          ))}
                        </div>
                      ) : null}
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
                        <button
                          disabled={
                            busy ||
                            !selectedGenerationRun.scene_id ||
                            selectedGenerationRunPinned ||
                            runComparison.recommendation.verdict !== "likely_better"
                          }
                          onClick={() => void handlePinPreferredGenerationRun()}
                        >
                          Promote Current
                        </button>
                        <button
                          disabled={
                            busy ||
                            !comparisonBaselineRun?.scene_id ||
                            runComparison.recommendation.verdict !== "likely_worse"
                          }
                          onClick={() => void handlePinBaselineGenerationRun()}
                        >
                          Promote Baseline
                        </button>
                        <button
                          disabled={busy || !comparisonBaselineRun}
                          onClick={handleOpenBaselineRun}
                        >
                          Open Baseline Run
                        </button>
                        <button
                          disabled={
                            busy || !(comparisonBaselineRun?.proposal_id ?? "").trim()
                          }
                          onClick={() => void handleOpenBaselineProposal()}
                        >
                          Open Baseline Proposal
                        </button>
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
          ) : rightTab === "merge" ? (
            <div className="side-content merge-content">
              <div className="runs-header">
                <h2>Guided Merge</h2>
                <span>current: {currentBranchName || "n/a"}</span>
              </div>

              <div className="merge-create-card">
                <h3>Create Branch</h3>
                <div className="row">
                  <input
                    value={branchCreateDraft.name}
                    onChange={(event) =>
                      setBranchCreateDraft((prev) => ({
                        ...prev,
                        name: event.target.value
                      }))
                    }
                    placeholder="branch name"
                  />
                  <input
                    value={branchCreateDraft.fromRef}
                    onChange={(event) =>
                      setBranchCreateDraft((prev) => ({
                        ...prev,
                        fromRef: event.target.value
                      }))
                    }
                    placeholder="from ref (default current)"
                  />
                </div>
                <label className="run-compare-toggle">
                  <input
                    type="checkbox"
                    checked={branchCreateDraft.noSwitch}
                    onChange={(event) =>
                      setBranchCreateDraft((prev) => ({
                        ...prev,
                        noSwitch: event.target.checked
                      }))
                    }
                  />
                  <span>Create without switching</span>
                </label>
                <button
                  disabled={busy || branchCreateDraft.name.trim() === ""}
                  onClick={() => void handleCreateBranchWorkspace()}
                >
                  Create Branch
                </button>
              </div>

              <div className="merge-controls">
                <label>
                  <span>Base Branch</span>
                  <select
                    value={mergeBaseBranch}
                    onChange={(event) => setMergeBaseBranch(event.target.value)}
                  >
                    <option value="">select base</option>
                    {branches.map((branch) => (
                      <option key={`base-${branch.name}`} value={branch.name}>
                        {branch.name}
                        {branch.current ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Head Branch</span>
                  <select
                    value={mergeHeadBranch}
                    onChange={(event) => setMergeHeadBranch(event.target.value)}
                  >
                    <option value="">select head</option>
                    {branches.map((branch) => (
                      <option key={`head-${branch.name}`} value={branch.name}>
                        {branch.name}
                        {branch.current ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy || !projectFound} onClick={() => void refreshBranches()}>
                  Refresh Branches
                </button>
                <button
                  disabled={busy || !mergeBaseBranch || !mergeHeadBranch}
                  onClick={() => void handleAnalyzeMergePlan()}
                >
                  Analyze Merge
                </button>
              </div>

              <div className={`merge-guidance tone-${mergeGuidance.tone}`}>
                <strong>{mergeGuidance.label}</strong>
                <p className="run-meta">{mergeGuidance.detail}</p>
              </div>

              {branchPreflightReport ? (
                <div className="merge-preflight-card">
                  <h3>Preflight</h3>
                  <p className="run-meta">
                    merge-base: {branchPreflightReport.merge_base}
                  </p>
                  <p className="run-meta">
                    base changed: {branchPreflightReport.base_changed_count} / head changed:{" "}
                    {branchPreflightReport.head_changed_count} / overlap:{" "}
                    {branchPreflightReport.overlap_count}
                  </p>
                  <p className="run-meta">
                    safe_to_merge: {branchPreflightReport.safe_to_merge ? "yes" : "no"} / risk:{" "}
                    {branchPreflightReport.risk_level}
                  </p>
                  <div className="run-compare-table">
                    <h5>Overlap Categories</h5>
                    {Object.entries(branchPreflightReport.overlap_by_category).map(
                      ([category, rows]) =>
                        rows.length ? (
                          <p key={category} className="run-meta">
                            {category}: {rows.length}
                          </p>
                        ) : null
                    )}
                  </div>
                  {branchPreflightReport.recommendations.length ? (
                    <div className="run-recommendation-reasons">
                      {branchPreflightReport.recommendations.map((row, index) => (
                        <p key={`${index}-${row}`} className="run-meta">
                          - {row}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="merge-preflight-card empty-review">
                  <p>Run merge analysis to view preflight risk.</p>
                </div>
              )}

              {branchDiffReport ? (
                <div className="merge-diff-card">
                  <h3>Branch Diff</h3>
                  <p className="run-meta">
                    {branchDiffReport.base}...{branchDiffReport.head} / ahead{" "}
                    {branchDiffReport.ahead_by} / behind {branchDiffReport.behind_by}
                  </p>
                  <div className="merge-diff-list">
                    {branchDiffReport.files.length === 0 ? (
                      <p className="run-meta">No authoring file changes.</p>
                    ) : (
                      branchDiffReport.files.slice(0, 40).map((file) => (
                        <p key={`${file.status}-${file.path}`} className="run-meta">
                          {file.status} {file.path} (+{file.added ?? "n/a"} / -{file.deleted ?? "n/a"})
                        </p>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              <div className="proposal-actions">
                <button
                  disabled={busy || !mergeGuidance.canApply}
                  onClick={() => void handleApplyMergePlan()}
                >
                  Apply Merge
                </button>
                <button
                  disabled={busy || !mergeBaseBranch}
                  onClick={() => void handleSwitchBranchWorkspace(mergeBaseBranch)}
                >
                  Switch To Base
                </button>
                <button
                  disabled={busy || !mergeHeadBranch}
                  onClick={() => void handleSwitchBranchWorkspace(mergeHeadBranch)}
                >
                  Switch To Head
                </button>
              </div>

              {branchMergeResult ? (
                <div className="merge-result-card">
                  <h3>Last Merge Result</h3>
                  <p className="run-meta">
                    merged {branchMergeResult.head} into {branchMergeResult.base}
                  </p>
                  <p className="run-meta">commit: {branchMergeResult.merge_commit}</p>
                </div>
              ) : null}
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
                    <h3>Preferred Pipeline</h3>
                    <div className="pipeline-health">
                      <span className={`pipeline-health-badge tone-${preferredPipelineHealth.tone}`}>
                        {preferredPipelineHealth.label}
                      </span>
                      <p className="context-sub">{preferredPipelineHealth.detail}</p>
                    </div>
                    <p className="context-sub">
                      Pinned run: {selectedScenePinnedRunId || "none"}
                    </p>
                    {selectedScenePinnedRunDetail ? (
                      <p className="context-sub">
                        Pinned run status: {selectedScenePinnedRunDetail.status}
                      </p>
                    ) : null}
                    {selectedSceneLinkedProposal ? (
                      <>
                        <p className="context-sub">
                          Linked proposal: {selectedSceneLinkedProposal.id} (
                          {selectedSceneLinkedProposal.status})
                        </p>
                        <p className="context-sub">{selectedSceneLinkedProposal.title}</p>
                      </>
                    ) : (
                      <p className="context-sub">
                        Linked proposal: {selectedScenePinnedRunId ? "not found" : "n/a"}
                      </p>
                    )}
                    <div className="context-actions">
                      <button
                        disabled={busy || !scene.id || !selectedScenePinnedRunId}
                        onClick={() => void handleOpenPinnedGenerationRun(scene.id)}
                      >
                        Open Preferred Run
                      </button>
                      <button
                        disabled={busy || !scene.id || !selectedScenePinnedRunId}
                        onClick={() => void handleOpenPinnedProposal(scene.id)}
                      >
                        Open Preferred Proposal
                      </button>
                      <button
                        disabled={busy || !scene.id}
                        onClick={() => handleFocusPreferredProposalQueue(scene.id)}
                      >
                        Focus Preferred Queue
                      </button>
                      <button
                        disabled={busy || !scene.id}
                        onClick={() => handlePrepareGenerateProposalForScene(scene.id)}
                      >
                        Open Generate Form
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void handleRefreshProposalsForRecovery()}
                      >
                        Refresh Proposals
                      </button>
                      <button
                        disabled={
                          busy ||
                          preferredPipelineHealth.code !== "stale_pin" ||
                          !scene.id
                        }
                        onClick={() => void handleClearPreferredPin(scene.id)}
                      >
                        Clear Stale Pin
                      </button>
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
        {busy ? <p className="busy">Working...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {message ? <p>{message}</p> : null}
      </footer>
    </main>
  );
}
