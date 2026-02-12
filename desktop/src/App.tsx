import { useEffect, useMemo, useRef, useState } from "react";
import {
  addCodexEntity,
  addScene,
  applyProposal,
  createBranch,
  createChatThread,
  createProposal,
  diffBranches,
  executeChatToolCall,
  generateProposal,
  getGenerationBudget,
  getGenerationRun,
  getGenerationRuntimeConfig,
  getCodexEntity,
  getProjectStatus,
  getScene,
  listBranches,
  listChatMessages,
  listChatThreads,
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
  runPerformanceBaseline,
  sendChatMessage,
  runWorkspaceAudit,
  switchBranch,
  unpinGenerationRun,
  updateChatThread,
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
import { buildDictationProposalDraft } from "./voiceDictation";
import type {
  BranchDiffReport,
  BranchMergeResult,
  BranchPreflightReport,
  BranchSummary,
  ChatMessageRecord,
  ChatSendResult,
  ChatThreadRecord,
  CodexEntity,
  ContinuityIssue,
  GenerationBudgetReport,
  GenerationRunDetail,
  GenerationRuntimeConfig,
  GenerationRunSummary,
  PerformanceBaselineReport,
  ProposalProvider,
  ProposalRecord,
  SceneDetail,
  SceneSummary,
  WorkspaceAuditReport
} from "./types";

const PROJECT_ROOT_STORAGE_KEY = "openauthor.projectRoot";
const THEME_STORAGE_KEY = "openauthor.theme";

type Theme = "light" | "dark";

function loadDefaultTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

const SIDEBAR_OPEN_STORAGE_KEY = "openauthor.sidebarOpen";
const SIDEBAR_CONTENT_STORAGE_KEY = "openauthor.sidebarContent";

function loadDefaultSidebarOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    if (stored === "false") return false;
  } catch {}
  return true;
}

function loadDefaultSidebarContent(): SidebarContent {
  if (typeof window === "undefined") return "scenes";
  try {
    const stored = window.localStorage.getItem(SIDEBAR_CONTENT_STORAGE_KEY);
    if (stored === "scenes" || stored === "codex" || stored === "context") return stored;
  } catch {}
  return "scenes";
}

function loadDefaultRoot(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PROJECT_ROOT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

type RightTab = "proposals" | "codex" | "checks" | "context" | "runs" | "merge";
type CenterView = "editor" | "outliner" | "chat" | "review";
type SidebarContent = "scenes" | "codex" | "context";
type ViewMode = "write" | "plan" | "chat" | "review";
type ReviewSection = "proposals" | "runs" | "checks" | "merge";
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

type DraftChatThread = {
  title: string;
  provider: ProposalProvider;
  model: string;
  mode: "chat" | "agent";
};

type DraftChatComposer = {
  message: string;
  currentSceneId: string;
  selectedText: string;
  includeCurrentScene: boolean;
  includeSelection: boolean;
  includeRecentScenesRadius: number;
  includeCodex: "off" | "explicit" | "auto" | "auto_and_explicit";
  retrievalMode: "off" | "auto" | "required";
  retrievalLimit: number;
  retrievalMinScore: number;
  retrievalRequireFresh: boolean;
  agentAutoReadOnly: boolean;
  agentConfirmWrites: boolean;
};

type VoiceInputMode = "command" | "dictation";
type VoiceActionKind = "intent" | "dictation";

type VoicePendingAction = {
  id: string;
  createdAt: string;
  source: "stt" | "manual";
  transcript: string;
  normalized: string;
  confidence: number;
  kind: VoiceActionKind;
  intent: VoiceIntent;
  summary: string;
};

type VoiceUndoAction = {
  label: string;
  run: () => Promise<void>;
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

const EMPTY_DRAFT_CHAT_THREAD: DraftChatThread = {
  title: "",
  provider: "local",
  model: "",
  mode: "chat"
};

const EMPTY_DRAFT_CHAT_COMPOSER: DraftChatComposer = {
  message: "",
  currentSceneId: "",
  selectedText: "",
  includeCurrentScene: true,
  includeSelection: true,
  includeRecentScenesRadius: 1,
  includeCodex: "auto_and_explicit",
  retrievalMode: "off",
  retrievalLimit: 5,
  retrievalMinScore: 0,
  retrievalRequireFresh: false,
  agentAutoReadOnly: true,
  agentConfirmWrites: true
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
  const [theme, setTheme] = useState<Theme>(loadDefaultTheme);
  const [rightTab, setRightTab] = useState<RightTab>("proposals");
  const [centerView, setCenterView] = useState<CenterView>("editor");
  const [sidebarOpen, setSidebarOpen] = useState(loadDefaultSidebarOpen);
  const [sidebarContent, setSidebarContent] = useState<SidebarContent>(loadDefaultSidebarContent);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceDrawerOpen, setVoiceDrawerOpen] = useState(false);
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
  const [chatThreads, setChatThreads] = useState<ChatThreadRecord[]>([]);
  const [selectedChatThreadId, setSelectedChatThreadId] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);
  const [chatThreadDraft, setChatThreadDraft] = useState<DraftChatThread>(
    EMPTY_DRAFT_CHAT_THREAD
  );
  const [chatComposerDraft, setChatComposerDraft] = useState<DraftChatComposer>(
    EMPTY_DRAFT_CHAT_COMPOSER
  );
  const [chatPendingToolCalls, setChatPendingToolCalls] = useState<
    Array<{
      assistantMessageId: string;
      index: number;
      tool: string;
      classification: string;
      summary: string;
      error: string;
    }>
  >([]);
  const [selectedScenePinnedRunDetail, setSelectedScenePinnedRunDetail] =
    useState<GenerationRunDetail | null>(null);
  const [selectedScenePinnedRunStale, setSelectedScenePinnedRunStale] = useState(false);
  const voiceSttRef = useRef<ReturnType<typeof createBrowserVoiceStt> | null>(null);
  const submitVoiceTranscriptRef = useRef<
    (transcript: string, source: "stt" | "manual") => Promise<void> | void
  >(() => undefined);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceProviderLabel, setVoiceProviderLabel] = useState("none");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceInterimTranscript, setVoiceInterimTranscript] = useState("");
  const [voiceDraftTranscript, setVoiceDraftTranscript] = useState("");
  const [voiceLogRows, setVoiceLogRows] = useState<VoiceCommandLogEntry[]>([]);
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>("command");
  const [voiceRequireConfirmation, setVoiceRequireConfirmation] = useState(true);
  const [voicePendingAction, setVoicePendingAction] = useState<VoicePendingAction | null>(null);
  const [voiceLastUndoAction, setVoiceLastUndoAction] = useState<VoiceUndoAction | null>(
    null
  );
  const [voiceLastUndoLabel, setVoiceLastUndoLabel] = useState("");
  const [voiceUndoBusy, setVoiceUndoBusy] = useState(false);
  const [workspaceAuditReport, setWorkspaceAuditReport] =
    useState<WorkspaceAuditReport | null>(null);
  const [performanceBaselineReport, setPerformanceBaselineReport] =
    useState<PerformanceBaselineReport | null>(null);
  const [performanceBaselineRepeat, setPerformanceBaselineRepeat] = useState("3");

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

  type VoiceExecutionResult = {
    status: "executed" | "rejected";
    detail: string;
    undo?: VoiceUndoAction;
  };

  function normalizeTranscriptForLog(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function queueVoicePendingAction(action: Omit<VoicePendingAction, "id" | "createdAt">) {
    const queued: VoicePendingAction = {
      ...action,
      id: `voice-pending-${Math.random().toString(16).slice(2, 10)}`,
      createdAt: new Date().toISOString()
    };
    setVoicePendingAction(queued);
    setMessage(`Queued voice action: ${queued.summary}. Confirm or discard.`);
    setError("");
  }

  async function executeVoiceIntent(intent: VoiceIntent): Promise<VoiceExecutionResult> {
    if (intent.kind === "open_tab") {
      const previousTab = rightTab;
      navigateToPanel(intent.tab);
      const detail = `Opened ${intent.tab} tab.`;
      return {
        status: "executed",
        detail,
        undo:
          previousTab !== intent.tab
            ? {
                label: `Restore ${previousTab} tab`,
                run: async () => {
                  navigateToPanel(previousTab);
                  setMessage(`Restored ${previousTab} tab.`);
                  setError("");
                }
              }
            : undefined
      };
    }

    if (intent.kind === "open_view") {
      const previousView = centerView;
      setCenterView(intent.view);
      const detail = `Opened ${intent.view} view.`;
      return {
        status: "executed",
        detail,
        undo:
          previousView !== intent.view
            ? {
                label: `Restore ${previousView} view`,
                run: async () => {
                  setCenterView(previousView);
                  setMessage(`Restored ${previousView} view.`);
                  setError("");
                }
              }
            : undefined
      };
    }

    if (intent.kind === "open_scene") {
      if (!scenes.some((item) => item.id === intent.sceneId)) {
        return {
          status: "rejected",
          detail: `Scene '${intent.sceneId}' no longer exists in this project.`
        };
      }
      const previousSceneId = selectedSceneId;
      const previousView = centerView;
      handleOpenGenerationScene(intent.sceneId);
      return {
        status: "executed",
        detail: `Loaded ${intent.sceneId}.`,
        undo: {
          label: "Restore prior scene focus",
          run: async () => {
            setCenterView(previousView);
            setSelectedSceneId(previousSceneId);
            setMessage("Restored previous scene focus.");
            setError("");
          }
        }
      };
    }

    if (intent.kind === "save_scene") {
      if (busy || centerView !== "editor" || !canSaveScene) {
        return {
          status: "rejected",
          detail: "Cannot save scene in current state."
        };
      }
      await handleSaveScene();
      return {
        status: "executed",
        detail: "Saved current scene."
      };
    }

    if (intent.kind === "run_continuity_checks") {
      if (busy || !projectFound) {
        return {
          status: "rejected",
          detail: "Cannot run continuity checks before project load."
        };
      }
      navigateToPanel("checks");
      await handleRunContinuityChecks();
      return {
        status: "executed",
        detail: "Ran continuity checks."
      };
    }

    if (intent.kind === "generate_proposal") {
      const nextDraft: DraftGeneratedProposal = {
        ...proposalGenerateForm,
        sceneId: intent.sceneId || proposalGenerateForm.sceneId || selectedSceneId,
        instruction:
          intent.instruction && intent.instruction.trim() !== ""
            ? intent.instruction.trim()
            : proposalGenerateForm.instruction
      };
      navigateToPanel("proposals");
      setProposalGenerateForm(nextDraft);
      if (nextDraft.sceneId === "" || nextDraft.instruction.trim() === "") {
        return {
          status: "rejected",
          detail:
            "Prepared proposal generate form from voice command; provide missing scene/instruction."
        };
      }
      const generated = await generateProposalFromDraft(nextDraft);
      const generatedId = generated?.id?.trim() ?? "";
      return {
        status: "executed",
        detail: generatedId
          ? `Generated proposal ${generatedId} from voice command.`
          : "Generated proposal from voice command.",
        undo: generatedId
          ? {
              label: `Reject ${generatedId}`,
              run: async () => {
                await handleRejectProposal(generatedId);
                navigateToPanel("proposals");
                setSelectedProposalId(generatedId);
                setMessage(`Undo complete. Rejected ${generatedId}.`);
                setError("");
              }
            }
          : undefined
      };
    }

    if (!scenes.some((item) => item.id === intent.sceneId)) {
      return {
        status: "rejected",
        detail: `Scene '${intent.sceneId}' no longer exists in this project.`
      };
    }
    const dictationDraft = buildDictationProposalDraft(intent.sceneId, intent.transcript);
    setBusy(true);
    try {
      const created = await createProposal(projectRoot, {
        title: dictationDraft.title,
        instruction: dictationDraft.instruction,
        sceneId: dictationDraft.sceneId
      });
      await refreshProposalList(created.id);
      navigateToPanel("proposals");
      setSelectedProposalId(created.id);
      return {
        status: "executed",
        detail: `Created dictation proposal ${created.id} for ${intent.sceneId}.`,
        undo: {
          label: `Reject ${created.id}`,
          run: async () => {
            await handleRejectProposal(created.id);
            navigateToPanel("proposals");
            setSelectedProposalId(created.id);
            setMessage(`Undo complete. Rejected ${created.id}.`);
            setError("");
          }
        }
      };
    } finally {
      setBusy(false);
    }
  }

  async function executeVoiceAction(action: VoicePendingAction) {
    try {
      const result = await executeVoiceIntent(action.intent);
      recordVoiceCommand({
        source: action.source,
        transcript: action.transcript,
        normalized: action.normalized,
        confidence: action.confidence,
        status: result.status,
        intent: action.intent,
        detail: result.detail
      });
      if (result.status === "rejected") {
        setError(result.detail);
        setMessage("");
        return;
      }
      setVoiceLastUndoAction(result.undo ?? null);
      setVoiceLastUndoLabel(result.undo?.label ?? "");
      setError("");
      setMessage(result.detail);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      recordVoiceCommand({
        source: action.source,
        transcript: action.transcript,
        normalized: action.normalized,
        confidence: action.confidence,
        status: "failed",
        intent: action.intent,
        detail
      });
      reportError("Voice command failed", err, "Review transcript and retry.");
    }
  }

  async function submitVoiceTranscript(transcript: string, source: "stt" | "manual") {
    const trimmed = transcript.trim();
    if (!trimmed) return;

    if (voiceInputMode === "dictation") {
      const targetSceneId = (selectedSceneId || proposalGenerateForm.sceneId || "").trim();
      if (!targetSceneId) {
        const detail = "Dictation mode requires a selected scene.";
        recordVoiceCommand({
          source,
          transcript: trimmed,
          normalized: normalizeTranscriptForLog(trimmed),
          confidence: 1,
          status: "rejected",
          intent: null,
          detail
        });
        setError(detail);
        setMessage("");
        return;
      }
      const intent: VoiceIntent = {
        kind: "dictate_scene",
        sceneId: targetSceneId,
        transcript: trimmed
      };
      const pending: Omit<VoicePendingAction, "id" | "createdAt"> = {
        source,
        transcript: trimmed,
        normalized: normalizeTranscriptForLog(trimmed),
        confidence: 1,
        kind: "dictation",
        intent,
        summary: `Create dictation proposal for ${targetSceneId}`
      };
      if (voiceRequireConfirmation) {
        queueVoicePendingAction(pending);
        return;
      }
      await executeVoiceAction({
        ...pending,
        id: "voice-immediate",
        createdAt: new Date().toISOString()
      });
      return;
    }

    const parsed = parseVoiceCommand(trimmed);
    if (!parsed.intent) {
      const detail = `Voice command not recognized: ${parsed.reason}`;
      recordVoiceCommand({
        source,
        transcript: trimmed,
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
    const pending: Omit<VoicePendingAction, "id" | "createdAt"> = {
      source,
      transcript: trimmed,
      normalized: parsed.normalized,
      confidence: parsed.confidence,
      kind: "intent",
      intent: parsed.intent,
      summary: `Run ${parsed.intent.kind.replace(/_/g, " ")}`
    };
    if (voiceRequireConfirmation) {
      queueVoicePendingAction(pending);
      return;
    }
    await executeVoiceAction({
      ...pending,
      id: "voice-immediate",
      createdAt: new Date().toISOString()
    });
  }

  async function handleConfirmVoicePendingAction() {
    if (!voicePendingAction) return;
    const action = voicePendingAction;
    setVoicePendingAction(null);
    await executeVoiceAction(action);
  }

  function handleDiscardVoicePendingAction() {
    if (!voicePendingAction) return;
    recordVoiceCommand({
      source: voicePendingAction.source,
      transcript: voicePendingAction.transcript,
      normalized: voicePendingAction.normalized,
      confidence: voicePendingAction.confidence,
      status: "ignored",
      intent: voicePendingAction.intent,
      detail: "Discarded pending voice action."
    });
    setVoicePendingAction(null);
    setMessage("Discarded pending voice action.");
    setError("");
  }

  async function handleUndoVoiceAction() {
    if (!voiceLastUndoAction) return;
    setVoiceUndoBusy(true);
    try {
      await voiceLastUndoAction.run();
      recordVoiceCommand({
        source: "manual",
        transcript: "undo voice action",
        normalized: "undo voice action",
        confidence: 1,
        status: "executed",
        intent: null,
        detail: `Undo completed: ${voiceLastUndoLabel || "previous voice action"}.`
      });
      setVoiceLastUndoAction(null);
      setVoiceLastUndoLabel("");
    } catch (err) {
      reportError("Voice undo failed", err, "Retry undo or resolve manually in proposals.");
    } finally {
      setVoiceUndoBusy(false);
    }
  }

  useEffect(() => {
    submitVoiceTranscriptRef.current = submitVoiceTranscript;
  }, [submitVoiceTranscript]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(sidebarOpen));
    } catch {}
  }, [sidebarOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_CONTENT_STORAGE_KEY, sidebarContent);
    } catch {}
  }, [sidebarContent]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const menus = document.querySelectorAll<HTMLElement>(".dropdown-menu");
        let closedAny = false;
        menus.forEach((el) => {
          if (el.style.display === "block") {
            el.style.display = "none";
            closedAny = true;
          }
        });
        if (!closedAny) {
          if (settingsOpen) setSettingsOpen(false);
          else if (voiceDrawerOpen) setVoiceDrawerOpen(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, voiceDrawerOpen]);

  function toggleTheme() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  function navigateToPanel(tab: RightTab) {
    navigateToPanel(tab);
    if (tab === "codex") {
      setSidebarContent("codex");
      setSidebarOpen(true);
    } else if (tab === "context") {
      setSidebarContent("context");
      setSidebarOpen(true);
    } else {
      setCenterView("review");
    }
  }

  const viewMode: ViewMode = centerView === "editor"
    ? "write"
    : centerView === "outliner"
      ? "plan"
      : centerView === "chat"
        ? "chat"
        : "review";

  const reviewSection: ReviewSection =
    rightTab === "runs" ? "runs" :
    rightTab === "checks" ? "checks" :
    rightTab === "merge" ? "merge" : "proposals";

  function setViewMode(mode: ViewMode) {
    if (mode === "write") setCenterView("editor");
    else if (mode === "plan") setCenterView("outliner");
    else if (mode === "chat") setCenterView("chat");
    else setCenterView("review");
  }

  function setReviewSection(section: ReviewSection) {
    navigateToPanel(section);
    setCenterView("review");
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
  const selectedChatThread = useMemo(
    () => chatThreads.find((item) => item.id === selectedChatThreadId) ?? null,
    [chatThreads, selectedChatThreadId]
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

  const wordCount = useMemo(() => {
    if (!draft.body) return 0;
    return draft.body.trim().split(/\s+/).filter(Boolean).length;
  }, [draft.body]);

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

  async function refreshChatThreads(nextSelectedThreadId?: string) {
    const rows = await listChatThreads(projectRoot);
    setChatThreads(rows);
    if (rows.length === 0) {
      setSelectedChatThreadId("");
      setChatMessages([]);
      setChatPendingToolCalls([]);
      return;
    }
    const target =
      nextSelectedThreadId && rows.some((item) => item.id === nextSelectedThreadId)
        ? nextSelectedThreadId
        : selectedChatThreadId && rows.some((item) => item.id === selectedChatThreadId)
          ? selectedChatThreadId
          : rows[0].id;
    setSelectedChatThreadId(target);
  }

  async function refreshChatMessages(threadId: string) {
    if (!threadId) {
      setChatMessages([]);
      setChatPendingToolCalls([]);
      return;
    }
    const rows = await listChatMessages(projectRoot, { threadId, limit: 300 });
    setChatMessages(rows);
    const pending: Array<{
      assistantMessageId: string;
      index: number;
      tool: string;
      classification: string;
      summary: string;
      error: string;
    }> = [];
    for (const row of rows) {
      if (row.role !== "assistant") continue;
      const toolCalls = Array.isArray(row.tool_calls) ? row.tool_calls : [];
      toolCalls.forEach((toolCall, index) => {
        if (toolCall.executed) return;
        const classification = String(toolCall.classification ?? "");
        if (classification === "read") return;
        pending.push({
          assistantMessageId: row.id,
          index,
          tool: String(toolCall.tool ?? ""),
          classification,
          summary: String(toolCall.result_summary ?? ""),
          error: String(toolCall.error ?? "")
        });
      });
    }
    setChatPendingToolCalls(pending);
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
      refreshChatThreads(),
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
      if (status.project_root && status.project_root !== projectRoot) {
        setProjectRoot(status.project_root);
      }
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
        setChatThreads([]);
        setSelectedChatThreadId("");
        setChatMessages([]);
        setChatPendingToolCalls([]);
        setChatThreadDraft(EMPTY_DRAFT_CHAT_THREAD);
        setChatComposerDraft(EMPTY_DRAFT_CHAT_COMPOSER);
        setMessage("");
        setError(
          `No openAuthor project found at '${status.project_root || projectRoot}'. ` +
            "Choose a folder initialized with `openauthor init`."
        );
        return;
      }
      await Promise.all([
        refreshSceneList(),
        refreshProposalList(),
        refreshCodexList(),
        refreshChatThreads(),
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
    setVoicePendingAction(null);
    setVoiceLastUndoAction(null);
    setVoiceLastUndoLabel("");
    setWorkspaceAuditReport(null);
    setPerformanceBaselineReport(null);
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
          void submitVoiceTranscriptRef.current(row.transcript, "stt");
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
        navigateToPanel("proposals");
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
        navigateToPanel("checks");
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
        navigateToPanel("runs");
        setError("");
        setMessage("Opened Runs tab.");
        return;
      }

      if (action === "toggle_sidebar") {
        event.preventDefault();
        setSidebarOpen((prev) => !prev);
        return;
      }

      if (action === "switch_write") {
        event.preventDefault();
        setViewMode("write");
        return;
      }

      if (action === "switch_plan") {
        event.preventDefault();
        setViewMode("plan");
        return;
      }

      if (action === "switch_chat") {
        event.preventDefault();
        setViewMode("chat");
        return;
      }

      if (action === "switch_review") {
        event.preventDefault();
        setViewMode("review");
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
    setChatComposerDraft((prev) => ({
      ...prev,
      currentSceneId: prev.currentSceneId || selectedSceneId
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
    if (!selectedChatThreadId) {
      setChatMessages([]);
      setChatPendingToolCalls([]);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    void refreshChatMessages(selectedChatThreadId)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatThreadId]);

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

  async function generateProposalFromDraft(
    input: DraftGeneratedProposal
  ): Promise<ProposalRecord | null> {
    if (input.instruction.trim() === "") return null;
    const sceneId = input.sceneId || selectedSceneId;
    if (!sceneId) {
      setError("Select a scene (or enter a scene id) before generating a proposal.");
      return null;
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
      return generated;
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
      return null;
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

  async function handleCreateChatThread() {
    if (chatThreadDraft.title.trim() === "") return;
    setBusy(true);
    setError("");
    setMessage("Creating chat thread...");
    try {
      const created = await createChatThread(projectRoot, {
        title: chatThreadDraft.title,
        provider: chatThreadDraft.provider,
        model: chatThreadDraft.model,
        mode: chatThreadDraft.mode
      });
      await refreshChatThreads(created.id);
      await refreshChatMessages(created.id);
      setChatThreadDraft((prev) => ({
        ...prev,
        title: ""
      }));
      setCenterView("chat");
      setMessage(`Chat thread created (${created.provider}/${created.model}).`);
    } catch (err) {
      reportError("Chat thread create failed", err, "Review thread settings and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendChatMessage() {
    if (!selectedChatThreadId) {
      setError("Create or select a chat thread first.");
      return;
    }
    const messageText = chatComposerDraft.message.trim();
    if (messageText === "") return;
    setBusy(true);
    setError("");
    setMessage("Sending chat message...");
    try {
      const result: ChatSendResult = await sendChatMessage(projectRoot, {
        threadId: selectedChatThreadId,
        message: messageText,
        currentSceneId: chatComposerDraft.currentSceneId.trim(),
        selectedText: chatComposerDraft.selectedText,
        includeCurrentScene: chatComposerDraft.includeCurrentScene,
        includeSelection: chatComposerDraft.includeSelection,
        includeRecentScenesRadius: chatComposerDraft.includeRecentScenesRadius,
        includeCodex: chatComposerDraft.includeCodex,
        retrievalMode: chatComposerDraft.retrievalMode,
        retrievalLimit: chatComposerDraft.retrievalLimit,
        retrievalMinScore: chatComposerDraft.retrievalMinScore,
        retrievalRequireFresh: chatComposerDraft.retrievalRequireFresh,
        agentAutoReadOnly: chatComposerDraft.agentAutoReadOnly,
        agentConfirmWrites: chatComposerDraft.agentConfirmWrites
      });
      await refreshChatThreads(result.thread.id);
      await refreshChatMessages(result.thread.id);
      setChatComposerDraft((prev) => ({
        ...prev,
        message: "",
        currentSceneId: prev.currentSceneId || selectedSceneId
      }));
      if (result.pending_tool_calls.length > 0) {
        setMessage(
          `Assistant responded with ${result.pending_tool_calls.length} pending tool call(s).`
        );
      } else {
        setMessage("Chat response received.");
      }
    } catch (err) {
      reportError("Chat send failed", err, "Check provider settings or prompt content and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleExecutePendingChatTool(
    assistantMessageId: string,
    toolIndex: number
  ) {
    if (!selectedChatThreadId) return;
    setBusy(true);
    setError("");
    setMessage("Executing pending chat tool...");
    try {
      const executed = await executeChatToolCall(projectRoot, {
        threadId: selectedChatThreadId,
        assistantMessageId,
        index: toolIndex
      });
      await refreshChatMessages(selectedChatThreadId);
      await refreshProposalList();
      await refreshCodexList();
      await refreshSceneList();
      setMessage(
        `Executed ${executed.tool} from message ${executed.assistant_message_id}.`
      );
    } catch (err) {
      reportError("Chat tool execution failed", err, "Review pending tool call and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateSelectedThreadMode(mode: "chat" | "agent") {
    if (!selectedChatThreadId) return;
    setBusy(true);
    setError("");
    setMessage("Updating thread mode...");
    try {
      await updateChatThread(projectRoot, {
        id: selectedChatThreadId,
        mode
      });
      await refreshChatThreads(selectedChatThreadId);
      setMessage(`Thread mode set to ${mode}.`);
    } catch (err) {
      reportError("Thread update failed", err, "Retry mode change.");
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
      navigateToPanel("proposals");
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
      navigateToPanel("runs");
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
      navigateToPanel("proposals");
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
    navigateToPanel("proposals");
    setProposalGenerateForm((prev) => ({
      ...prev,
      sceneId
    }));
    setMessage(`Generate form set to ${sceneId}.`);
    setError("");
  }

  function handleFocusPreferredProposalQueue(sceneId: string) {
    navigateToPanel("proposals");
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
    setMessage(
      voiceInputMode === "dictation"
        ? "Listening for dictation transcript..."
        : "Listening for voice command..."
    );
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

  async function handleRunWorkspaceAudit(repair: boolean) {
    setBusy(true);
    setError("");
    setMessage(repair ? "Running workspace drift audit with repair..." : "Running workspace drift audit...");
    try {
      const report = await runWorkspaceAudit(projectRoot, repair);
      setWorkspaceAuditReport(report);
      if (repair) {
        await Promise.all([
          refreshGenerationPins(),
          refreshGenerationRuns(),
          refreshProposalList()
        ]);
      }
      if (report.ok) {
        setMessage("Workspace audit passed with no drift issues.");
      } else {
        setMessage(
          `Workspace audit found ${report.issues.length} issue(s)${
            report.repair_applied ? "; safe repairs applied." : "."
          }`
        );
      }
    } catch (err) {
      reportError("Workspace audit failed", err, "Retry audit or inspect CLI diagnostics.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunPerformanceBaseline() {
    const repeat = Number.parseInt(performanceBaselineRepeat, 10);
    const normalizedRepeat = Number.isFinite(repeat) && repeat > 0 ? repeat : 3;
    setBusy(true);
    setError("");
    setMessage("Collecting performance baseline...");
    try {
      const report = await runPerformanceBaseline(projectRoot, normalizedRepeat);
      setPerformanceBaselineReport(report);
      setMessage("Collected performance baseline.");
    } catch (err) {
      reportError("Performance baseline failed", err, "Retry baseline with a smaller repeat count.");
    } finally {
      setBusy(false);
    }
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
      navigateToPanel("proposals");
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
    <div className="app-shell" data-theme={theme}>

      {/* ── Top Bar ──────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="topbar-icon-btn"
            onClick={() => setSidebarOpen((prev) => !prev)}
            title="Toggle sidebar (Cmd+B)"
            aria-label="Toggle sidebar"
            aria-expanded={sidebarOpen}
          >
            &#9776;
          </button>
          <h1>openAuthor</h1>
          <div className={`status-pill ${projectFound ? "ok" : "warn"}`}>
            {projectFound ? "Ready" : "No Project"}
          </div>
        </div>

        <div className="topbar-center">
          <div className="dropdown">
            <button
              className="dropdown-trigger" aria-haspopup="true"
              onClick={() => {
                const el = document.getElementById("viewmode-menu");
                if (el) el.style.display = el.style.display === "block" ? "none" : "block";
              }}
            >
              {viewMode === "write" ? "Write" : viewMode === "plan" ? "Plan" : viewMode === "chat" ? "Chat" : "Review"}
            </button>
            <div id="viewmode-menu" className="dropdown-menu" role="menu" style={{ display: "none" }}>
              {(["write", "plan", "chat", "review"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`dropdown-item ${viewMode === mode ? "active" : ""}`} role="menuitem"
                  onClick={() => {
                    setViewMode(mode);
                    const el = document.getElementById("viewmode-menu");
                    if (el) el.style.display = "none";
                  }}
                >
                  {mode === "write" ? "Write" : mode === "plan" ? "Plan" : mode === "chat" ? "Chat" : "Review"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="topbar-right">
          {viewMode === "review" ? (
            <div className="dropdown">
              <button
                className="dropdown-trigger" aria-haspopup="true"
                onClick={() => {
                  const el = document.getElementById("review-menu");
                  if (el) el.style.display = el.style.display === "block" ? "none" : "block";
                }}
              >
                {reviewSection === "proposals" ? "Proposals" : reviewSection === "runs" ? "Runs" : reviewSection === "checks" ? "Checks" : "Merge"}
              </button>
              <div id="review-menu" className="dropdown-menu dropdown-menu-right" role="menu" style={{ display: "none" }}>
                {(["proposals", "runs", "checks", "merge"] as ReviewSection[]).map((section) => (
                  <button
                    key={section}
                    className={`dropdown-item ${reviewSection === section ? "active" : ""}`} role="menuitem"
                    onClick={() => {
                      setReviewSection(section);
                      const el = document.getElementById("review-menu");
                      if (el) el.style.display = "none";
                    }}
                  >
                    {section.charAt(0).toUpperCase() + section.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ position: "relative" }}>
            <button
              className={`topbar-icon-btn ${voiceDrawerOpen ? "active" : ""}`}
              onClick={() => { setVoiceDrawerOpen((prev) => !prev); setSettingsOpen(false); }}
              title="Voice workspace"
              aria-label="Voice workspace"
              aria-expanded={voiceDrawerOpen}
            >
              &#127908;
            </button>
            {voiceDrawerOpen ? (
              <>
                <div className="popover-backdrop" onClick={() => setVoiceDrawerOpen(false)} />
                <div className="voice-drawer">
                  <div className="voice-header">
                    <h2>Voice Workspace</h2>
                    <span>
                      {voiceSupported ? `${voiceProviderLabel}${voiceListening ? " / listening" : ""}` : "unsupported"}
                    </span>
                  </div>
                  <div className="voice-options">
                    <label>
                      <span>Mode</span>
                      <select
                        value={voiceInputMode}
                        onChange={(event) => setVoiceInputMode(event.target.value as VoiceInputMode)}
                      >
                        <option value="command">command</option>
                        <option value="dictation">dictation - proposal</option>
                      </select>
                    </label>
                    <label className="run-compare-toggle">
                      <input
                        type="checkbox"
                        checked={voiceRequireConfirmation}
                        onChange={(event) => setVoiceRequireConfirmation(event.target.checked)}
                      />
                      <span>Require confirmation</span>
                    </label>
                    <button
                      disabled={busy || voiceUndoBusy || !voiceLastUndoAction}
                      onClick={() => void handleUndoVoiceAction()}
                    >
                      Undo Last
                    </button>
                  </div>
                  <div className="voice-controls">
                    <input
                      value={voiceDraftTranscript}
                      onChange={(event) => setVoiceDraftTranscript(event.target.value)}
                      placeholder={
                        voiceInputMode === "dictation"
                          ? "Dictation transcript..."
                          : "Voice command transcript..."
                      }
                    />
                    <button
                      className="btn-accent"
                      disabled={busy || voiceDraftTranscript.trim() === ""}
                      onClick={handleSubmitVoiceDraft}
                    >
                      {voiceInputMode === "dictation" ? "Capture" : "Run"}
                    </button>
                    <button
                      className="btn-accent"
                      disabled={busy || !voiceSupported || voiceListening}
                      onClick={handleStartVoiceCapture}
                    >
                      Listen
                    </button>
                    <button
                      disabled={busy || !voiceListening}
                      onClick={handleStopVoiceCapture}
                    >
                      Stop
                    </button>
                    <button disabled={busy || voiceLogRows.length === 0} onClick={handleClearVoiceLog}>
                      Clear
                    </button>
                  </div>
                  {voicePendingAction ? (
                    <div className="voice-pending">
                      <p>
                        Pending: {voicePendingAction.summary} ({voicePendingAction.source})
                      </p>
                      <div className="proposal-actions">
                        <button className="btn-accent" disabled={busy} onClick={() => void handleConfirmVoicePendingAction()}>
                          Confirm
                        </button>
                        <button className="btn-danger" disabled={busy} onClick={handleDiscardVoicePendingAction}>
                          Discard
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {voiceLastUndoLabel ? (
                    <p className="voice-last-undo">Undo available: {voiceLastUndoLabel}</p>
                  ) : null}
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
                </div>
              </>
            ) : null}
          </div>

          <div style={{ position: "relative" }}>
            <button
              className={`topbar-icon-btn ${settingsOpen ? "active" : ""}`}
              onClick={() => { setSettingsOpen((prev) => !prev); setVoiceDrawerOpen(false); }}
              title="Settings"
              aria-label="Settings"
              aria-expanded={settingsOpen}
            >
              &#9881;
            </button>
            {settingsOpen ? (
              <>
                <div className="popover-backdrop" onClick={() => setSettingsOpen(false)} />
                <div className="settings-popover">
                  <h3>Project Settings</h3>
                  <label>
                    <span>Project Root</span>
                    <input
                      value={projectRoot}
                      onChange={(event) => setProjectRoot(event.target.value)}
                      placeholder="/path/to/project"
                    />
                  </label>
                  <button className="btn-accent" disabled={busy} onClick={() => { checkProjectAndLoad(); setSettingsOpen(false); }}>
                    Reload Project
                  </button>
                  {workspaceAuditReport ? (
                    <>
                      <h3>Workspace Health</h3>
                      <p className="run-meta">
                        Checked: {new Date(workspaceAuditReport.checked_at).toLocaleString()} /
                        OK: {workspaceAuditReport.ok ? "yes" : "no"} /
                        Issues: {workspaceAuditReport.issues.length}
                      </p>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <button
            className="topbar-icon-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? "\u263D" : "\u2600"}
          </button>
        </div>
      </header>

      {/* ── App Body ─────────────────────────────────────────── */}
      <div className="app-body">

        {/* ── Sidebar ──────────────────────────────────────── */}
        <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`} role="navigation" aria-label="Sidebar" aria-hidden={!sidebarOpen}>
          <div className="sidebar-header">
            <div className="dropdown" style={{ width: "100%" }}>
              <button
                className="dropdown-trigger" aria-haspopup="true"
                style={{ width: "100%" }}
                onClick={() => {
                  const el = document.getElementById("sidebar-menu");
                  if (el) el.style.display = el.style.display === "block" ? "none" : "block";
                }}
              >
                {sidebarContent === "scenes" ? "Scenes" : sidebarContent === "codex" ? "Codex" : "Context"}
              </button>
              <div id="sidebar-menu" className="dropdown-menu" role="menu" style={{ display: "none", width: "100%" }}>
                {(["scenes", "codex", "context"] as SidebarContent[]).map((mode) => (
                  <button
                    key={mode}
                    className={`dropdown-item ${sidebarContent === mode ? "active" : ""}`} role="menuitem"
                    onClick={() => {
                      setSidebarContent(mode);
                      const el = document.getElementById("sidebar-menu");
                      if (el) el.style.display = "none";
                    }}
                  >
                    {mode === "scenes" ? "Scenes" : mode === "codex" ? "Codex" : "Context"}
                  </button>
                ))}
              </div>
            </div>

            <span className="sidebar-count">
              {sidebarContent === "scenes" ? `${scenes.length} scenes` : sidebarContent === "codex" ? `${codexEntities.length} entities` : (scene ? scene.id : "No scene")}
            </span>
          </div>

          {/* Sidebar: Scenes */}
          {sidebarContent === "scenes" ? (
            <>
              <div className="sidebar-list">
                {sceneListRows.map((item) => (
                  <button
                    key={item.id}
                    className={`scene-item ${item.id === selectedSceneId ? "selected" : ""}`}
                    onClick={() => { setSelectedSceneId(item.id); setViewMode("write"); }}
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
                    onClick={() => setSceneListLimit((prev) => prev + LIST_LIMIT_STEP)}
                  >
                    Load More
                  </button>
                ) : null}
              </div>
              <div className="sidebar-footer">
                <div className="new-scene-card">
                  <input
                    value={addForm.title}
                    onChange={(event) =>
                      setAddForm((prev) => ({ ...prev, title: event.target.value }))
                    }
                    placeholder="New scene title"
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
                  <button className="btn-accent" disabled={busy || addForm.title.trim() === ""} onClick={handleCreateScene}>
                    Add Scene
                  </button>
                </div>
              </div>
            </>
          ) : sidebarContent === "codex" ? (
            <>
              <div className="sidebar-list">
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
              <div className="sidebar-footer">
                <div className="new-codex-card">
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
                  <button
                    disabled={busy || codexForm.name.trim() === ""}
                    onClick={handleCreateCodex}
                  >
                    Add Entity
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Sidebar: Context */
            <div className="sidebar-list" style={{ padding: "0 var(--space-3)", gap: "var(--space-2)" }}>
              {!scene ? (
                <div className="empty-state">
                  <p>Select a scene to inspect context.</p>
                </div>
              ) : (
                <>
                  <div className="context-card">
                    <h3>Scene Snapshot</h3>
                    <p className="context-main">{scene.title}</p>
                    <p className="context-sub">POV: {scene.pov || "n/a"} / Status: {scene.status}</p>
                    <p className="context-sub">{scene.summary || "No summary."}</p>
                  </div>
                  <div className="context-card">
                    <h3>Proposals</h3>
                    <p className="context-sub">
                      {contextProposalCounts.pending} pending / {contextProposalCounts.applied} applied / {contextProposalCounts.rejected} rejected
                    </p>
                    {contextProposals.slice(0, 4).map((item) => (
                      <div key={item.id} className="context-list-item">
                        <strong>{item.title}</strong>
                        <span>{item.status}</span>
                      </div>
                    ))}
                  </div>
                  <div className="context-card">
                    <h3>Preferred Pipeline</h3>
                    <div className="pipeline-health">
                      <span className={`pipeline-health-badge tone-${preferredPipelineHealth.tone}`}>
                        {preferredPipelineHealth.label}
                      </span>
                      <p className="context-sub">{preferredPipelineHealth.detail}</p>
                    </div>
                    <p className="context-sub">Pinned run: {selectedScenePinnedRunId || "none"}</p>
                    {selectedSceneLinkedProposal ? (
                      <p className="context-sub">
                        Linked: {selectedSceneLinkedProposal.id} ({selectedSceneLinkedProposal.status})
                      </p>
                    ) : null}
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
                        Focus Queue
                      </button>
                      <button
                        disabled={busy || !scene.id}
                        onClick={() => handlePrepareGenerateProposalForScene(scene.id)}
                      >
                        Generate
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void handleRefreshProposalsForRecovery()}
                      >
                        Refresh
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
                    <h3>Continuity</h3>
                    <p className="context-sub">
                      {contextContinuityCounts.error} error / {contextContinuityCounts.warning} warning / {contextContinuityCounts.info} info
                    </p>
                    {contextContinuityIssues.slice(0, 4).map((item) => (
                      <div key={item.id} className="context-list-item">
                        <strong>{item.title}</strong>
                        <span>{item.severity}</span>
                      </div>
                    ))}
                    <button disabled={busy} onClick={() => navigateToPanel("checks")}>
                      Open Checks
                    </button>
                  </div>
                  <div className="context-card">
                    <h3>Codex</h3>
                    <p className="context-sub">
                      {povCharacterEntity
                        ? `POV: '${povCharacterEntity.name}'`
                        : "No POV match in codex."}
                    </p>
                    <button disabled={busy} onClick={() => setSidebarContent("codex")}>
                      Open Codex
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </aside>

        {/* ── Content Area ─────────────────────────────────── */}
        <main className="content-area" role="main" aria-label="Content">

          {/* Write Mode: Scene Editor */}
          {viewMode === "write" ? (
            !scene ? (
              <div className="empty-state">
                <p>Select a scene from the sidebar to edit.</p>
              </div>
            ) : (
              <div className="editor-form">
                <div className="editor-header">
                  <div>
                    <input
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, title: event.target.value }))
                      }
                      style={{ fontWeight: 600, fontSize: "var(--text-lg)", border: "none", background: "transparent", padding: 0 }}
                      placeholder="Scene title"
                    />
                    <div className="meta-row" style={{ marginTop: "var(--space-1)" }}>
                      <span>{draft.status}</span>
                      <span>{draft.pov || "no POV"}</span>
                      <code style={{ fontSize: "var(--text-xs)" }}>{scene.path}</code>
                    </div>
                  </div>
                  <button
                    className="btn-accent"
                    disabled={busy || !canSaveScene}
                    onClick={handleSaveScene}
                  >
                    Save
                  </button>
                </div>
                <div style={{ display: "none" }} className="meta-grid">
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
                <textarea
                  value={draft.body}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, body: event.target.value }))
                  }
                  style={{ flex: 1, minHeight: "calc(100vh - 200px)" }}
                />
              </div>
            )

          /* Plan Mode: Outliner */
          ) : viewMode === "plan" ? (
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

          /* Chat Mode */
          ) : viewMode === "chat" ? (
            <div className="chat-view">
              <section className="chat-thread-panel">
                <div className="chat-thread-panel-header">
                  <h3>Threads</h3>
                  <span>{chatThreads.length}</span>
                </div>
                <div className="chat-thread-create">
                  <input
                    value={chatThreadDraft.title}
                    onChange={(event) =>
                      setChatThreadDraft((prev) => ({
                        ...prev,
                        title: event.target.value
                      }))
                    }
                    placeholder="Thread title"
                  />
                  <div className="row">
                    <select
                      value={chatThreadDraft.provider}
                      onChange={(event) =>
                        setChatThreadDraft((prev) => ({
                          ...prev,
                          provider: event.target.value as ProposalProvider
                        }))
                      }
                    >
                      <option value="local">local</option>
                      <option value="openai">openai</option>
                      <option value="anthropic">anthropic</option>
                    </select>
                    <select
                      value={chatThreadDraft.mode}
                      onChange={(event) =>
                        setChatThreadDraft((prev) => ({
                          ...prev,
                          mode: event.target.value as "chat" | "agent"
                        }))
                      }
                    >
                      <option value="chat">chat</option>
                      <option value="agent">agent</option>
                    </select>
                  </div>
                  <input
                    value={chatThreadDraft.model}
                    onChange={(event) =>
                      setChatThreadDraft((prev) => ({
                        ...prev,
                        model: event.target.value
                      }))
                    }
                    placeholder={`Model (default: ${PROVIDER_MODEL_HINTS[chatThreadDraft.provider]})`}
                  />
                  <button
                    className="btn-accent"
                    disabled={busy || chatThreadDraft.title.trim() === ""}
                    onClick={() => void handleCreateChatThread()}
                  >
                    New Thread
                  </button>
                </div>
                <div className="chat-thread-list">
                  {chatThreads.map((thread) => (
                    <button
                      key={thread.id}
                      className={`chat-thread-item ${
                        selectedChatThreadId === thread.id ? "selected" : ""
                      }`}
                      onClick={() => setSelectedChatThreadId(thread.id)}
                    >
                      <strong>{thread.title}</strong>
                      <span>
                        {thread.mode} / {thread.provider}/{thread.model}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="chat-main-panel">
                {selectedChatThread ? (
                  <>
                    <div className="chat-main-header">
                      <h3>{selectedChatThread.title}</h3>
                      <div className="row">
                        <button
                          disabled={busy || selectedChatThread.mode === "chat"}
                          onClick={() => void handleUpdateSelectedThreadMode("chat")}
                        >
                          Chat Mode
                        </button>
                        <button
                          disabled={busy || selectedChatThread.mode === "agent"}
                          onClick={() => void handleUpdateSelectedThreadMode("agent")}
                        >
                          Agent Mode
                        </button>
                      </div>
                    </div>
                    <div className="chat-message-list">
                      {chatMessages.length === 0 ? (
                        <div className="empty-state">
                          <p>No messages yet.</p>
                        </div>
                      ) : (
                        chatMessages.map((row) => (
                          <article
                            key={row.id}
                            className={`chat-message chat-role-${row.role}`}
                          >
                            <div className="chat-message-meta">
                              <strong>{row.role}</strong>
                              <span>{new Date(row.created_at).toLocaleString()}</span>
                            </div>
                            <pre>{row.content}</pre>
                          </article>
                        ))
                      )}
                    </div>
                    {chatPendingToolCalls.length > 0 ? (
                      <div className="chat-pending-tools">
                        <h4>Pending Tool Calls</h4>
                        {chatPendingToolCalls.map((item) => (
                          <div key={`${item.assistantMessageId}-${item.index}`} className="chat-tool-row">
                            <div>
                              <strong>{item.tool}</strong>
                              <span>
                                {" "}
                                ({item.classification}) from {item.assistantMessageId}
                              </span>
                              {item.error ? <p>{item.error}</p> : null}
                            </div>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void handleExecutePendingChatTool(
                                  item.assistantMessageId,
                                  item.index
                                )
                              }
                            >
                              Execute
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="chat-context-drawer">
                      <h4>Context</h4>
                      <div className="chat-context-grid">
                        <label>
                          <span>Current Scene</span>
                          <select
                            value={chatComposerDraft.includeCurrentScene ? "true" : "false"}
                            onChange={(event) =>
                              setChatComposerDraft((prev) => ({
                                ...prev,
                                includeCurrentScene: event.target.value === "true"
                              }))
                            }
                          >
                            <option value="true">on</option>
                            <option value="false">off</option>
                          </select>
                        </label>
                        <label>
                          <span>Selection</span>
                          <select
                            value={chatComposerDraft.includeSelection ? "true" : "false"}
                            onChange={(event) =>
                              setChatComposerDraft((prev) => ({
                                ...prev,
                                includeSelection: event.target.value === "true"
                              }))
                            }
                          >
                            <option value="true">on</option>
                            <option value="false">off</option>
                          </select>
                        </label>
                        <label>
                          <span>Recent Radius</span>
                          <input
                            type="number"
                            min={0}
                            value={chatComposerDraft.includeRecentScenesRadius}
                            onChange={(event) =>
                              setChatComposerDraft((prev) => ({
                                ...prev,
                                includeRecentScenesRadius: Math.max(0, Number(event.target.value || 0))
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Codex</span>
                          <select
                            value={chatComposerDraft.includeCodex}
                            onChange={(event) =>
                              setChatComposerDraft((prev) => ({
                                ...prev,
                                includeCodex: event.target.value as DraftChatComposer["includeCodex"]
                              }))
                            }
                          >
                            <option value="off">off</option>
                            <option value="explicit">explicit</option>
                            <option value="auto">auto</option>
                            <option value="auto_and_explicit">auto + explicit</option>
                          </select>
                        </label>
                        <label>
                          <span>Retrieval</span>
                          <select
                            value={chatComposerDraft.retrievalMode}
                            onChange={(event) =>
                              setChatComposerDraft((prev) => ({
                                ...prev,
                                retrievalMode: event.target.value as DraftChatComposer["retrievalMode"]
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
                            min={1}
                            value={chatComposerDraft.retrievalLimit}
                            onChange={(event) =>
                              setChatComposerDraft((prev) => ({
                                ...prev,
                                retrievalLimit: Math.max(1, Number(event.target.value || 1))
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>
                    <div className="chat-composer">
                      <label>
                        <span>Scene Id</span>
                        <input
                          value={chatComposerDraft.currentSceneId}
                          onChange={(event) =>
                            setChatComposerDraft((prev) => ({
                              ...prev,
                              currentSceneId: event.target.value
                            }))
                          }
                          placeholder={selectedSceneId || "scene-0001"}
                        />
                      </label>
                      <label>
                        <span>Selected Text</span>
                        <textarea
                          value={chatComposerDraft.selectedText}
                          onChange={(event) =>
                            setChatComposerDraft((prev) => ({
                              ...prev,
                              selectedText: event.target.value
                            }))
                          }
                          placeholder="Optional highlighted text context..."
                          style={{ minHeight: "48px" }}
                        />
                      </label>
                      <label>
                        <span>Message</span>
                        <textarea
                          value={chatComposerDraft.message}
                          onChange={(event) =>
                            setChatComposerDraft((prev) => ({
                              ...prev,
                              message: event.target.value
                            }))
                          }
                          placeholder="Ask about plot, codex, revisions, or run agent tools."
                          style={{ minHeight: "72px" }}
                        />
                      </label>
                      <button
                        className="btn-accent"
                        disabled={busy || chatComposerDraft.message.trim() === ""}
                        onClick={() => void handleSendChatMessage()}
                      >
                        Send
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <p>Create a chat thread to start.</p>
                  </div>
                )}
              </section>
            </div>

          /* Review Mode */
          ) : (
            <div className="side-content" style={{ maxWidth: "800px", width: "100%" }}>

              {/* Review: Proposals */}
              {reviewSection === "proposals" ? (
                <>
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
                        <input type="number" step="0.1" min="0" max="2" value={proposalGenerateForm.temperature}
                          onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, temperature: Number(event.target.value || 0) }))} />
                      </label>
                      <label>
                        <span>Max Tokens</span>
                        <input type="number" min="64" value={proposalGenerateForm.maxOutputTokens}
                          onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, maxOutputTokens: Number(event.target.value || 64) }))} />
                      </label>
                      <label>
                        <span>Context Scenes</span>
                        <input type="number" min="0" value={proposalGenerateForm.contextScenes}
                          onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, contextScenes: Number(event.target.value || 0) }))} />
                      </label>
                      <label>
                        <span>Codex Limit</span>
                        <input type="number" min="1" value={proposalGenerateForm.codexLimit}
                          onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, codexLimit: Number(event.target.value || 1) }))} />
                      </label>
                      <label>
                        <span>Retrieval Mode</span>
                        <select value={proposalGenerateForm.retrievalMode}
                          onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, retrievalMode: event.target.value as "off" | "auto" | "required" }))}>
                          <option value="off">off</option>
                          <option value="auto">auto</option>
                          <option value="required">required</option>
                        </select>
                      </label>
                      <label>
                        <span>Retrieval Limit</span>
                        <input type="number" min="1" value={proposalGenerateForm.retrievalLimit}
                          onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, retrievalLimit: Number(event.target.value || 1) }))} />
                      </label>
                      <label>
                        <span>Retrieval Min Score</span>
                        <input type="number" min="0" step="0.05" value={proposalGenerateForm.retrievalMinScore}
                          onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, retrievalMinScore: Number(event.target.value || 0) }))} />
                      </label>
                    </div>
                    <label className="run-compare-toggle">
                      <input type="checkbox" checked={proposalGenerateForm.retrievalRequireFresh}
                        onChange={(event) => setProposalGenerateForm((prev) => ({ ...prev, retrievalRequireFresh: event.target.checked }))} />
                      <span>Require fresh retrieval index</span>
                    </label>
                    <button
                      className="btn-accent"
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
                      <button className="list-load-more" disabled={busy}
                        onClick={() => setProposalListLimit((prev) => prev + LIST_LIMIT_STEP)}>
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
                        {selectedProposal.scene_id ? `Scene: ${selectedProposal.scene_id}` : "Scene: n/a"}
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
                              {selectedProposal.generation.retrieval.citations.slice(0, 4).map((row) => (
                                <div key={row.chunk_id} className="provenance-item">
                                  <p className="proposal-meta">{row.source_type}/{row.source_ref} ({row.source_title})</p>
                                  <p className="proposal-meta">score {row.score ?? "n/a"} / coverage {row.coverage ?? "n/a"}</p>
                                  <p className="proposal-meta">terms: {row.matched_terms.join(", ") || "n/a"}</p>
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
                        <p className="proposal-meta">Preferred run id: {selectedProposalPinnedRunId}</p>
                      ) : null}
                      {selectedProposal.generation?.log_path ? (
                        <p className="proposal-meta">Log: {selectedProposal.generation.log_path}</p>
                      ) : null}
                      <div className="proposal-actions">
                        <button className="btn-accent" disabled={busy || selectedProposal.status !== "pending"} onClick={() => handleApplyProposal(selectedProposal.id)}>Apply</button>
                        <button className="btn-danger" disabled={busy || selectedProposal.status !== "pending"} onClick={() => handleRejectProposal(selectedProposal.id)}>Reject</button>
                        <button disabled={busy || !selectedProposal.scene_id || !selectedProposalPinnedRunId} onClick={() => void handleOpenPinnedGenerationRun(selectedProposal.scene_id)}>Open Preferred Run</button>
                        <button disabled={busy || !selectedProposal.scene_id || !selectedProposalPinnedRunId} onClick={() => void handleOpenPinnedProposal(selectedProposal.scene_id)}>Open Preferred Proposal</button>
                      </div>
                    </div>
                  ) : (
                    <div className="proposal-review empty-review">
                      <p>Select a proposal to review.</p>
                    </div>
                  )}
                </>

              /* Review: Checks */
              ) : reviewSection === "checks" ? (
                <>
                  <div className="checks-header">
                    <h2>Checks</h2>
                    <span>{continuityCounts.error} error / {continuityCounts.warning} warning / {continuityCounts.info} info</span>
                  </div>
                  <div className="checks-actions">
                    <button className="btn-accent" disabled={busy || !projectFound} onClick={handleRunContinuityChecks}>Run Continuity Check</button>
                  </div>
                  <div className="checks-list">
                    {continuityIssues.length === 0 ? (
                      <div className="check-detail empty-review"><p>Run checks to surface continuity risks.</p></div>
                    ) : (
                      continuityIssues.map((issue) => (
                        <button key={issue.id} className={`check-item ${issue.id === selectedContinuityIssueId ? "selected" : ""} severity-${issue.severity}`}
                          onClick={() => setSelectedContinuityIssueId(issue.id)}>
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
                        <button disabled={busy || !canOpenSelectedIssueScene} onClick={handleOpenIssueScene}>Open Scene</button>
                      </div>
                    </div>
                  ) : (
                    <div className="check-detail empty-review"><p>Select a check issue to inspect.</p></div>
                  )}
                </>

              /* Review: Runs */
              ) : reviewSection === "runs" ? (
                <>
                  <div className="runs-header">
                    <h2>Runs</h2>
                    <span>{generationRunCounts.succeeded} succeeded / {generationRunCounts.failed} failed / {generationRunCounts.other} other</span>
                  </div>
                  <div className="runs-controls">
                    <select value={generationStatusFilter} onChange={(event) => setGenerationStatusFilter(event.target.value as GenerationStatusFilter)}>
                      <option value="all">all statuses</option>
                      <option value="succeeded">succeeded</option>
                      <option value="failed">failed</option>
                    </select>
                    <select value={generationProviderFilter} onChange={(event) => setGenerationProviderFilter(event.target.value as GenerationProviderFilter)}>
                      <option value="all">all providers</option>
                      <option value="local">local</option>
                      <option value="openai">openai</option>
                      <option value="anthropic">anthropic</option>
                    </select>
                    <select value={generationQualityFilter} onChange={(event) => setGenerationQualityFilter(event.target.value as GenerationQualityFilter)}>
                      <option value="all">all quality</option>
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </select>
                    <button disabled={busy || !projectFound} onClick={() => void Promise.all([refreshGenerationRuns(), refreshGenerationPins(), refreshGenerationRuntimeConfig(), refreshGenerationBudget()])}>
                      Refresh Runs
                    </button>
                  </div>
                  <div className="run-config-card">
                    <h3>Provider Runtime</h3>
                    {generationRuntimeConfig ? (
                      <>
                        <p className="run-meta">Retry: {generationRuntimeConfig.retry.max_retries} max / {generationRuntimeConfig.retry.base_delay_ms}ms base delay</p>
                        <p className="run-meta">OpenAI key: {generationRuntimeConfig.providers.openai.credential_present ? "present" : "missing"}</p>
                        <p className="run-meta">Anthropic key: {generationRuntimeConfig.providers.anthropic.credential_present ? "present" : "missing"}</p>
                        <p className="run-meta">Budget enforcement: {generationBudget?.policy.enforcement ?? "fail_closed"}</p>
                      </>
                    ) : (<p className="run-meta">Config unavailable.</p>)}
                    {generationBudget ? (
                      <div className="run-budget-card">
                        <h4>Budget Policy</h4>
                        <p className="run-meta">Per-run caps: in {generationBudget.policy.per_run.max_input_tokens ?? "none"} / out {generationBudget.policy.per_run.max_output_tokens ?? "none"} / total {generationBudget.policy.per_run.max_total_tokens ?? "none"} / cost {generationBudget.policy.per_run.max_estimated_cost_usd ?? "none"}</p>
                        <p className="run-meta">Rolling caps: daily tokens {generationBudget.policy.rolling.daily_tokens ?? "none"} / daily cost {generationBudget.policy.rolling.daily_estimated_cost_usd ?? "none"} / weekly tokens {generationBudget.policy.rolling.weekly_tokens ?? "none"} / weekly cost {generationBudget.policy.rolling.weekly_estimated_cost_usd ?? "none"}</p>
                        <p className="run-meta">Usage daily: {generationBudget.usage.daily.total_tokens} tokens / ${generationBudget.usage.daily.estimated_cost_usd}</p>
                        <p className="run-meta">Usage weekly: {generationBudget.usage.weekly.total_tokens} tokens / ${generationBudget.usage.weekly.estimated_cost_usd}</p>
                        <div className="generate-grid">
                          <label><span>Max Input Tokens</span><input value={budgetDraft.maxInputTokens} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, maxInputTokens: event.target.value }))} placeholder="none" /></label>
                          <label><span>Max Output Tokens</span><input value={budgetDraft.maxOutputTokens} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, maxOutputTokens: event.target.value }))} placeholder="none" /></label>
                          <label><span>Max Total Tokens</span><input value={budgetDraft.maxTotalTokens} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, maxTotalTokens: event.target.value }))} placeholder="none" /></label>
                          <label><span>Max Cost (USD)</span><input value={budgetDraft.maxEstimatedCostUsd} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, maxEstimatedCostUsd: event.target.value }))} placeholder="none" /></label>
                          <label><span>Daily Tokens</span><input value={budgetDraft.dailyTokens} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, dailyTokens: event.target.value }))} placeholder="none" /></label>
                          <label><span>Daily Cost (USD)</span><input value={budgetDraft.dailyEstimatedCostUsd} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, dailyEstimatedCostUsd: event.target.value }))} placeholder="none" /></label>
                          <label><span>Weekly Tokens</span><input value={budgetDraft.weeklyTokens} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, weeklyTokens: event.target.value }))} placeholder="none" /></label>
                          <label><span>Weekly Cost (USD)</span><input value={budgetDraft.weeklyEstimatedCostUsd} onChange={(event) => setBudgetDraft((prev) => ({ ...prev, weeklyEstimatedCostUsd: event.target.value }))} placeholder="none" /></label>
                        </div>
                        <div className="proposal-actions">
                          <button className="btn-accent" disabled={busy || !canSaveBudgetPolicy} onClick={() => void handleSaveBudgetPolicy()}>Save Budget Policy</button>
                          <button className="btn-danger" disabled={busy} onClick={() => void handleResetBudgetPolicy()}>Reset Budget Policy</button>
                        </div>
                      </div>
                    ) : (<p className="run-meta">Budget policy unavailable.</p>)}
                  </div>
                  <div className="run-hardening-card">
                    <h3>Workspace Hardening</h3>
                    <div className="proposal-actions">
                      <button disabled={busy || !projectFound} onClick={() => void handleRunWorkspaceAudit(false)}>Run Drift Audit</button>
                      <button disabled={busy || !projectFound} onClick={() => void handleRunWorkspaceAudit(true)}>Audit + Repair</button>
                    </div>
                    {workspaceAuditReport ? (
                      <>
                        <p className="run-meta">checked: {new Date(workspaceAuditReport.checked_at).toLocaleString()}</p>
                        <p className="run-meta">issues: {workspaceAuditReport.issues.length} / ok: {workspaceAuditReport.ok ? "yes" : "no"} / repair applied: {workspaceAuditReport.repair_applied ? "yes" : "no"}</p>
                        <p className="run-meta">branch: {workspaceAuditReport.branch.current_branch || "n/a"} / detached: {workspaceAuditReport.branch.detached_head ? "yes" : "no"}</p>
                        <p className="run-meta">retrieval present: {workspaceAuditReport.retrieval.present ? "yes" : "no"} / stale: {workspaceAuditReport.retrieval.stale ? "yes" : "no"}</p>
                        <p className="run-meta">pins total: {workspaceAuditReport.generation_pins.total} / stale: {workspaceAuditReport.generation_pins.stale} / repaired: {workspaceAuditReport.generation_pins.repaired_count}</p>
                        {workspaceAuditReport.issues.length ? (
                          <div className="run-recommendation-reasons">
                            {workspaceAuditReport.issues.slice(0, 5).map((issue) => (<p key={`${issue.code}-${issue.message}`} className="run-meta">[{issue.severity}] {issue.code}: {issue.message}</p>))}
                          </div>
                        ) : null}
                        {workspaceAuditReport.recovery_actions.length ? (
                          <div className="run-recommendation-reasons">
                            {workspaceAuditReport.recovery_actions.slice(0, 4).map((action) => (<p key={action} className="run-meta">recovery: {action}</p>))}
                          </div>
                        ) : null}
                      </>
                    ) : (<p className="run-meta">Run drift audit to validate metadata health.</p>)}
                  </div>
                  <div className="run-hardening-card">
                    <h3>Performance Baseline</h3>
                    <div className="row">
                      <label><span>Samples Per Metric</span><input value={performanceBaselineRepeat} onChange={(event) => setPerformanceBaselineRepeat(event.target.value)} placeholder="3" /></label>
                      <button disabled={busy || !projectFound} onClick={() => void handleRunPerformanceBaseline()}>Run Baseline</button>
                    </div>
                    {performanceBaselineReport ? (
                      <>
                        <p className="run-meta">checked: {new Date(performanceBaselineReport.checked_at).toLocaleString()}</p>
                        <p className="run-meta">counts: scenes {performanceBaselineReport.counts.scenes} / proposals {performanceBaselineReport.counts.proposals} / runs {performanceBaselineReport.counts.generation_runs}</p>
                        <div className="run-recommendation-reasons">
                          {performanceBaselineReport.metrics.map((metric) => (<p key={metric.name} className="run-meta">{metric.name}: min {metric.min_ms}ms / avg {metric.avg_ms}ms / max {metric.max_ms}ms</p>))}
                        </div>
                      </>
                    ) : (<p className="run-meta">Capture baseline timings.</p>)}
                  </div>
                  <div className="runs-list">
                    {generationRuns.length === 0 ? (
                      <div className="run-detail empty-review"><p>No generation runs found.</p></div>
                    ) : (
                      runsListRows.map((run) => {
                        const isPreferredForScene = run.scene_id !== "" && generationPins[run.scene_id] === run.run_id;
                        return (
                          <button key={run.run_id} className={`run-item ${isPreferredForScene ? "preferred" : ""} ${run.run_id === selectedGenerationRunId ? "selected" : ""} status-${run.status}`}
                            onClick={() => setSelectedGenerationRunId(run.run_id)}>
                            <strong>{run.run_id}</strong>
                            <span>{run.provider || "unknown"} / {run.quality_tier || "n/a"}{run.retrieval_mode && run.retrieval_mode !== "off" ? ` / retrieval ${run.retrieval_result_count ?? 0}` : ""}{isPreferredForScene ? " / preferred" : ""}</span>
                            <em>{run.status}</em>
                          </button>
                        );
                      })
                    )}
                    {hasMoreRunsRows ? (
                      <button className="list-load-more" disabled={busy} onClick={() => setRunsListLimit((prev) => prev + LIST_LIMIT_STEP)}>Load More Runs</button>
                    ) : null}
                  </div>
                  {selectedGenerationRun ? (
                    <div className="run-detail">
                      <h3>{selectedGenerationRun.run_id}</h3>
                      <p className="run-meta">{selectedGenerationRun.provider}/{selectedGenerationRun.model}</p>
                      <p className="run-meta">Settings: temp {selectedGenerationRun.temperature ?? "n/a"} / max {selectedGenerationRun.max_output_tokens ?? "n/a"} / context {selectedGenerationRun.context_scene_radius ?? "n/a"} / codex {selectedGenerationRun.codex_limit ?? "n/a"}</p>
                      <p className="run-meta">Scene: {selectedGenerationRun.scene_id || "n/a"}</p>
                      <p className="run-meta">Preferred: {selectedGenerationRunPinned ? "yes" : "no"}</p>
                      {selectedGenerationScenePinnedRunId ? (<p className="run-meta">Preferred run id: {selectedGenerationScenePinnedRunId}</p>) : null}
                      <p className="run-meta">Status: {selectedGenerationRun.status}</p>
                      {selectedGenerationRun.status === "succeeded" ? (
                        <>
                          <p className="run-meta">Usage: in {selectedGenerationRun.usage?.input_tokens ?? "n/a"} / out {selectedGenerationRun.usage?.output_tokens ?? "n/a"} tokens, {selectedGenerationRun.usage?.latency_ms ?? "n/a"} ms, {selectedGenerationRun.usage?.provider_attempts ?? "n/a"} attempt(s){typeof selectedGenerationRun.usage?.estimated_cost_usd === "number" ? `, est $${selectedGenerationRun.usage.estimated_cost_usd.toFixed(6)}` : ""}</p>
                          <p className="run-meta">Proposal: {selectedGenerationRun.proposal_id || "n/a"}</p>
                          <p className="run-meta">Quality: {selectedGenerationRun.quality?.tier || "n/a"} / {typeof selectedGenerationRun.quality?.score === "number" ? selectedGenerationRun.quality?.score : "n/a"}</p>
                          {selectedGenerationRun.quality?.flags?.length ? (<p className="run-meta">Quality flags: {selectedGenerationRun.quality.flags.join(", ")}</p>) : null}
                          <p className="run-meta">Normalization changed: {selectedGenerationRun.normalization?.normalization_changed ? "yes" : "no"}</p>
                          {selectedGenerationRun.normalization?.missing_sections_filled?.length ? (<p className="run-meta">Filled sections: {selectedGenerationRun.normalization.missing_sections_filled.join(", ")}</p>) : null}
                          {selectedGenerationRun.normalization?.detected_headers?.length ? (<p className="run-meta">Detected headers: {selectedGenerationRun.normalization.detected_headers.join(", ")}</p>) : null}
                          {selectedGenerationRun.normalized_instruction ? (<p className="run-text">{selectedGenerationRun.normalized_instruction}</p>) : null}
                        </>
                      ) : (
                        <>
                          <p className="run-meta">Error: {selectedGenerationRun.error?.category || "unknown_error"}</p>
                          <p className="run-text">{selectedGenerationRun.error?.message || "No error message."}</p>
                        </>
                      )}
                      {selectedGenerationRun.retrieval ? (
                        <div className="run-compare-table provenance-card">
                          <h5>Retrieval Provenance</h5>
                          <p className="run-meta">Mode: {selectedGenerationRun.retrieval.mode || "off"} / used: {selectedGenerationRun.retrieval.used ? "yes" : "no"} / results: {selectedGenerationRun.retrieval.result_count ?? 0}</p>
                          <p className="run-meta">Query: {selectedGenerationRun.retrieval.query || "n/a"}</p>
                          <p className="run-meta">Index: {selectedGenerationRun.retrieval.index?.path || "n/a"} / stale: {selectedGenerationRun.retrieval.index?.stale ? "yes" : "no"}</p>
                          {selectedGenerationRun.retrieval.degraded ? (<p className="run-meta">Retrieval degraded: {selectedGenerationRun.retrieval.error || "unknown"}</p>) : null}
                          {selectedGenerationRun.retrieval.citations?.length ? (
                            <div className="provenance-list">
                              {selectedGenerationRun.retrieval.citations.slice(0, 6).map((row) => (
                                <div key={`${row.chunk_id || "chunk"}-${row.source_ref || "source"}`} className="provenance-item">
                                  <p className="run-meta">{row.source_type || "unknown"}/{row.source_ref || "n/a"} ({row.source_title || "untitled"})</p>
                                  <p className="run-meta">score {row.score ?? "n/a"} / coverage {row.coverage ?? "n/a"}</p>
                                  <p className="run-meta">terms: {row.matched_terms?.join(", ") || "n/a"}</p>
                                  <p className="run-meta">{row.excerpt || ""}</p>
                                </div>
                              ))}
                            </div>
                          ) : (<p className="run-meta">No citations attached.</p>)}
                        </div>
                      ) : null}
                      <p className="run-meta">Log: {selectedGenerationRun.log_path}</p>
                      <div className="run-rerun-card">
                        <h4>Re-run Options</h4>
                        <label><span>Title Override</span><input value={rerunDraft.title} onChange={(event) => setRerunDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Optional proposal title" /></label>
                        <div className="generate-grid">
                          <label><span>Provider</span><select value={rerunDraft.provider} onChange={(event) => setRerunDraft((prev) => ({ ...prev, provider: event.target.value as ProposalProvider }))}><option value="local">local</option><option value="openai">openai</option><option value="anthropic">anthropic</option></select></label>
                          <label><span>Model Override</span><input value={rerunDraft.model} onChange={(event) => setRerunDraft((prev) => ({ ...prev, model: event.target.value }))} placeholder={`Model (default: ${PROVIDER_MODEL_HINTS[rerunDraft.provider]})`} /></label>
                          <label><span>Temperature</span><input type="number" step="0.1" min="0" max="2" value={rerunDraft.temperature} onChange={(event) => setRerunDraft((prev) => ({ ...prev, temperature: event.target.value }))} /></label>
                          <label><span>Max Tokens</span><input type="number" min="64" value={rerunDraft.maxOutputTokens} onChange={(event) => setRerunDraft((prev) => ({ ...prev, maxOutputTokens: event.target.value }))} /></label>
                          <label><span>Context Scenes</span><input type="number" min="0" value={rerunDraft.contextScenes} onChange={(event) => setRerunDraft((prev) => ({ ...prev, contextScenes: event.target.value }))} /></label>
                          <label><span>Codex Limit</span><input type="number" min="1" value={rerunDraft.codexLimit} onChange={(event) => setRerunDraft((prev) => ({ ...prev, codexLimit: event.target.value }))} /></label>
                          <label><span>Retrieval Mode</span><select value={rerunDraft.retrievalMode} onChange={(event) => setRerunDraft((prev) => ({ ...prev, retrievalMode: event.target.value as "off" | "auto" | "required" }))}><option value="off">off</option><option value="auto">auto</option><option value="required">required</option></select></label>
                          <label><span>Retrieval Limit</span><input type="number" min="1" value={rerunDraft.retrievalLimit} onChange={(event) => setRerunDraft((prev) => ({ ...prev, retrievalLimit: event.target.value }))} /></label>
                          <label><span>Retrieval Min Score</span><input type="number" min="0" step="0.05" value={rerunDraft.retrievalMinScore} onChange={(event) => setRerunDraft((prev) => ({ ...prev, retrievalMinScore: event.target.value }))} /></label>
                        </div>
                        <label className="run-compare-toggle"><input type="checkbox" checked={rerunDraft.retrievalRequireFresh} onChange={(event) => setRerunDraft((prev) => ({ ...prev, retrievalRequireFresh: event.target.checked }))} /><span>Require fresh retrieval index</span></label>
                      </div>
                      <div className="run-compare-select-card">
                        <h4>Compare Baseline</h4>
                        <label><span>Baseline Run</span><select value={comparisonBaselineRunId} onChange={(event) => void handleSelectComparisonBaseline(event.target.value)}><option value="">none selected</option>{comparisonCandidateRuns.map((run) => (<option key={run.run_id} value={run.run_id}>{run.run_id} | {run.status} | {run.provider}/{run.model}</option>))}</select></label>
                        <p className="run-meta">{comparisonCandidateRuns.length} candidate run(s)</p>
                        <label><span>Recommendation Profile</span><select value={comparisonProfileId} onChange={(event) => setComparisonProfileId(event.target.value as RunComparisonProfileId)}>{comparisonProfiles.map((profile) => (<option key={profile.id} value={profile.id}>{profile.label}</option>))}</select></label>
                        <label className="run-compare-toggle"><input type="checkbox" checked={comparisonAutoPrevious} onChange={(event) => setComparisonAutoPrevious(event.target.checked)} /><span>Auto-select previous baseline</span></label>
                      </div>
                      <div className="proposal-actions">
                        <button className="btn-accent" disabled={busy || !selectedGenerationRun.scene_id || selectedGenerationRunPinned} onClick={() => void handlePinPreferredGenerationRun()}>Pin As Preferred</button>
                        <button disabled={busy || !selectedGenerationRun.scene_id} onClick={() => void handleUnpinPreferredGenerationRun()}>Unpin Preferred</button>
                        <button disabled={busy || !selectedGenerationRun.scene_id || !selectedGenerationScenePinnedRunId} onClick={() => void handleOpenPinnedGenerationRun(selectedGenerationRun.scene_id)}>Open Preferred</button>
                        <button disabled={busy} onClick={() => void handleRerunGeneration()}>Re-run</button>
                        <button disabled={busy || !selectedGenerationRun.scene_id || !previousComparisonRunId} onClick={() => void handleCompareToPreviousGenerationRun()}>Compare Previous</button>
                        <button disabled={busy || !comparisonBaselineRun} onClick={() => setComparisonBaselineRun(null)}>Clear Comparison</button>
                        <button disabled={busy} onClick={() => void handleCopyGenerationLog()}>Copy Log JSON</button>
                        <button disabled={busy} onClick={handleDownloadGenerationLog}>Download Log</button>
                        <button disabled={busy || !selectedGenerationRun.scene_id} onClick={() => handleOpenGenerationScene(selectedGenerationRun.scene_id)}>Open Scene</button>
                        <button disabled={busy || !selectedGenerationRun.proposal_id} onClick={() => void handleOpenGenerationProposal(selectedGenerationRun.proposal_id || "")}>Open Proposal</button>
                      </div>
                      {runComparison ? (
                        <div className="run-compare-card">
                          <h4>Run Comparison</h4>
                          <p className="run-meta">Baseline: {runComparison.baselineRunId} / Current: {runComparison.currentRunId}</p>
                          <p className="run-meta">Profile: {comparisonProfileLabel}</p>
                          <p className="run-meta">Instruction changed: {runComparison.instructionChanged ? "yes" : "no"}</p>
                          <p className={`run-meta run-recommendation verdict-${runComparison.recommendation.verdict}`}>Recommendation: {runComparisonVerdictLabel(runComparison.recommendation.verdict)} (score {runComparison.recommendation.score})</p>
                          <p className="run-meta">{runComparisonActionHint}</p>
                          <p className="run-meta">{runComparison.recommendation.summary}</p>
                          {runComparison.recommendation.reasons.length ? (
                            <div className="run-recommendation-reasons">
                              {runComparison.recommendation.reasons.map((reason, index) => (<p key={`${index}-${reason}`} className="run-meta">- {reason}</p>))}
                            </div>
                          ) : null}
                          <div className="run-compare-grid">
                            <article><h5>Baseline Instruction</h5><pre className="run-compare-text">{runComparison.baselineInstruction || "(empty)"}</pre></article>
                            <article><h5>Current Instruction</h5><pre className="run-compare-text">{runComparison.currentInstruction || "(empty)"}</pre></article>
                          </div>
                          <div className="run-compare-table">
                            <h5>Metric Deltas</h5>
                            {runComparison.metrics.map((row) => (<p key={row.label} className="run-meta">{row.label}: baseline {row.baseline ?? "n/a"} / current {row.current ?? "n/a"} / delta {formatNumericDelta(row.delta)}</p>))}
                          </div>
                          <div className="run-compare-table">
                            <h5>Settings</h5>
                            {runComparison.settings.map((row) => (<p key={row.label} className="run-meta">{row.label}: {row.baseline} → {row.current}{row.changed ? " (changed)" : ""}</p>))}
                          </div>
                          <div className="run-compare-table">
                            <h5>Outcome</h5>
                            {runComparison.outcome.map((row) => (<p key={row.label} className="run-meta">{row.label}: {row.baseline} → {row.current}{row.changed ? " (changed)" : ""}</p>))}
                          </div>
                          <div className="proposal-actions">
                            <button className="btn-accent" disabled={busy || !selectedGenerationRun.scene_id || selectedGenerationRunPinned || runComparison.recommendation.verdict !== "likely_better"} onClick={() => void handlePinPreferredGenerationRun()}>Promote Current</button>
                            <button className="btn-accent" disabled={busy || !comparisonBaselineRun?.scene_id || runComparison.recommendation.verdict !== "likely_worse"} onClick={() => void handlePinBaselineGenerationRun()}>Promote Baseline</button>
                            <button disabled={busy || !comparisonBaselineRun} onClick={handleOpenBaselineRun}>Open Baseline Run</button>
                            <button disabled={busy || !(comparisonBaselineRun?.proposal_id ?? "").trim()} onClick={() => void handleOpenBaselineProposal()}>Open Baseline Proposal</button>
                            <button disabled={busy} onClick={() => void handleCopyRunComparisonJson()}>Copy JSON</button>
                            <button disabled={busy} onClick={() => void handleCopyRunComparisonMarkdown()}>Copy MD</button>
                            <button disabled={busy} onClick={handleDownloadRunComparisonJson}>Download JSON</button>
                            <button disabled={busy} onClick={handleDownloadRunComparisonMarkdown}>Download MD</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="run-detail empty-review"><p>Select a run to inspect details.</p></div>
                  )}
                </>

              /* Review: Merge */
              ) : (
                <>
                  <div className="runs-header">
                    <h2>Guided Merge</h2>
                    <span>current: {currentBranchName || "n/a"}</span>
                  </div>
                  <div className="merge-create-card">
                    <h3>Create Branch</h3>
                    <div className="row">
                      <input value={branchCreateDraft.name} onChange={(event) => setBranchCreateDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="branch name" />
                      <input value={branchCreateDraft.fromRef} onChange={(event) => setBranchCreateDraft((prev) => ({ ...prev, fromRef: event.target.value }))} placeholder="from ref (default current)" />
                    </div>
                    <label className="run-compare-toggle"><input type="checkbox" checked={branchCreateDraft.noSwitch} onChange={(event) => setBranchCreateDraft((prev) => ({ ...prev, noSwitch: event.target.checked }))} /><span>Create without switching</span></label>
                    <button className="btn-accent" disabled={busy || branchCreateDraft.name.trim() === ""} onClick={() => void handleCreateBranchWorkspace()}>Create Branch</button>
                  </div>
                  <div className="merge-controls">
                    <label><span>Base Branch</span><select value={mergeBaseBranch} onChange={(event) => setMergeBaseBranch(event.target.value)}><option value="">select base</option>{branches.map((branch) => (<option key={`base-${branch.name}`} value={branch.name}>{branch.name}{branch.current ? " (current)" : ""}</option>))}</select></label>
                    <label><span>Head Branch</span><select value={mergeHeadBranch} onChange={(event) => setMergeHeadBranch(event.target.value)}><option value="">select head</option>{branches.map((branch) => (<option key={`head-${branch.name}`} value={branch.name}>{branch.name}{branch.current ? " (current)" : ""}</option>))}</select></label>
                    <button disabled={busy || !projectFound} onClick={() => void refreshBranches()}>Refresh Branches</button>
                    <button className="btn-accent" disabled={busy || !mergeBaseBranch || !mergeHeadBranch} onClick={() => void handleAnalyzeMergePlan()}>Analyze Merge</button>
                  </div>
                  <div className={`merge-guidance tone-${mergeGuidance.tone}`}>
                    <strong>{mergeGuidance.label}</strong>
                    <p className="run-meta">{mergeGuidance.detail}</p>
                  </div>
                  {branchPreflightReport ? (
                    <div className="merge-preflight-card">
                      <h3>Preflight</h3>
                      <p className="run-meta">merge-base: {branchPreflightReport.merge_base}</p>
                      <p className="run-meta">base changed: {branchPreflightReport.base_changed_count} / head changed: {branchPreflightReport.head_changed_count} / overlap: {branchPreflightReport.overlap_count}</p>
                      <p className="run-meta">safe_to_merge: {branchPreflightReport.safe_to_merge ? "yes" : "no"} / risk: {branchPreflightReport.risk_level}</p>
                      <div className="run-compare-table">
                        <h5>Overlap Categories</h5>
                        {Object.entries(branchPreflightReport.overlap_by_category).map(([category, rows]) => rows.length ? (<p key={category} className="run-meta">{category}: {rows.length}</p>) : null)}
                      </div>
                      {branchPreflightReport.recommendations.length ? (
                        <div className="run-recommendation-reasons">
                          {branchPreflightReport.recommendations.map((row, index) => (<p key={`${index}-${row}`} className="run-meta">- {row}</p>))}
                        </div>
                      ) : null}
                    </div>
                  ) : (<div className="merge-preflight-card empty-review"><p>Run merge analysis to view preflight risk.</p></div>)}
                  {branchDiffReport ? (
                    <div className="merge-diff-card">
                      <h3>Branch Diff</h3>
                      <p className="run-meta">{branchDiffReport.base}...{branchDiffReport.head} / ahead {branchDiffReport.ahead_by} / behind {branchDiffReport.behind_by}</p>
                      <div className="merge-diff-list">
                        {branchDiffReport.files.length === 0 ? (<p className="run-meta">No authoring file changes.</p>) : (branchDiffReport.files.slice(0, 40).map((file) => (<p key={`${file.status}-${file.path}`} className="run-meta">{file.status} {file.path} (+{file.added ?? "n/a"} / -{file.deleted ?? "n/a"})</p>)))}
                      </div>
                    </div>
                  ) : null}
                  <div className="proposal-actions">
                    <button className="btn-accent" disabled={busy || !mergeGuidance.canApply} onClick={() => void handleApplyMergePlan()}>Apply Merge</button>
                    <button disabled={busy || !mergeBaseBranch} onClick={() => void handleSwitchBranchWorkspace(mergeBaseBranch)}>Switch To Base</button>
                    <button disabled={busy || !mergeHeadBranch} onClick={() => void handleSwitchBranchWorkspace(mergeHeadBranch)}>Switch To Head</button>
                  </div>
                  {branchMergeResult ? (
                    <div className="merge-result-card">
                      <h3>Last Merge Result</h3>
                      <p className="run-meta">merged {branchMergeResult.head} into {branchMergeResult.base}</p>
                      <p className="run-meta">commit: {branchMergeResult.merge_commit}</p>
                    </div>
                  ) : null}
                </>
              )}

            </div>
          )}

          {/* Codex edit card (shown in content when sidebar is on codex) */}
          {sidebarContent === "codex" && selectedCodexEntityId && viewMode === "write" ? (
            <div className="codex-edit-card" style={{ marginTop: "var(--space-4)" }}>
              <h3>Edit Entity</h3>
              <div className="row">
                <select value={codexDraft.type} onChange={(event) => setCodexDraft((prev) => ({ ...prev, type: event.target.value as CodexEntity["type"] }))}>
                  <option value="character">character</option>
                  <option value="location">location</option>
                  <option value="lore">lore</option>
                  <option value="item">item</option>
                  <option value="faction">faction</option>
                  <option value="event">event</option>
                </select>
                <input value={codexDraft.name} onChange={(event) => setCodexDraft((prev) => ({ ...prev, name: event.target.value }))} />
              </div>
              <textarea className="codex-description-input" value={codexDraft.description}
                onChange={(event) => setCodexDraft((prev) => ({ ...prev, description: event.target.value }))} />
              <button className="btn-accent" disabled={busy || !canSaveCodex} onClick={handleSaveCodex}>Save Entity</button>
            </div>
          ) : null}
        </main>
      </div>

      {/* ── Status Bar ───────────────────────────────────────── */}
      <footer className="status-bar" role="status" aria-label="Status bar">
        <div className="status-bar-left">
          <span>{currentBranchName || "main"}</span>
          {scene ? <span>{scene.updated_at ? "saved" : "new"}</span> : null}
        </div>
        <div className="status-bar-right">
          {busy ? <span className="busy">Working...</span> : null}
          {error ? <span className="error">{error}</span> : null}
          {message && !error ? <span>{message}</span> : null}
          {viewMode === "write" && scene ? <span>{wordCount.toLocaleString()} words</span> : null}
        </div>
      </footer>

    </div>
  );
}

