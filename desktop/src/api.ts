import type {
  BranchDiffReport,
  BranchMergeResult,
  BranchPreflightReport,
  BranchSummary,
  ChatMessageRecord,
  ChatSendResult,
  ChatThreadRecord,
  ChatTurnDiff,
  CodexEntity,
  CodexRelationship,
  CanonFact,
  NarrativeSetup,
  OpenQuestion,
  CharacterArcState,
  CanonDiagnostic,
  CanonEvidence,
  ContinuityIssue,
  CoreCommandResponse,
  GenerationBudgetReport,
  GenerationPin,
  GenerationRunDetail,
  GenerationRuntimeConfig,
  GenerationRunSummary,
  InitProjectResult,
  MergeConflictScan,
  PerformanceBaselineReport,
  ProposalProvider,
  ProposalRecord,
  RevisionComparison,
  RevisionSummary,
  RevisionRetrospective,
  ManuscriptPlan,
  LocalProductDashboard,
  PlanMovePreview,
  ProjectIdentity,
  ProjectStatus,
  SceneDetail,
  SceneSummary,
  StartupHealthReport,
  WorkspaceAuditReport
} from "./types";
import type { AssistantTurnRecord } from "./types";
import type { AssistantEventEnvelope } from "./assistantEvents";
import type { SceneEditVersion } from "./types";
import { SceneEditConflictError, type SceneConflict } from "./sceneConflicts";
import { withBookMetadataWrite } from "./bookOperationBarrier";

const ALLOWED = new Set([
  "init",
  "project",
  "scene",
  "codex",
  "proposal",
  "snapshot",
  "branch",
  "check",
  "retrieval",
  "generation",
  "chat",
  "auth",
  "manuscript",
  "revision",
  "backup",
  "plan",
  "memory",
  "search",
  "pass",
  "storyline",
  "style",
  "metrics"
]);

function ensureAllowed(args: string[]): void {
  if (args.length === 0) {
    throw new Error("No core command supplied.");
  }
  if (!ALLOWED.has(args[0])) {
    throw new Error(`Unsupported command prefix: ${args[0]}`);
  }
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

async function tauriInvoke<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop runtime required for local project operations.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, payload);
}

export async function getProjectStatus(projectRoot: string): Promise<ProjectStatus> {
  if (!isTauriRuntime()) {
    return {
      found: false,
      project_root: projectRoot,
    };
  }
  return tauriInvoke<ProjectStatus>("project_status", { projectRoot });
}

export async function pickFolder(startingPath?: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return tauriInvoke<string | null>("pick_folder", {
    startingPath: startingPath?.trim() ? startingPath.trim() : null,
  });
}

export async function pickZipFile(startingPath?: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return tauriInvoke<string | null>("pick_zip_file", {
    startingPath: startingPath?.trim() ? startingPath.trim() : null,
  });
}

export async function createPortableBackup(projectRoot: string, target: string): Promise<{ verified: boolean; file_count: number; path: string }> {
  return decodeJson(await runCoreCommand(projectRoot, ["backup", "create", "--target", target, "--json"]));
}

export async function restorePortableBackup(source: string, target: string): Promise<{ verified: boolean; project_root: string }> {
  return decodeJson(await runCoreCommand(CONTROL_PROJECT_ROOT, ["backup", "restore", "--source", source, "--target", target, "--json"]));
}

export async function pickManuscriptFile(startingPath?: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return tauriInvoke<string | null>("pick_manuscript_file", {
    startingPath: startingPath?.trim() ? startingPath.trim() : null,
  });
}

export type ImportSectionRole = "act" | "chapter" | "scene" | "text";
export type ImportCorrections = Record<string, { title?: string; role?: ImportSectionRole }>;
export type ManuscriptImportPreview = {
  source: string;
  strategy: "auto" | "files" | "headings" | "single";
  scene_count: number;
  chapter_count: number;
  fingerprint: string;
  word_count: number;
  warnings: string[];
  sections: Array<{ id: string; title: string; role: ImportSectionRole; level: number; word_count: number; excerpt: string }>;
  scenes: Array<{
    position: number;
    title: string;
    source_path: string;
    source_format: string;
    word_count: number;
    excerpt: string;
    chapter_title?: string;
    act_title?: string;
  }>;
};

export async function previewManuscriptImport(
  source: string,
  strategy: "auto" | "files" | "headings" | "single" = "auto",
  corrections: ImportCorrections = {}
): Promise<ManuscriptImportPreview> {
  const result = await runCoreCommand(CONTROL_PROJECT_ROOT, [
    "manuscript", "preview", "--source", source, "--strategy", strategy, "--corrections", JSON.stringify(corrections), "--json"
  ]);
  return decodeJson<ManuscriptImportPreview>(result);
}

export async function importManuscript(
  projectRoot: string,
  source: string,
  strategy: "auto" | "files" | "headings" | "single" = "auto",
  corrections: ImportCorrections = {},
  expectedFingerprint?: string
): Promise<{ scene_count: number; word_count: number; scene_ids: string[]; warnings: string[] }> {
  const result = await runCoreCommand(projectRoot, [
    "manuscript", "import", "--source", source, "--strategy", strategy,
    "--corrections", JSON.stringify(corrections),
    ...(expectedFingerprint ? ["--expected-fingerprint", expectedFingerprint] : []), "--json"
  ]);
  return decodeJson(result);
}

export async function pickExportTarget(
  format: "markdown" | "docx" | "backup",
  startingPath?: string
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return tauriInvoke<string | null>("pick_export_target", {
    format,
    startingPath: startingPath?.trim() ? startingPath.trim() : null,
  });
}

export async function exportManuscript(
  projectRoot: string,
  target: string,
  format: "markdown" | "docx"
): Promise<{ scene_count: number; target: string; losses: string[]; report_path: string }> {
  const result = await runCoreCommand(projectRoot, [
    "manuscript", "export", "--format", format, "--target", target, "--json"
  ]);
  return decodeJson(result);
}

export async function getManuscriptReading(projectRoot: string): Promise<import("./types").ManuscriptReading> {
  return decodeJson(await runCoreCommand(projectRoot, ["manuscript", "read", "--json"]));
}

export async function runCoreCommand(
  projectRoot: string,
  args: string[]
): Promise<CoreCommandResponse> {
  ensureAllowed(args);
  const reads: Record<string, string[]> = {
    style: ["get"],
    plan: ["get", "scene-preview"],
    codex: ["get", "list", "relationship-list"],
    memory: ["list", "fact-list", "setup-list", "question-list", "arc-list", "diagnose"],
  };
  if ((reads[args[0]] && !reads[args[0]].includes(args[1])) || (args[0] === "scene" && args[1] === "add")) {
    if (args[0] === "scene" && args[1] === "update") return tauriInvoke<CoreCommandResponse>("core_command", { projectRoot, args });
    return withBookMetadataWrite(projectRoot, () => tauriInvoke<CoreCommandResponse>("core_command", { projectRoot, args }));
  }
  return tauriInvoke<CoreCommandResponse>("core_command", { projectRoot, args });
}

export async function projectInspect(projectRoot: string): Promise<ProjectIdentity> {
  const result = await runCoreCommand(projectRoot, ["project", "inspect", "--json"]);
  return decodeJson<ProjectIdentity>(result);
}

export async function projectEnsureId(
  projectRoot: string,
  expectedProjectId?: string
): Promise<ProjectIdentity> {
  const args = ["project", "ensure-id"];
  if (expectedProjectId && expectedProjectId.trim() !== "") {
    args.push("--id", expectedProjectId.trim());
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProjectIdentity>(result);
}

const CONTROL_PROJECT_ROOT = ".";

export async function initializeLocalProject(
  targetPath: string,
  payload?: {
    name?: string;
    projectId?: string;
    fromZip?: string;
    fromFolder?: string;
  }
): Promise<InitProjectResult> {
  const normalizedTarget = targetPath.trim();
  if (!normalizedTarget) {
    throw new Error("Target path is required.");
  }
  const args = ["init", normalizedTarget];
  if (payload?.name && payload.name.trim() !== "") {
    args.push("--name", payload.name.trim());
  }
  if (payload?.projectId && payload.projectId.trim() !== "") {
    args.push("--project-id", payload.projectId.trim());
  }
  if (payload?.fromZip && payload.fromZip.trim() !== "") {
    args.push("--from-zip", payload.fromZip.trim());
  }
  if (payload?.fromFolder && payload.fromFolder.trim() !== "") {
    args.push("--from-folder", payload.fromFolder.trim());
  }
  args.push("--json");
  const result = await runCoreCommand(CONTROL_PROJECT_ROOT, args);
  return decodeJson<InitProjectResult>(result);
}

function decodeJson<T>(response: CoreCommandResponse): T {
  if (response.status !== 0) {
    throw new Error(response.stderr || response.stdout || "Core command failed.");
  }
  try {
    return JSON.parse(response.stdout) as T;
  } catch (error) {
    throw new Error(`Invalid JSON from core command: ${String(error)}`);
  }
}

export async function listScenes(projectRoot: string): Promise<SceneSummary[]> {
  const result = await runCoreCommand(projectRoot, ["scene", "list", "--json"]);
  return decodeJson<SceneSummary[]>(result);
}

export async function getScene(projectRoot: string, sceneId: string): Promise<SceneDetail> {
  const result = await runCoreCommand(projectRoot, [
    "scene",
    "get",
    "--id",
    sceneId,
    "--json"
  ]);
  return decodeJson<SceneDetail>(result);
}

export async function addScene(
  projectRoot: string,
  payload: {
    title: string;
    summary: string;
    pov: string;
    status: string;
    body: string;
  }
): Promise<SceneDetail> {
  const result = await runCoreCommand(projectRoot, [
    "scene",
    "add",
    "--title",
    payload.title,
    "--summary",
    payload.summary,
    "--pov",
    payload.pov,
    "--status",
    payload.status,
    "--body",
    payload.body,
    "--json"
  ]);
  return decodeJson<SceneDetail>(result);
}

export async function updateScene(
  projectRoot: string,
  sceneId: string,
  payload: {
    title?: string;
    summary?: string;
    pov?: string;
    status?: string;
    body?: string;
    expectedVersion?: SceneEditVersion;
  }
): Promise<SceneDetail> {
  if (!payload.expectedVersion) throw new Error("This scene has no save version. Reopen it before saving; your draft has not been written.");
  const args = ["scene", "update", "--id", sceneId];
  args.push("--expected-version", JSON.stringify(payload.expectedVersion));
  for (const key of ["title", "summary", "pov", "status", "body"] as const) {
    const value = payload[key];
    if (value !== undefined) args.push(`--${key}`, value);
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  if (result.status === 3) {
    const conflict = JSON.parse(result.stdout)?.error as SceneConflict;
    if (conflict?.code === "scene_edit_conflict" && conflict.current?.edit_version) {
      throw new SceneEditConflictError(conflict);
    }
  }
  return decodeJson<SceneDetail>(result);
}

export async function updateSceneMetadata(
  projectRoot: string,
  sceneId: string,
  payload: { summary?: string; pov?: string; status?: string; expectedVersion?: SceneEditVersion }
): Promise<SceneDetail> {
  return updateScene(projectRoot, sceneId, payload);
}

export async function getManuscriptPlan(projectRoot: string): Promise<ManuscriptPlan> {
  const result = await runCoreCommand(projectRoot, ["plan", "get", "--json"]);
  return decodeJson<ManuscriptPlan>(result);
}

export async function updateProjectBrief(
  projectRoot: string,
  brief: ManuscriptPlan["brief"],
  expectedVersion?: { workspace: string; value: ManuscriptPlan["brief"] }
): Promise<ManuscriptPlan> {
  const args = [
    "plan", "brief",
    "--synopsis", brief.synopsis,
    "--genre", brief.genre,
    "--style-guide", brief.style_guide,
    "--outline", brief.outline,
  ];
  for (const theme of brief.themes) args.push("--theme", theme);
  if (!brief.themes.length) args.push("--clear-themes");
  if (expectedVersion) args.push("--expected-version", JSON.stringify(expectedVersion));
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ManuscriptPlan>(result);
}

export async function addPlanAct(
  projectRoot: string,
  title: string,
  synopsis = "",
  expectedWorkspace?: string
): Promise<ManuscriptPlan["acts"][number]> {
  const result = await runCoreCommand(projectRoot, [
    "plan", "act-add", "--title", title, "--synopsis", synopsis, "--json", ...(expectedWorkspace ? ["--expected-workspace", expectedWorkspace] : [])
  ]);
  return decodeJson(result);
}

export async function addPlanChapter(
  projectRoot: string,
  actId: string,
  title: string,
  synopsis = "",
  expectedWorkspace?: string
): Promise<ManuscriptPlan["acts"][number]["chapters"][number]> {
  const result = await runCoreCommand(projectRoot, [
    "plan", "chapter-add", "--act", actId, "--title", title, "--synopsis", synopsis, "--json", ...(expectedWorkspace ? ["--expected-workspace", expectedWorkspace] : [])
  ]);
  return decodeJson(result);
}

export async function assignPlanScene(
  projectRoot: string,
  sceneId: string,
  chapterId: string | null,
  beforeSceneId?: string,
  expectedWorkspace?: string
): Promise<ManuscriptPlan> {
  const args = ["plan", "scene-assign", "--scene", sceneId];
  if (expectedWorkspace) args.push("--expected-workspace", expectedWorkspace);
  if (chapterId) args.push("--chapter", chapterId);
  if (beforeSceneId) args.push("--before", beforeSceneId);
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson(result);
}

export async function previewPlanSceneMove(
  projectRoot: string,
  sceneId: string,
  chapterId: string | null,
  beforeSceneId?: string
): Promise<PlanMovePreview> {
  const args = ["plan", "scene-preview", "--scene", sceneId];
  if (chapterId) args.push("--chapter", chapterId);
  if (beforeSceneId) args.push("--before", beforeSceneId);
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<PlanMovePreview>(result);
}

export async function updatePlanSceneMetadata(
  projectRoot: string,
  sceneId: string,
  metadata: { timelinePosition: string; labels: string[] },
  expectedVersion?: { workspace: string; value: ManuscriptPlan["scene_metadata"][string] }
): Promise<ManuscriptPlan["scene_metadata"][string]> {
  const args = ["plan", "scene-meta", "--scene", sceneId, "--timeline", metadata.timelinePosition];
  for (const label of metadata.labels) args.push("--label", label);
  if (!metadata.labels.length) args.push("--clear-labels");
  if (expectedVersion) args.push("--expected-version", JSON.stringify(expectedVersion));
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson(result);
}

export async function getLocalProductDashboard(projectRoot: string): Promise<LocalProductDashboard> {
  const result = await runCoreCommand(projectRoot, ["metrics", "dashboard", "--json"]);
  return decodeJson<LocalProductDashboard>(result);
}

export async function updateLocalProductSignals(
  projectRoot: string,
  enabled: boolean
): Promise<{ local_signals_enabled: boolean; external_telemetry_enabled: false; retention_days: number }> {
  const result = await runCoreCommand(projectRoot, [
    "metrics", "settings", "--local-signals", enabled ? "on" : "off", "--json"
  ]);
  return decodeJson(result);
}

export async function addPlanBeat(
  projectRoot: string,
  sceneId: string,
  summary: string,
  expectedWorkspace?: string
): Promise<ManuscriptPlan["beats"][number]> {
  const result = await runCoreCommand(projectRoot, [
    "plan", "beat-add", "--scene", sceneId, "--summary", summary, "--json", ...(expectedWorkspace ? ["--expected-workspace", expectedWorkspace] : [])
  ]);
  return decodeJson(result);
}

export async function listProposals(
  projectRoot: string,
  status?: "pending" | "applied" | "rejected"
): Promise<ProposalRecord[]> {
  const args = ["proposal", "list"];
  if (status) {
    args.push("--status", status);
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord[]>(result);
}

export async function createProposal(
  projectRoot: string,
  payload: {
    title: string;
    instruction: string;
    sceneId: string;
  }
): Promise<ProposalRecord> {
  const result = await runCoreCommand(projectRoot, [
    "proposal",
    "add",
    "--title",
    payload.title,
    "--instruction",
    payload.instruction,
    "--scene",
    payload.sceneId,
    "--json"
  ]);
  return decodeJson<ProposalRecord>(result);
}

export async function getProposal(projectRoot: string, proposalId: string): Promise<ProposalRecord> {
  return decodeJson(await runCoreCommand(projectRoot, ["proposal", "get", "--id", proposalId, "--json"]));
}

export async function generateProposal(
  projectRoot: string,
  payload: {
    sceneId: string;
    requestId?: string;
    instruction: string;
    provider: ProposalProvider;
    title?: string;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    contextScenes?: number;
    codexLimit?: number;
    retrievalMode?: "off" | "auto" | "required";
    retrievalLimit?: number;
    retrievalMinScore?: number;
    retrievalRequireFresh?: boolean;
    constraints?: string[];
    protectedElements?: string[];
    changeGroupId?: string;
    authorization?: RevisionAuthorization;
  }
): Promise<ProposalRecord> {
  const args = [
    "proposal",
    "generate",
    "--scene",
    payload.sceneId,
    "--instruction",
    payload.instruction,
    "--provider",
    payload.provider
  ];
  if (payload.requestId) args.push("--request-id", payload.requestId);
  if (payload.authorization) args.push("--memory-approvals", JSON.stringify(payload.authorization.memoryApprovals),
    "--story-approvals", JSON.stringify(payload.authorization.storyApprovals), "--expected-context-fingerprint", payload.authorization.fingerprint);
  if (payload.title && payload.title.trim() !== "") {
    args.push("--title", payload.title);
  }
  if (payload.model && payload.model.trim() !== "") {
    args.push("--model", payload.model);
  }
  if (typeof payload.temperature === "number") {
    args.push("--temperature", String(payload.temperature));
  }
  if (typeof payload.maxOutputTokens === "number") {
    args.push("--max-output-tokens", String(payload.maxOutputTokens));
  }
  if (typeof payload.contextScenes === "number") {
    args.push("--context-scenes", String(payload.contextScenes));
  }
  if (typeof payload.codexLimit === "number") {
    args.push("--codex-limit", String(payload.codexLimit));
  }
  if (payload.retrievalMode) {
    args.push("--retrieval-mode", payload.retrievalMode);
  }
  if (typeof payload.retrievalLimit === "number") {
    args.push("--retrieval-limit", String(payload.retrievalLimit));
  }
  if (typeof payload.retrievalMinScore === "number") {
    args.push("--retrieval-min-score", String(payload.retrievalMinScore));
  }
  if (payload.retrievalRequireFresh) {
    args.push("--retrieval-require-fresh");
  }
  for (const constraint of payload.constraints ?? []) {
    if (constraint.trim()) args.push("--constraint", constraint.trim());
  }
  for (const protectedElement of payload.protectedElements ?? []) {
    if (protectedElement.trim()) args.push("--protect", protectedElement.trim());
  }
  if (payload.changeGroupId?.trim()) {
    args.push("--change-group", payload.changeGroupId.trim());
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function applyProposal(
  projectRoot: string,
  proposalId: string,
  notes = "",
  force = false
): Promise<ProposalRecord> {
  const args = ["proposal", "apply", "--id", proposalId, "--notes", notes];
  if (force) {
    args.push("--force");
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function applyProposalBatch(projectRoot: string, proposalIds: string[], force = false): Promise<{ change_group_id: string; applied_revision: string; proposal_ids: string[]; scene_ids: string[]; proposals: ProposalRecord[] }> {
  const args = ["proposal", "apply-batch"];
  for (const id of proposalIds) args.push("--id", id);
  if (force) args.push("--force");
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function undoProposalBatch(projectRoot: string, appliedRevision: string): Promise<{
  change_group_id: string; applied_revision: string; undo_revision: string; restored_revision: string;
  proposal_ids: string[]; scene_ids: string[]; proposals: ProposalRecord[]; scenes: SceneDetail[]; warnings: string[];
}> {
  return decodeJson(await runCoreCommand(projectRoot, ["proposal", "undo-batch", "--revision", appliedRevision, "--json"]));
}

export async function undoProposal(
  projectRoot: string,
  proposalId: string,
  force = false
): Promise<ProposalRecord> {
  const args = ["proposal", "undo", "--id", proposalId];
  if (force) {
    args.push("--force");
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function draftProposal(
  projectRoot: string,
  payload: {
    proposalId: string;
    requestId?: string;
    provider: ProposalProvider;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    authorization?: RevisionAuthorization;
  }
): Promise<ProposalRecord> {
  const args = ["proposal", "draft", "--id", payload.proposalId, "--provider", payload.provider];
  if (payload.requestId) args.push("--request-id", payload.requestId);
  if (payload.model && payload.model.trim() !== "") {
    args.push("--model", payload.model);
  }
  if (typeof payload.temperature === "number") {
    args.push("--temperature", String(payload.temperature));
  }
  if (typeof payload.maxOutputTokens === "number") {
    args.push("--max-output-tokens", String(payload.maxOutputTokens));
  }
  if (payload.authorization) args.push("--expected-context-fingerprint", payload.authorization.fingerprint,
    "--memory-approvals", JSON.stringify(payload.authorization.memoryApprovals), "--story-approvals", JSON.stringify(payload.authorization.storyApprovals));
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function updateProposalHunk(
  projectRoot: string,
  proposalId: string,
  hunkId: string,
  decision: "accepted" | "rejected"
): Promise<ProposalRecord> {
  const result = await runCoreCommand(projectRoot, [
    "proposal",
    "hunk",
    "--id",
    proposalId,
    "--hunk",
    hunkId,
    "--decision",
    decision,
    "--json"
  ]);
  return decodeJson<ProposalRecord>(result);
}

export async function editProposalHunk(
  projectRoot: string,
  proposalId: string,
  hunkId: string,
  afterText: string
): Promise<ProposalRecord> {
  const result = await runCoreCommand(projectRoot, [
    "proposal", "hunk-edit", "--id", proposalId, "--hunk", hunkId,
    "--after-text", afterText, "--json"
  ]);
  return decodeJson<ProposalRecord>(result);
}

export async function regenerateProposalHunk(
  projectRoot: string,
  proposalId: string,
  hunkId: string,
  provider: ProposalProvider,
  model?: string,
  feedback?: string,
  requestId?: string,
  authorization?: RevisionAuthorization
): Promise<ProposalRecord> {
  const args = [
    "proposal", "hunk-regenerate", "--id", proposalId, "--hunk", hunkId,
    "--provider", provider
  ];
  if (model?.trim()) args.push("--model", model.trim());
  if (feedback?.trim()) args.push("--feedback", feedback.trim());
  if (requestId) args.push("--request-id", requestId);
  if (authorization) args.push("--expected-context-fingerprint", authorization.fingerprint,
    "--memory-approvals", JSON.stringify(authorization.memoryApprovals), "--story-approvals", JSON.stringify(authorization.storyApprovals));
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function rebaseProposal(projectRoot: string, proposalId: string): Promise<ProposalRecord> {
  const result = await runCoreCommand(projectRoot, [
    "proposal", "rebase", "--id", proposalId, "--json"
  ]);
  return decodeJson<ProposalRecord>(result);
}

export async function rejectProposal(
  projectRoot: string,
  proposalId: string,
  notes = ""
): Promise<ProposalRecord> {
  const result = await runCoreCommand(projectRoot, [
    "proposal",
    "reject",
    "--id",
    proposalId,
    "--notes",
    notes,
    "--json"
  ]);
  return decodeJson<ProposalRecord>(result);
}

export async function listRevisions(projectRoot: string, limit = 50): Promise<RevisionSummary[]> {
  const result = await runCoreCommand(projectRoot, [
    "revision", "list", "--limit", String(limit), "--json"
  ]);
  return decodeJson<RevisionSummary[]>(result);
}

export async function saveRevision(projectRoot: string, message: string): Promise<RevisionSummary> {
  return decodeJson(await runCoreCommand(projectRoot, ["revision", "save", "--message", message, "--json"]));
}

export async function getRevisionRetrospective(projectRoot: string, base: string, head: string): Promise<RevisionRetrospective> {
  const result = await runCoreCommand(projectRoot, ["revision", "retrospective", "--base", base, "--head", head, "--json"]);
  return decodeJson(result);
}

export async function compareRevisions(
  projectRoot: string,
  baseRevision: string,
  headRevision: string
): Promise<RevisionComparison> {
  const result = await runCoreCommand(projectRoot, [
    "revision", "diff", "--base", baseRevision, "--head", headRevision, "--include-unchanged", "--json"
  ]);
  return decodeJson<RevisionComparison>(result);
}

export async function restoreRevision(
  projectRoot: string,
  revisionId: string,
  paths: string[]
): Promise<Record<string, unknown>> {
  const args = ["revision", "restore", "--id", revisionId];
  for (const path of paths) args.push("--path", path);
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<Record<string, unknown>>(result);
}

export async function listChatThreads(projectRoot: string): Promise<ChatThreadRecord[]> {
  // Prefer the warm sidecar; fall back to a one-shot CLI invocation if it
  // is unavailable (e.g. first call racing a failed spawn).
  try {
    return await sidecarRequest<ChatThreadRecord[]>(
      projectRoot,
      nextSidecarRequestId(),
      "chat.threads",
      {},
      15_000
    );
  } catch (error) {
    if (error instanceof SidecarDomainError) throw error;
    const result = await runCoreCommand(projectRoot, ["chat", "thread", "list", "--json"]);
    return decodeJson<ChatThreadRecord[]>(result);
  }
}

export async function createChatThread(
  projectRoot: string,
  payload: {
    title: string;
    provider: ProposalProvider;
    model?: string;
    mode?: "chat" | "agent";
  }
): Promise<ChatThreadRecord> {
  const args = [
    "chat",
    "thread",
    "create",
    "--title",
    payload.title,
    "--provider",
    payload.provider
  ];
  if (payload.model && payload.model.trim() !== "") {
    args.push("--model", payload.model.trim());
  }
  if (payload.mode) {
    args.push("--mode", payload.mode);
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ChatThreadRecord>(result);
}

export async function updateChatThread(
  projectRoot: string,
  payload: {
    id: string;
    title?: string;
    provider?: ProposalProvider;
    model?: string;
    mode?: "chat" | "agent";
    includeCurrentScene?: boolean;
    includeSelection?: boolean;
    includeRecentScenesRadius?: number;
    includeCodex?: "off" | "explicit" | "auto" | "auto_and_explicit";
    retrievalMode?: "off" | "auto" | "required";
    retrievalLimit?: number;
    retrievalMinScore?: number;
    retrievalRequireFresh?: boolean;
    agentAutoReadOnly?: boolean;
    agentConfirmWrites?: boolean;
  }
): Promise<ChatThreadRecord> {
  if (payload.title !== undefined) {
    const result = await runCoreCommand(projectRoot, [
      "chat",
      "thread",
      "rename",
      "--id",
      payload.id,
      "--title",
      payload.title,
      "--json"
    ]);
    return decodeJson<ChatThreadRecord>(result);
  }
  const args = ["chat", "thread", "update", "--id", payload.id];
  if (payload.provider) {
    args.push("--provider", payload.provider);
  }
  if (payload.model !== undefined) {
    args.push("--model", payload.model);
  }
  if (payload.mode) {
    args.push("--mode", payload.mode);
  }
  if (typeof payload.includeCurrentScene === "boolean") {
    args.push("--include-current-scene", payload.includeCurrentScene ? "true" : "false");
  }
  if (typeof payload.includeSelection === "boolean") {
    args.push("--include-selection", payload.includeSelection ? "true" : "false");
  }
  if (typeof payload.includeRecentScenesRadius === "number") {
    args.push("--include-recent-scenes-radius", String(payload.includeRecentScenesRadius));
  }
  if (payload.includeCodex) {
    args.push("--include-codex", payload.includeCodex);
  }
  if (payload.retrievalMode) {
    args.push("--retrieval-mode", payload.retrievalMode);
  }
  if (typeof payload.retrievalLimit === "number") {
    args.push("--retrieval-limit", String(payload.retrievalLimit));
  }
  if (typeof payload.retrievalMinScore === "number") {
    args.push("--retrieval-min-score", String(payload.retrievalMinScore));
  }
  if (typeof payload.retrievalRequireFresh === "boolean") {
    args.push("--retrieval-require-fresh", payload.retrievalRequireFresh ? "true" : "false");
  }
  if (typeof payload.agentAutoReadOnly === "boolean") {
    args.push("--agent-auto-read-only", payload.agentAutoReadOnly ? "true" : "false");
  }
  if (typeof payload.agentConfirmWrites === "boolean") {
    args.push("--agent-confirm-writes", payload.agentConfirmWrites ? "true" : "false");
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ChatThreadRecord>(result);
}

export async function listChatMessages(
  projectRoot: string,
  payload: {
    threadId: string;
    limit?: number;
  }
): Promise<ChatMessageRecord[]> {
  try {
    return await sidecarRequest<ChatMessageRecord[]>(
      projectRoot,
      nextSidecarRequestId(),
      "chat.messages",
      {
        thread_id: payload.threadId,
        limit: typeof payload.limit === "number" ? payload.limit : null,
      },
      15_000
    );
  } catch (error) {
    if (error instanceof SidecarDomainError) throw error;
    const args = ["chat", "message", "list", "--thread", payload.threadId];
    if (typeof payload.limit === "number") {
      args.push("--limit", String(payload.limit));
    }
    args.push("--json");
    const result = await runCoreCommand(projectRoot, args);
    return decodeJson<ChatMessageRecord[]>(result);
  }
}

export type ChatSendPayload = {
  threadId: string;
  deliveryId?: string;
  message: string;
  currentSceneId?: string;
  sceneIds?: string[];
  selectedText?: string;
  codexIds?: string[];
  approvedCodexIds?: string[];
  memoryApprovals?: MemoryApproval[];
  storyApprovals?: string[];
  expectedContextFingerprint?: string;
  includeCurrentScene?: boolean;
  includeSelection?: boolean;
  includeRecentScenesRadius?: number;
  includeCodex?: "off" | "explicit" | "auto" | "auto_and_explicit";
  retrievalMode?: "off" | "auto" | "required";
  retrievalLimit?: number;
  retrievalMinScore?: number;
  retrievalRequireFresh?: boolean;
  agentAutoReadOnly?: boolean;
  agentConfirmWrites?: boolean;
  scope?: "project" | "scene" | "chapter" | "character" | "storyline";
  turnId?: string;
  channel?: "text" | "desktop_voice" | "mobile_voice";
  replacementFromMessageId?: string;
};

export type MemoryApproval = { entity_id: string; detail_key?: string };
export type RevisionAuthorization = { fingerprint: string; memoryApprovals: MemoryApproval[]; storyApprovals: string[] };
export type RevisionContextPreview = Pick<SelectionPreview, "fingerprint" | "provider" | "model" | "system_prompt" | "user_prompt" | "estimated_input_tokens" | "max_output_tokens" | "memory_choices" | "story_choices"> & {
  style_profile_status?: { freshness: "absent" | "current" | "stale" | "unknown"; included: boolean; reference_mode: "current" | "frozen" };
  context: { scene: { id: string; title: string }; guidance_branch?: string; nearby_scenes?: Array<{ id: string; title: string }>; codex_entities: Array<{ id: string; name: string }>; story_plan: { limits: { clipped_fields: string[]; omitted_chapters: number; omitted_relevant_beats: number } } };
  limits: { omitted_memory_ids: string[] };
};
export async function previewProposalRevision(projectRoot: string, input: {
  proposal_id: string; hunk_id?: string; provider: ProposalProvider; model?: string; feedback?: string;
  memory_approvals: MemoryApproval[]; story_approvals: string[];
}): Promise<RevisionContextPreview> {
  return decodeJson(await runCoreCommand(projectRoot, ["proposal", "revision-preview", "--input-json", JSON.stringify(input), "--json"]));
}
export async function previewProposalGeneration(projectRoot: string, input: Parameters<typeof generateProposal>[1], memoryApprovals: MemoryApproval[], storyApprovals: string[]): Promise<RevisionContextPreview> {
  const payload = { scene_id: input.sceneId, instruction: input.instruction, provider: input.provider, model: input.model,
    temperature: input.temperature, max_output_tokens: input.maxOutputTokens, context_scene_radius: input.contextScenes,
    codex_limit: input.codexLimit, retrieval_mode: input.retrievalMode, retrieval_limit: input.retrievalLimit,
    retrieval_min_score: input.retrievalMinScore, retrieval_require_fresh: input.retrievalRequireFresh,
    constraints: input.constraints, protected_elements: input.protectedElements,
    memory_approvals: memoryApprovals, story_approvals: storyApprovals };
  return decodeJson(await runCoreCommand(projectRoot, ["proposal", "generation-preview", "--input-json", JSON.stringify(payload), "--json"]));
}
export type StoryContextChoice = { id: string; kind: "fact" | "relationship"; label: string; eligible: boolean; reason: string; approved: boolean; included: boolean };
export type SelectionAction = "rewrite" | "shorten" | "expand" | "critique";
export type EditorialReviewFocus = "general" | "continuity" | "character-knowledge" | "motivation" | "pacing" | "voice";
export type SelectionInput = {
  scene_id: string; start: number; end: number; selected_text: string; action: SelectionAction;
  instruction: string; provider: ProposalProvider; model: string; memory_approvals: MemoryApproval[];
  story_approvals?: string[];
  review_focus?: EditorialReviewFocus;
  review_scope?: "passage" | "chapter";
};
export type SelectionPreview = {
  fingerprint: string; provider: string; model: string; system_prompt: string; user_prompt: string;
  estimated_input_tokens: number; max_output_tokens: number;
  anchor: { branch: string };
  limits: { omitted_before_characters: number; omitted_after_characters: number; omitted_memory_ids: string[] };
  memory_choices: ChatContextPreview["memory_choices"];
  story_choices?: StoryContextChoice[];
  review?: { focus: EditorialReviewFocus; scope: "passage" | "chapter"; scene_ids: string[] };
};
export async function previewSelection(projectRoot: string, input: SelectionInput): Promise<SelectionPreview> {
  return decodeJson(await runCoreCommand(projectRoot, ["proposal", "selection-preview", "--input-json", JSON.stringify(input), "--json"]));
}
export async function generateSelection(projectRoot: string, input: SelectionInput, fingerprint: string, requestId: string): Promise<ProposalRecord> {
  return decodeJson(await runCoreCommand(projectRoot, ["proposal", "selection-generate", "--input-json", JSON.stringify(input), "--expected-fingerprint", fingerprint, "--request-id", requestId, "--json"]));
}
export type ChatContextPreview = {
  fingerprint: string;
  provider: string;
  model: string;
  mode: string;
  estimated_input_tokens: number;
  history_messages_included: number;
  history_messages_omitted: number;
  history_budget_limited?: boolean;
  system_prompt: string;
  user_prompt: string;
  history: Array<{ role: string; content: string }>;
  context: {
    current_scene: Array<{ id: string; title: string }>;
    nearby_scenes: Array<{ id: string; title: string }>;
    codex_entities: Array<{ id: string; name: string; details: Array<{ key: string }> }>;
    retrieval: { citations: Array<{ source_title: string }>; degraded: boolean; error: string; index?: { stale: boolean } };
    story_plan?: {
      brief: { synopsis: string; genre: string; themes: string[]; style_guide: string; outline: string };
      structure: Array<{ title: string; chapters: Array<{ title: string }> }>;
      beats: Array<{ summary: string }>;
      limits: { clipped_fields: string[]; omitted_chapters: number; omitted_relevant_beats: number };
    };
    [key: string]: unknown;
  };
  context_used: { privacy: { history_reset: boolean; one_time_approval: boolean } };
  memory_choices: Array<{ id: string; name: string; visibility: string; details: Array<{ key: string; visibility: string }> }>;
  story_choices?: StoryContextChoice[];
};

export async function previewChatContext(projectRoot: string, payload: ChatSendPayload, historyBeforeMessageId = ""): Promise<ChatContextPreview> {
  return sidecarRequest<ChatContextPreview>(projectRoot, nextSidecarRequestId(), "chat.context", {
    ...chatSendParams(payload), history_before_message_id: historyBeforeMessageId,
  });
}

export async function sendChatMessage(
  projectRoot: string,
  payload: ChatSendPayload
): Promise<ChatSendResult> {
  const args = [
    "chat",
    "send",
    "--thread",
    payload.threadId,
    "--message",
    payload.message
  ];
  if (payload.deliveryId) args.push("--request-id", payload.deliveryId);
  if (payload.memoryApprovals?.length) args.push("--memory-approvals", JSON.stringify(payload.memoryApprovals));
  if (payload.storyApprovals?.length) args.push("--story-approvals", JSON.stringify(payload.storyApprovals));
  if (payload.expectedContextFingerprint) args.push("--expected-context-fingerprint", payload.expectedContextFingerprint);
  if (payload.currentSceneId) {
    args.push("--current-scene", payload.currentSceneId);
  }
  for (const sceneId of payload.sceneIds ?? []) {
    if (sceneId.trim() !== "") {
      args.push("--scene-id", sceneId.trim());
    }
  }
  if (payload.selectedText) {
    args.push("--selected-text", payload.selectedText);
  }
  for (const codexId of payload.codexIds ?? []) {
    if (codexId.trim() !== "") {
      args.push("--codex-id", codexId.trim());
    }
  }
  for (const codexId of payload.approvedCodexIds ?? []) {
    if (codexId.trim()) args.push("--allow-memory-once", codexId.trim());
  }
  if (typeof payload.includeCurrentScene === "boolean") {
    args.push("--include-current-scene", payload.includeCurrentScene ? "true" : "false");
  }
  if (typeof payload.includeSelection === "boolean") {
    args.push("--include-selection", payload.includeSelection ? "true" : "false");
  }
  if (typeof payload.includeRecentScenesRadius === "number") {
    args.push("--include-recent-scenes-radius", String(payload.includeRecentScenesRadius));
  }
  if (payload.includeCodex) {
    args.push("--include-codex", payload.includeCodex);
  }
  if (payload.retrievalMode) {
    args.push("--retrieval-mode", payload.retrievalMode);
  }
  if (typeof payload.retrievalLimit === "number") {
    args.push("--retrieval-limit", String(payload.retrievalLimit));
  }
  if (typeof payload.retrievalMinScore === "number") {
    args.push("--retrieval-min-score", String(payload.retrievalMinScore));
  }
  if (typeof payload.retrievalRequireFresh === "boolean") {
    args.push("--retrieval-require-fresh", payload.retrievalRequireFresh ? "true" : "false");
  }
  if (typeof payload.agentAutoReadOnly === "boolean") {
    args.push("--agent-auto-read-only", payload.agentAutoReadOnly ? "true" : "false");
  }
  if (typeof payload.agentConfirmWrites === "boolean") {
    args.push("--agent-confirm-writes", payload.agentConfirmWrites ? "true" : "false");
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ChatSendResult>(result);
}

type SidecarFrame = {
  id?: string | number;
  result?: unknown;
  error?: { message?: string; category?: string };
  event?: string;
  sequence?: number;
  payload?: Record<string, unknown>;
};

type SidecarEventEnvelope = {
  projectRoot: string;
  frame: SidecarFrame;
};

const SIDECAR_EVENT_CHANNEL = "openauthor://sidecar-event";

let sidecarRequestCounter = 0;

function nextSidecarRequestId(): string {
  sidecarRequestCounter += 1;
  return `req-${Date.now()}-${sidecarRequestCounter}`;
}

export class SidecarDomainError extends Error {
  readonly category: string;

  constructor(message: string, category: string) {
    super(message);
    this.name = "SidecarDomainError";
    this.category = category;
  }
}

async function sidecarRequest<T>(
  projectRoot: string,
  requestId: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  const frame = await tauriInvoke<SidecarFrame>("sidecar_request", {
    projectRoot,
    request: { id: requestId, method, params },
    timeoutMs: timeoutMs ?? null,
  });
  if (frame.error) {
    // The sidecar ran and rejected the request — a real answer, not a
    // transport failure, so callers must not retry over the CLI.
    throw new SidecarDomainError(
      frame.error.message ?? "Sidecar request failed.",
      frame.error.category ?? "core_error"
    );
  }
  return frame.result as T;
}

function chatSendParams(payload: ChatSendPayload): Record<string, unknown> {
  const contextOverrides: Record<string, unknown> = {};
  if (typeof payload.includeCurrentScene === "boolean") {
    contextOverrides.include_current_scene = payload.includeCurrentScene;
  }
  if (typeof payload.includeSelection === "boolean") {
    contextOverrides.include_selection = payload.includeSelection;
  }
  if (typeof payload.includeRecentScenesRadius === "number") {
    contextOverrides.include_recent_scenes_radius = payload.includeRecentScenesRadius;
  }
  if (payload.includeCodex) {
    contextOverrides.include_codex = payload.includeCodex;
  }
  if (payload.retrievalMode) {
    contextOverrides.retrieval_mode = payload.retrievalMode;
  }
  if (typeof payload.retrievalLimit === "number") {
    contextOverrides.retrieval_limit = payload.retrievalLimit;
  }
  if (typeof payload.retrievalMinScore === "number") {
    contextOverrides.retrieval_min_score = payload.retrievalMinScore;
  }
  if (typeof payload.retrievalRequireFresh === "boolean") {
    contextOverrides.retrieval_require_fresh = payload.retrievalRequireFresh;
  }
  if (typeof payload.agentAutoReadOnly === "boolean") {
    contextOverrides.agent_auto_read_only = payload.agentAutoReadOnly;
  }
  if (typeof payload.agentConfirmWrites === "boolean") {
    contextOverrides.agent_confirm_writes = payload.agentConfirmWrites;
  }
  if (payload.scope) {
    contextOverrides.scope = payload.scope;
  }
  return {
    turn_id: payload.turnId,
    channel: payload.channel ?? "text",
    replace_from_message_id: payload.replacementFromMessageId ?? "",
    delivery_id: payload.deliveryId,
    thread_id: payload.threadId,
    message: payload.message,
    current_scene_id: payload.currentSceneId ?? "",
    scene_ids: (payload.sceneIds ?? []).filter((item) => item.trim() !== ""),
    selected_text: payload.selectedText ?? "",
    codex_ids: (payload.codexIds ?? []).filter((item) => item.trim() !== ""),
    approved_codex_ids: (payload.approvedCodexIds ?? []).filter((item) => item.trim() !== ""),
    memory_approvals: payload.memoryApprovals ?? [],
    story_approvals: payload.storyApprovals ?? [],
    expected_context_fingerprint: payload.expectedContextFingerprint ?? "",
    context_overrides: Object.keys(contextOverrides).length > 0 ? contextOverrides : null,
  };
}

export async function sendChatMessageStreamed(
  projectRoot: string,
  payload: ChatSendPayload,
  handlers: {
    onDelta: (text: string) => void;
    onStart?: (requestId: string, turnId: string) => void;
    onEvent?: (event: AssistantEventEnvelope) => void;
  }
): Promise<ChatSendResult> {
  const requestId = nextSidecarRequestId();
  const turnId = payload.turnId?.trim() || `turn-${crypto.randomUUID()}`;
  handlers.onStart?.(requestId, turnId);
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<SidecarEventEnvelope>(SIDECAR_EVENT_CHANNEL, (event) => {
    if (event.payload.projectRoot !== projectRoot) return;
    const frame = event.payload.frame;
    if (!frame.payload) return;
    if (frame.event === "assistant.event") {
      const assistantEvent = frame.payload as unknown as AssistantEventEnvelope;
      if (assistantEvent.turn_id === turnId) handlers.onEvent?.(assistantEvent);
      return;
    }
    if (frame.event === "chat.delta" && frame.payload.request_id === requestId) {
      handlers.onDelta(String(frame.payload.text ?? ""));
    }
  });
  try {
    return await sidecarRequest<ChatSendResult>(
      projectRoot,
      requestId,
      payload.replacementFromMessageId ? "chat.regenerate" : "chat.send",
      chatSendParams({ ...payload, turnId })
    );
  } finally {
    unlisten();
  }
}

export async function getAssistantTurn(
  projectRoot: string,
  turnId: string
): Promise<AssistantTurnRecord> {
  return sidecarRequest<AssistantTurnRecord>(
    projectRoot,
    nextSidecarRequestId(),
    "assistant.turn.get",
    { turn_id: turnId },
    10_000
  );
}

export type MobileSnapshotManifest = {
  schema: "openauthor.mobile.snapshot.manifest";
  schema_version: 1;
  project_id: string;
  revision: string;
  content_sha256: string;
  byte_length: number;
};

export type PreparedMobileSnapshot = {
  schema_version: 1;
  media_type: "application/vnd.openauthor.mobile-snapshot+json";
  manifest: MobileSnapshotManifest;
  plaintext_base64: string;
};

export type MobileOutboxEnvelopeIdentity = {
  projectId: string;
  deviceId: string;
  operationId: string;
  baseRevision: string;
  payloadDigest: string;
};

export type MobileOutboxImportResult = {
  schema_version: 1;
  project_id: string;
  device_id: string;
  operation_id: string;
  kind: string;
  payload_digest: string;
  base_revision: string;
  imported_revision: string;
  stale: boolean;
  disposition: "imported" | "pending_review" | "conflict";
  artifact_kind: string;
  artifact_id: string;
  imported_at: string;
};

export type MobileInboxItem = {
  schema_version: 1;
  id: string;
  project_id: string;
  device_id: string;
  operation_id: string;
  base_revision: string;
  imported_revision: string;
  payload_digest: string;
  kind: "capture_note" | "thread_turn";
  title: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type MobileReviewDecision = {
  schema_version: 1;
  id: string;
  project_id: string;
  device_id: string;
  operation_id: string;
  base_revision: string;
  imported_revision: string;
  payload_digest: string;
  kind: "review_decision";
  status: "pending_desktop_review" | "conflict";
  stale: boolean;
  payload: Record<string, unknown>;
  created_at: string;
};

export interface MobileSidecarRequester {
  <T>(
    projectRoot: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T>;
}

export function createMobileSidecarApi(request: MobileSidecarRequester) {
  return {
    prepareSnapshot(
      projectRoot: string,
      projectId: string
    ): Promise<PreparedMobileSnapshot> {
      return request<PreparedMobileSnapshot>(
        projectRoot,
        "mobile.snapshot.prepare",
        { project_id: projectId },
        30_000
      );
    },
    importOutboxItem(
      projectRoot: string,
      input: {
        envelope: MobileOutboxEnvelopeIdentity;
        payload: Record<string, unknown>;
      }
    ): Promise<MobileOutboxImportResult> {
      return request<MobileOutboxImportResult>(
        projectRoot,
        "mobile.outbox.import",
        {
          envelope: {
            project_id: input.envelope.projectId,
            device_id: input.envelope.deviceId,
            operation_id: input.envelope.operationId,
            base_revision: input.envelope.baseRevision,
            payload_digest: input.envelope.payloadDigest,
          },
          payload: input.payload,
        },
        30_000
      );
    },
    listInbox(projectRoot: string): Promise<MobileInboxItem[]> {
      return request<MobileInboxItem[]>(
        projectRoot,
        "mobile.inbox.list",
        {},
        15_000
      );
    },
    listReviews(projectRoot: string): Promise<MobileReviewDecision[]> {
      return request<MobileReviewDecision[]>(
        projectRoot,
        "mobile.review.list",
        {},
        15_000
      );
    },
  };
}

const mobileSidecarApi = createMobileSidecarApi(
  <T>(
    projectRoot: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ) => sidecarRequest<T>(
    projectRoot,
    nextSidecarRequestId(),
    method,
    params,
    timeoutMs
  )
);

export async function prepareMobileSnapshot(
  projectRoot: string,
  projectId: string
): Promise<PreparedMobileSnapshot> {
  return mobileSidecarApi.prepareSnapshot(projectRoot, projectId);
}

export async function importMobileOutboxItem(
  projectRoot: string,
  input: {
    envelope: MobileOutboxEnvelopeIdentity;
    payload: Record<string, unknown>;
  }
): Promise<MobileOutboxImportResult> {
  return mobileSidecarApi.importOutboxItem(projectRoot, input);
}

export async function listMobileInboxItems(
  projectRoot: string
): Promise<MobileInboxItem[]> {
  return mobileSidecarApi.listInbox(projectRoot);
}

export async function listMobileReviewDecisions(
  projectRoot: string
): Promise<MobileReviewDecision[]> {
  return mobileSidecarApi.listReviews(projectRoot);
}

export type VoiceContextPrepared = {
  context_pack: Record<string, unknown> & { pack_id: string; channel: string };
  instructions: string;
  tools: Array<Record<string, unknown>>;
  profile: Record<string, unknown>;
};

export async function prepareVoiceContext(
  projectRoot: string,
  payload: {
    threadId: string;
    utterance?: string;
    currentSceneId?: string;
    selectedText?: string;
    sceneIds?: string[];
    codexIds?: string[];
  }
): Promise<VoiceContextPrepared> {
  return sidecarRequest<VoiceContextPrepared>(
    projectRoot,
    nextSidecarRequestId(),
    "voice.context.prepare",
    {
      thread_id: payload.threadId,
      channel: "desktop_voice",
      utterance: payload.utterance ?? "",
      current_scene_id: payload.currentSceneId ?? "",
      selected_text: payload.selectedText ?? "",
      scene_ids: payload.sceneIds ?? [],
      codex_ids: payload.codexIds ?? []
    },
    30_000
  );
}

export async function negotiateVoiceSession(
  projectRoot: string,
  payload: { offerSdp: string; contextPackId: string; model?: string; voice?: string }
): Promise<{ answer_sdp: string; context_pack_id: string; model: string; voice: string }> {
  return sidecarRequest(
    projectRoot,
    nextSidecarRequestId(),
    "voice.session.start",
    {
      offer_sdp: payload.offerSdp,
      context_pack_id: payload.contextPackId,
      model: payload.model ?? "",
      voice: payload.voice ?? ""
    },
    45_000
  );
}

export async function handleVoiceTool(
  projectRoot: string,
  payload: {
    threadId: string;
    callId: string;
    name: string;
    arguments: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  return sidecarRequest(
    projectRoot,
    nextSidecarRequestId(),
    "voice.tool.handle",
    {
      thread_id: payload.threadId,
      channel: "desktop_voice",
      call_id: payload.callId,
      name: payload.name,
      arguments: payload.arguments
    },
    30_000
  );
}

export async function recordVoiceTurn(
  projectRoot: string,
  payload: {
    threadId: string;
    turnId: string;
    voiceSessionId: string;
    userTranscript: string;
    assistantTranscript: string;
    contextPackId: string;
    providerEventId: string;
    model: string;
  }
): Promise<{ turn: AssistantTurnRecord; messages: ChatMessageRecord[] }> {
  return sidecarRequest(
    projectRoot,
    nextSidecarRequestId(),
    "voice.turn.record",
    {
      thread_id: payload.threadId,
      turn_id: payload.turnId,
      voice_session_id: payload.voiceSessionId,
      user_transcript: payload.userTranscript,
      assistant_transcript: payload.assistantTranscript,
      context_pack_id: payload.contextPackId,
      provider_event_id: payload.providerEventId,
      model: payload.model,
      channel: "desktop_voice"
    },
    30_000
  );
}

export async function interruptChatTurn(
  projectRoot: string,
  requestId: string
): Promise<void> {
  await sidecarRequest(
    projectRoot,
    nextSidecarRequestId(),
    "chat.interrupt",
    { request_id: requestId },
    10_000
  );
}

export type ChatTruncateResult = {
  thread_id: string;
  from_message_id: string;
  removed_count: number;
  remaining_count: number;
  removed_ids: string[];
};

export async function truncateChatMessages(
  projectRoot: string,
  payload: {
    threadId: string;
    fromMessageId: string;
  }
): Promise<ChatTruncateResult> {
  try {
    return await sidecarRequest<ChatTruncateResult>(
      projectRoot,
      nextSidecarRequestId(),
      "chat.truncate",
      {
        thread_id: payload.threadId,
        from_message_id: payload.fromMessageId,
      },
      15_000
    );
  } catch (error) {
    if (error instanceof SidecarDomainError) throw error;
    const result = await runCoreCommand(projectRoot, [
      "chat",
      "message",
      "truncate",
      "--thread",
      payload.threadId,
      "--from-message",
      payload.fromMessageId,
      "--json"
    ]);
    return decodeJson<ChatTruncateResult>(result);
  }
}

export async function getChatTurnDiff(
  projectRoot: string,
  payload: {
    threadId: string;
    messageId: string;
  }
): Promise<ChatTurnDiff> {
  const result = await runCoreCommand(projectRoot, [
    "chat",
    "diff",
    "--thread",
    payload.threadId,
    "--message",
    payload.messageId,
    "--json"
  ]);
  return decodeJson<ChatTurnDiff>(result);
}

export async function executeChatToolCall(
  projectRoot: string,
  payload: {
    threadId: string;
    assistantMessageId: string;
    index: number;
  }
): Promise<{
  assistant_message_id: string;
  tool_index: number;
  tool: string;
  result: unknown;
  tool_message: ChatMessageRecord;
}> {
  const result = await runCoreCommand(projectRoot, [
    "chat",
    "tool",
    "execute",
    "--thread",
    payload.threadId,
    "--message",
    payload.assistantMessageId,
    "--index",
    String(payload.index),
    "--json"
  ]);
  return decodeJson<{
    assistant_message_id: string;
    tool_index: number;
    tool: string;
    result: unknown;
    tool_message: ChatMessageRecord;
  }>(result);
}

export async function listCodexEntities(
  projectRoot: string,
  type?: CodexEntity["type"]
): Promise<CodexEntity[]> {
  const args = ["codex", "list"];
  if (type) {
    args.push("--type", type);
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<CodexEntity[]>(result);
}

export async function getCodexEntity(
  projectRoot: string,
  entityId: string
): Promise<CodexEntity> {
  const result = await runCoreCommand(projectRoot, [
    "codex",
    "get",
    "--id",
    entityId,
    "--json"
  ]);
  return decodeJson<CodexEntity>(result);
}

export async function addCodexEntity(
  projectRoot: string,
  payload: {
    type: CodexEntity["type"];
    name: string;
    description: string;
    category?: string;
    aliases?: string[];
    tags?: string[];
    details?: CodexEntity["details"];
    notes?: string;
    aiVisibility?: CodexEntity["ai_visibility"];
    scope?: CodexEntity["scope"];
  }
): Promise<CodexEntity> {
  const args = [
    "codex",
    "add",
    "--type",
    payload.type,
    "--name",
    payload.name,
    "--description",
    payload.description,
    "--category", payload.category ?? "",
    "--details-json", JSON.stringify(payload.details ?? []),
    "--notes", payload.notes ?? "",
    "--ai-visibility", payload.aiVisibility ?? "include",
    "--scope", payload.scope ?? "project",
  ];
  for (const alias of payload.aliases ?? []) args.push("--alias", alias);
  for (const tag of payload.tags ?? []) args.push("--tag", tag);
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<CodexEntity>(result);
}

export async function updateCodexEntity(
  projectRoot: string,
  entityId: string,
  payload: {
    type: CodexEntity["type"];
    name: string;
    description: string;
    category?: string;
    aliases?: string[];
    tags?: string[];
    details?: CodexEntity["details"];
    notes?: string;
    aiVisibility?: CodexEntity["ai_visibility"];
    scope?: CodexEntity["scope"];
  }
): Promise<CodexEntity> {
  const args = [
    "codex",
    "update",
    "--id",
    entityId,
    "--type",
    payload.type,
    "--name",
    payload.name,
    "--description",
    payload.description,
    "--category", payload.category ?? "",
    "--details-json", JSON.stringify(payload.details ?? []),
    "--notes", payload.notes ?? "",
    "--ai-visibility", payload.aiVisibility ?? "include",
    "--scope", payload.scope ?? "project",
  ];
  for (const alias of payload.aliases ?? []) args.push("--alias", alias);
  for (const tag of payload.tags ?? []) args.push("--tag", tag);
  // No flag means "leave unchanged" in the CLI; a blank repeated value means
  // the author intentionally cleared the list after normalization.
  if (payload.aliases?.length === 0) args.push("--alias", "");
  if (payload.tags?.length === 0) args.push("--tag", "");
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<CodexEntity>(result);
}

export async function listCodexRelationships(projectRoot: string, entityId?: string): Promise<CodexRelationship[]> {
  const args = ["codex", "relationship-list"];
  if (entityId) args.push("--entity", entityId);
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function addCodexRelationship(projectRoot: string, payload: { sourceId: string; targetId: string; relation: string; notes?: string; validFrom?: string; validTo?: string }): Promise<CodexRelationship> {
  return decodeJson(await runCoreCommand(projectRoot, [
    "codex", "relationship-add", "--source", payload.sourceId, "--target", payload.targetId,
    "--relation", payload.relation, "--notes", payload.notes ?? "", "--valid-from", payload.validFrom ?? "", "--valid-to", payload.validTo ?? "", "--json"
  ]));
}

export async function deleteCodexRelationship(projectRoot: string, relationshipId: string): Promise<void> {
  await runCoreCommand(projectRoot, ["codex", "relationship-delete", "--id", relationshipId, "--json"]);
}

export type StoryMemorySuggestion = {
  id: string;
  review_version?: string;
  kind: "entity_create" | "canon_fact" | "memory_note" | "relationship_create";
  entity_type?: CodexEntity["type"];
  name: string;
  description: string;
  aliases?: string[];
  confidence: number;
  reason: string;
  status: "pending" | "accepted" | "rejected" | "deferred";
  evidence: Array<CanonEvidence & { path: string }>;
  subject_entity_id?: string;
  subject_name?: string;
  predicate?: string;
  value?: string;
  source_entity_id?: string;
  source_name?: string;
  target_entity_id?: string;
  target_name?: string;
  relation?: string;
  valid_from_scene_id?: string;
  valid_to_scene_id?: string;
  created_relationship_id?: string;
};

export async function scanStoryMemory(projectRoot: string): Promise<{ scanned_scenes: number; added: number; refreshed: number; pending: number; suggestions: StoryMemorySuggestion[] }> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "scan", "--json"]));
}

export async function listStoryMemorySuggestions(projectRoot: string, status: StoryMemorySuggestion["status"] = "pending"): Promise<StoryMemorySuggestion[]> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "list", "--status", status, "--json"]));
}

export async function reviewStoryMemorySuggestion(projectRoot: string, id: string, disposition: "accepted" | "rejected" | "deferred", expectedVersion?: string): Promise<StoryMemorySuggestion> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "review", "--id", id, "--disposition", disposition, ...(expectedVersion !== undefined ? ["--expected-version", expectedVersion] : []), "--json"]));
}

export async function correctStoryMemorySuggestion(
  projectRoot: string,
  id: string,
  updates: { name?: string; description?: string; predicate?: string; value?: string; entity_type?: CodexEntity["type"]; expected_version?: string }
): Promise<StoryMemorySuggestion> {
  const args = ["memory", "correct", "--id", id];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) args.push(`--${key.replace(/_/g, "-")}`, value);
  }
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function queueStoryMemorySuggestion(projectRoot: string, payload: { title: string; content: string; sceneId?: string }): Promise<StoryMemorySuggestion> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "suggest", "--title", payload.title, "--content", payload.content, "--scene", payload.sceneId ?? "", "--source", "assistant", "--json"]));
}

export async function addSceneNote(projectRoot: string, payload: { title: string; content: string; sceneId?: string }): Promise<Record<string, unknown>> {
  return decodeJson(await runCoreCommand(projectRoot, ["plan", "note-add", "--title", payload.title, "--content", payload.content, "--scene", payload.sceneId ?? "", "--source", "assistant", "--json"]));
}

export type ProjectSearchResult = {
  source_kind: "scene" | "memory" | "plan";
  source_id: string;
  title: string;
  path: string;
  excerpt: string;
  score: number;
};

export async function searchProject(projectRoot: string, query: string, limit = 80): Promise<ProjectSearchResult[]> {
  return decodeJson(await runCoreCommand(projectRoot, ["search", "--query", query, "--limit", String(limit), "--json"]));
}

export type EditorialPass = {
  id: string;
  name: string;
  goal: string;
  instruction: string;
  context_policy: { current_scene: boolean; nearby_scenes: number; story_memory: string };
  evaluation_criteria: string[];
  built_in: boolean;
};

export async function listEditorialPasses(projectRoot: string): Promise<EditorialPass[]> {
  return decodeJson(await runCoreCommand(projectRoot, ["pass", "list", "--json"]));
}

export async function addEditorialPass(projectRoot: string, payload: { name: string; goal: string; instruction: string; criteria: string[] }): Promise<EditorialPass> {
  const args = ["pass", "add", "--name", payload.name, "--goal", payload.goal, "--instruction", payload.instruction];
  for (const criterion of payload.criteria) args.push("--criterion", criterion);
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function listCanonFacts(projectRoot: string): Promise<CanonFact[]> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "fact-list", "--for-editing", "--json"]));
}

export type CanonFactChanges = Pick<CanonFact, "predicate" | "value" | "status" | "validity" | "evidence">;

export async function updateCanonFact(projectRoot: string, fact: CanonFact, changes: CanonFactChanges): Promise<CanonFact> {
  if (!fact.edit_version) throw new Error("Reload Canon & Continuity before editing this fact.");
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "fact-update", "--id", fact.id, "--expected-version", fact.edit_version, "--changes-json", JSON.stringify(changes), "--json"]));
}

export async function addCanonFact(projectRoot: string, payload: {
  subjectId: string; predicate: string; value: string; sceneId: string; excerpt: string;
  validFrom?: string; validTo?: string; scope?: "project" | "series";
  knowledge?: CanonFact["knowledge"];
}): Promise<CanonFact> {
  return decodeJson(await runCoreCommand(projectRoot, [
    "memory", "fact-add", "--subject", payload.subjectId, "--predicate", payload.predicate,
    "--value", payload.value, "--evidence-json", JSON.stringify([{ scene_id: payload.sceneId, excerpt: payload.excerpt }]),
    "--knowledge-json", JSON.stringify(payload.knowledge ?? []), "--valid-from", payload.validFrom ?? "",
    "--valid-to", payload.validTo ?? "", "--scope", payload.scope ?? "project", "--json"
  ]));
}

export async function listNarrativeSetups(projectRoot: string): Promise<NarrativeSetup[]> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "setup-list", "--json"]));
}

export async function reviewCanonFact(projectRoot: string, factId: string, payload: {
  disposition: "accepted" | "rejected"; evidence?: CanonEvidence[]; expectedUpdatedAt?: string;
}): Promise<CanonFact> {
  const args = ["memory", "fact-review", "--id", factId, "--disposition", payload.disposition, "--json"];
  if (payload.evidence) args.push("--evidence-json", JSON.stringify(payload.evidence));
  if (payload.expectedUpdatedAt) args.push("--expected-updated-at", payload.expectedUpdatedAt);
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function addNarrativeSetup(projectRoot: string, description: string, sceneId: string, excerpt: string): Promise<NarrativeSetup> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "setup-add", "--description", description, "--scene", sceneId, "--excerpt", excerpt, "--json"]));
}

export async function resolveNarrativeSetup(projectRoot: string, id: string, sceneId: string, excerpt: string): Promise<NarrativeSetup> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "setup-payoff", "--id", id, "--scene", sceneId, "--excerpt", excerpt, "--json"]));
}

export async function listOpenQuestions(projectRoot: string): Promise<OpenQuestion[]> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "question-list", "--json"]));
}

export async function addOpenQuestion(projectRoot: string, question: string, sceneId = "", intentional = false): Promise<OpenQuestion> {
  const args = ["memory", "question-add", "--question", question, "--scene", sceneId];
  if (intentional) args.push("--intentional");
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function listCharacterArcStates(projectRoot: string): Promise<CharacterArcState[]> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "arc-list", "--json"]));
}

export async function addCharacterArcState(projectRoot: string, payload: { characterId: string; dimension: string; value: string; sceneId: string; excerpt: string; stateType: "observed" | "planned" }): Promise<CharacterArcState> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "arc-add", "--character", payload.characterId, "--dimension", payload.dimension, "--value", payload.value, "--scene", payload.sceneId, "--excerpt", payload.excerpt, "--type", payload.stateType, "--json"]));
}

export async function runCanonDiagnostics(projectRoot: string): Promise<{ diagnostics: CanonDiagnostic[]; summary: { errors: number; warnings: number; info: number } }> {
  return decodeJson(await runCoreCommand(projectRoot, ["memory", "diagnose", "--json"]));
}

export async function disposeCanonDiagnostic(projectRoot: string, id: string, disposition: "fixed" | "dismissed" | "intentional" | "deferred", notes = ""): Promise<void> {
  await runCoreCommand(projectRoot, ["memory", "dispose", "--id", id, "--disposition", disposition, "--notes", notes, "--json"]);
}

export type StorylineRecord = {
  id: string;
  name: string;
  branch: string;
  status: "active" | "archived";
  source_branch: string;
  base_revision: string;
  current: boolean;
  branch_available: boolean;
  experiment_brief: { hypothesis: string; protected_constraints: string[]; intended_scope: string; success_criteria: string };
  divergence?: { ahead_by: number; behind_by: number; changed_files: number; changed_scenes: number };
  created_at: string;
  updated_at: string;
  last_activity_at: string;
};
export type StorylineComparison = {
  storyline: StorylineRecord;
  primary_branch: string;
  ahead_by: number;
  behind_by: number;
  categories: { scenes: number; plan: number; story_memory: number; settings: number };
  scenes: Array<{ path: string; scene_id: string; title: string; status: string; word_count_before: number; word_count_after: number; word_count_delta: number; prose_changed: boolean }>;
  word_count_delta: number;
  semantic_delta: Record<"canon_facts" | "setups" | "open_questions" | "arcs", { added: Array<{ id: string; label: string }>; changed: Array<{ id: string; label: string }>; removed: Array<{ id: string; label: string }> }>;
  impact_analysis: {
    before: { hypothesis: string; success_criteria: string; protected_constraints: string[] };
    after: { changed_scene_count: number; semantic_change_count: number; word_count_delta: number; risks: string[]; summary: string };
  };
};

export async function listStorylines(projectRoot: string): Promise<{ primary_branch: string; current_branch: string; storylines: StorylineRecord[] }> {
  return decodeJson(await runCoreCommand(projectRoot, ["storyline", "list", "--json"]));
}

export async function createStoryline(projectRoot: string, payload: { name: string; hypothesis: string; scope?: string; success?: string; protectedConstraints?: string[]; switch?: boolean }): Promise<StorylineRecord> {
  const args = ["storyline", "create", "--name", payload.name, "--hypothesis", payload.hypothesis, "--scope", payload.scope ?? "", "--success", payload.success ?? ""];
  for (const constraint of payload.protectedConstraints ?? []) args.push("--protect", constraint);
  if (payload.switch === false) args.push("--no-switch");
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function switchStoryline(projectRoot: string, id?: string, primary = false): Promise<void> {
  const args = ["storyline", "switch"];
  if (primary) args.push("--primary"); else if (id) args.push("--id", id);
  args.push("--json");
  await runCoreCommand(projectRoot, args);
}

export async function compareStoryline(projectRoot: string, id: string): Promise<StorylineComparison> {
  return decodeJson(await runCoreCommand(projectRoot, ["storyline", "compare", "--id", id, "--json"]));
}

export async function integrateStorylineScenes(projectRoot: string, id: string, scenePaths: string[]): Promise<{ proposal_count: number; proposals: ProposalRecord[] }> {
  const args = ["storyline", "integrate", "--id", id];
  for (const path of scenePaths) args.push("--scene-path", path);
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function saveStoryline(projectRoot: string, id: string): Promise<void> {
  await runCoreCommand(projectRoot, ["storyline", "save", "--id", id, "--json"]);
}

export async function archiveStoryline(projectRoot: string, id: string): Promise<void> {
  await runCoreCommand(projectRoot, ["storyline", "archive", "--id", id, "--json"]);
}

export async function restoreStoryline(projectRoot: string, id: string): Promise<void> {
  await runCoreCommand(projectRoot, ["storyline", "restore", "--id", id, "--json"]);
}

export async function renameStoryline(projectRoot: string, id: string, name: string): Promise<void> {
  await runCoreCommand(projectRoot, ["storyline", "rename", "--id", id, "--name", name, "--json"]);
}

export async function duplicateStoryline(projectRoot: string, id: string, name: string): Promise<void> {
  await runCoreCommand(projectRoot, ["storyline", "duplicate", "--id", id, "--name", name, "--json"]);
}

export type StyleProfile = {
  schema_version: number;
  name: string;
  description: string;
  traits: Record<string, string>;
  avoid: string[];
  version?: string;
  exemplar_scene_ids: string[];
  exemplar_digests?: Record<string, string>;
  observations?: Array<{ scene_id: string; aspect: string; observation: string; excerpt: string }>;
  created_at: string;
  reference_mode?: "current" | "frozen";
  freshness?: "current" | "stale" | "unknown";
  changed_scene_ids?: string[];
  usable_for_ai?: boolean;
  fingerprint?: string;
  source_digests?: Record<string, string>;
  measurement?: { method: string; word_metrics_available: boolean; limitations: string[] };
  metrics: Record<string, any>;
  guidance: string[];
};

export type WritingVoiceWorkspace = {
  profile: StyleProfile | null; scope: string;
  presets: Array<Pick<StyleProfile, "name" | "description" | "traits" | "guidance" | "avoid"> & { id: string }>;
  dimensions: Record<string, { label: string; options: string[] }>;
  criteria: Record<string, string>;
  previews: VoicePreview[];
};
export type VoicePreview = {
  id: string; scene_id: string; source_text: string; provider: string;
  instruction?: string;
  refinement?: { preview_id: string; direction_id: string; candidate: string; feedback: string };
  directions: Array<{
    id: string; profile: StyleProfile; text: string; warnings: string[]; proposal_id?: string;
    measures: { words: number; average_sentence_words: number; dialogue_passages: number };
    observations: Array<{ criterion: string; observation: string; excerpt: string }>;
    author_review: { ratings: Record<string, string>; notes: string };
  }>;
};
export async function getWritingVoiceWorkspace(projectRoot: string): Promise<WritingVoiceWorkspace> {
  return decodeJson(await runCoreCommand(projectRoot, ["style", "workspace", "--json"]));
}
export async function writingVoiceAction<T>(projectRoot: string, action: "save" | "suggest" | "preview" | "refine" | "review" | "stage", request: Record<string, unknown>): Promise<T> {
  return decodeJson(await runCoreCommand(projectRoot, ["style", action, "--request-json", JSON.stringify(request), "--json"]));
}

export async function getStyleProfile(projectRoot: string): Promise<StyleProfile | null> {
  return decodeJson(await runCoreCommand(projectRoot, ["style", "get", "--json"]));
}

export async function buildStyleProfile(projectRoot: string, sceneIds: string[], fingerprint?: string): Promise<StyleProfile> {
  const args = ["style", "build"];
  for (const id of sceneIds) args.push("--scene", id);
  if (fingerprint !== undefined) args.push("--expected-fingerprint", fingerprint);
  args.push("--json");
  return decodeJson(await runCoreCommand(projectRoot, args));
}

export async function setStyleProfileReference(projectRoot: string, mode: "current" | "frozen", fingerprint: string): Promise<StyleProfile> {
  return decodeJson(await runCoreCommand(projectRoot, ["style", "reference", "--mode", mode, "--expected-fingerprint", fingerprint, "--json"]));
}

export async function runContinuityChecks(projectRoot: string): Promise<ContinuityIssue[]> {
  const result = await runCoreCommand(projectRoot, ["check", "continuity", "--json"]);
  return decodeJson<ContinuityIssue[]>(result);
}

export async function runWorkspaceAudit(
  projectRoot: string,
  repair = false
): Promise<WorkspaceAuditReport> {
  const args = ["check", "workspace"];
  if (repair) {
    args.push("--repair");
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<WorkspaceAuditReport>(result);
}

export async function runPerformanceBaseline(
  projectRoot: string,
  repeat = 3
): Promise<PerformanceBaselineReport> {
  const normalizedRepeat = Number.isFinite(repeat) ? Math.max(1, Math.round(repeat)) : 3;
  const result = await runCoreCommand(projectRoot, [
    "check",
    "performance",
    "--repeat",
    String(normalizedRepeat),
    "--json"
  ]);
  return decodeJson<PerformanceBaselineReport>(result);
}

export async function getStartupHealth(
  projectRoot: string,
  repair = false
): Promise<StartupHealthReport> {
  const args = ["check", "startup"];
  if (repair) args.push("--repair");
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<StartupHealthReport>(result);
}

export async function listGenerationRuns(
  projectRoot: string,
  filters?: {
    status?: "succeeded" | "failed";
    quality?: "high" | "medium" | "low";
    sceneId?: string;
    provider?: ProposalProvider;
    limit?: number;
  }
): Promise<GenerationRunSummary[]> {
  const args = ["generation", "list"];
  if (filters?.status) {
    args.push("--status", filters.status);
  }
  if (filters?.sceneId) {
    args.push("--scene", filters.sceneId);
  }
  if (filters?.provider) {
    args.push("--provider", filters.provider);
  }
  if (filters?.quality) {
    args.push("--quality", filters.quality);
  }
  if (typeof filters?.limit === "number") {
    args.push("--limit", String(filters.limit));
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<GenerationRunSummary[]>(result);
}

export async function getGenerationRun(
  projectRoot: string,
  runId: string
): Promise<GenerationRunDetail> {
  const result = await runCoreCommand(projectRoot, [
    "generation",
    "get",
    "--id",
    runId,
    "--json"
  ]);
  return decodeJson<GenerationRunDetail>(result);
}

export async function rerunGeneration(
  projectRoot: string,
  payload: {
    runId: string;
    title?: string;
    provider?: ProposalProvider;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    contextScenes?: number;
    codexLimit?: number;
    retrievalMode?: "off" | "auto" | "required";
    retrievalLimit?: number;
    retrievalMinScore?: number;
    retrievalRequireFresh?: boolean;
  }
): Promise<ProposalRecord> {
  const args = ["generation", "rerun", "--id", payload.runId];
  if (payload.title && payload.title.trim() !== "") {
    args.push("--title", payload.title);
  }
  if (payload.provider) {
    args.push("--provider", payload.provider);
  }
  if (payload.model && payload.model.trim() !== "") {
    args.push("--model", payload.model);
  }
  if (typeof payload.temperature === "number") {
    args.push("--temperature", String(payload.temperature));
  }
  if (typeof payload.maxOutputTokens === "number") {
    args.push("--max-output-tokens", String(payload.maxOutputTokens));
  }
  if (typeof payload.contextScenes === "number") {
    args.push("--context-scenes", String(payload.contextScenes));
  }
  if (typeof payload.codexLimit === "number") {
    args.push("--codex-limit", String(payload.codexLimit));
  }
  if (payload.retrievalMode) {
    args.push("--retrieval-mode", payload.retrievalMode);
  }
  if (typeof payload.retrievalLimit === "number") {
    args.push("--retrieval-limit", String(payload.retrievalLimit));
  }
  if (typeof payload.retrievalMinScore === "number") {
    args.push("--retrieval-min-score", String(payload.retrievalMinScore));
  }
  if (typeof payload.retrievalRequireFresh === "boolean") {
    args.push(payload.retrievalRequireFresh ? "--retrieval-require-fresh" : "--retrieval-allow-stale");
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function getGenerationRuntimeConfig(
  projectRoot: string
): Promise<GenerationRuntimeConfig> {
  const result = await runCoreCommand(projectRoot, ["generation", "config", "--json"]);
  return decodeJson<GenerationRuntimeConfig>(result);
}

export async function getGenerationBudget(
  projectRoot: string
): Promise<GenerationBudgetReport> {
  const result = await runCoreCommand(projectRoot, ["generation", "budget", "--json"]);
  return decodeJson<GenerationBudgetReport>(result);
}

export async function updateGenerationBudget(
  projectRoot: string,
  payload: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxTotalTokens?: number;
    maxEstimatedCostUsd?: number;
    dailyTokens?: number;
    dailyEstimatedCostUsd?: number;
    weeklyTokens?: number;
    weeklyEstimatedCostUsd?: number;
  }
): Promise<GenerationBudgetReport> {
  const args = ["generation", "budget"];
  if (typeof payload.maxInputTokens === "number") {
    args.push("--max-input-tokens", String(payload.maxInputTokens));
  }
  if (typeof payload.maxOutputTokens === "number") {
    args.push("--max-output-tokens", String(payload.maxOutputTokens));
  }
  if (typeof payload.maxTotalTokens === "number") {
    args.push("--max-total-tokens", String(payload.maxTotalTokens));
  }
  if (typeof payload.maxEstimatedCostUsd === "number") {
    args.push("--max-estimated-cost-usd", String(payload.maxEstimatedCostUsd));
  }
  if (typeof payload.dailyTokens === "number") {
    args.push("--daily-tokens", String(payload.dailyTokens));
  }
  if (typeof payload.dailyEstimatedCostUsd === "number") {
    args.push("--daily-estimated-cost-usd", String(payload.dailyEstimatedCostUsd));
  }
  if (typeof payload.weeklyTokens === "number") {
    args.push("--weekly-tokens", String(payload.weeklyTokens));
  }
  if (typeof payload.weeklyEstimatedCostUsd === "number") {
    args.push("--weekly-estimated-cost-usd", String(payload.weeklyEstimatedCostUsd));
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<GenerationBudgetReport>(result);
}

export async function resetGenerationBudget(
  projectRoot: string
): Promise<GenerationBudgetReport> {
  const result = await runCoreCommand(projectRoot, [
    "generation",
    "budget",
    "--reset",
    "--json"
  ]);
  return decodeJson<GenerationBudgetReport>(result);
}

export async function listBranches(projectRoot: string): Promise<BranchSummary[]> {
  const result = await runCoreCommand(projectRoot, ["branch", "list", "--json"]);
  return decodeJson<BranchSummary[]>(result);
}

export async function createBranch(
  projectRoot: string,
  payload: { name: string; fromRef?: string; noSwitch?: boolean }
): Promise<{ name: string; current: boolean; from_ref: string }> {
  const args = ["branch", "create", "--name", payload.name];
  if (payload.fromRef && payload.fromRef.trim() !== "") {
    args.push("--from", payload.fromRef.trim());
  }
  if (payload.noSwitch) {
    args.push("--no-switch");
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<{ name: string; current: boolean; from_ref: string }>(result);
}

export async function switchBranch(
  projectRoot: string,
  branchName: string
): Promise<{ name: string; current: boolean }> {
  const result = await runCoreCommand(projectRoot, [
    "branch",
    "switch",
    "--name",
    branchName,
    "--json"
  ]);
  return decodeJson<{ name: string; current: boolean }>(result);
}

export async function diffBranches(
  projectRoot: string,
  payload: { base: string; head: string }
): Promise<BranchDiffReport> {
  const result = await runCoreCommand(projectRoot, [
    "branch",
    "diff",
    "--base",
    payload.base,
    "--head",
    payload.head,
    "--json"
  ]);
  return decodeJson<BranchDiffReport>(result);
}

export async function preflightMerge(
  projectRoot: string,
  payload: { base: string; head: string }
): Promise<BranchPreflightReport> {
  const result = await runCoreCommand(projectRoot, [
    "branch",
    "preflight",
    "--base",
    payload.base,
    "--head",
    payload.head,
    "--json"
  ]);
  return decodeJson<BranchPreflightReport>(result);
}

export async function mergeBranches(
  projectRoot: string,
  payload: { base: string; head: string; resolutionIds?: string[] }
): Promise<BranchMergeResult> {
  const args = ["branch", "merge", "--base", payload.base, "--head", payload.head];
  for (const id of payload.resolutionIds ?? []) {
    args.push("--resolution", id);
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<BranchMergeResult>(result);
}

export async function scanMergeConflicts(
  projectRoot: string,
  payload: { base: string; head: string }
): Promise<MergeConflictScan> {
  const result = await runCoreCommand(projectRoot, [
    "branch",
    "conflicts",
    "--base",
    payload.base,
    "--head",
    payload.head,
    "--json"
  ]);
  return decodeJson<MergeConflictScan>(result);
}

export async function resolveMergeConflict(
  projectRoot: string,
  payload: {
    base: string;
    head: string;
    path: string;
    requestId?: string;
    provider: ProposalProvider;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    authorization?: RevisionAuthorization;
  }
): Promise<ProposalRecord> {
  const args = [
    "branch",
    "resolve",
    "--base",
    payload.base,
    "--head",
    payload.head,
    "--path",
    payload.path,
    "--provider",
    payload.provider
  ];
  if (payload.requestId) args.push("--request-id", payload.requestId);
  if (payload.authorization) args.push("--memory-approvals", JSON.stringify(payload.authorization.memoryApprovals),
    "--story-approvals", JSON.stringify(payload.authorization.storyApprovals), "--expected-context-fingerprint", payload.authorization.fingerprint);
  if (payload.model && payload.model.trim() !== "") {
    args.push("--model", payload.model);
  }
  if (typeof payload.temperature === "number") {
    args.push("--temperature", String(payload.temperature));
  }
  if (typeof payload.maxOutputTokens === "number") {
    args.push("--max-output-tokens", String(payload.maxOutputTokens));
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function previewMergeResolution(projectRoot: string, input: Parameters<typeof resolveMergeConflict>[1], memoryApprovals: MemoryApproval[], storyApprovals: string[]): Promise<RevisionContextPreview> {
  const payload = { base: input.base, head: input.head, scene_path: input.path, provider: input.provider,
    model: input.model, temperature: input.temperature, max_output_tokens: input.maxOutputTokens,
    memory_approvals: memoryApprovals, story_approvals: storyApprovals };
  return decodeJson(await runCoreCommand(projectRoot, ["branch", "resolve-preview", "--input-json", JSON.stringify(payload), "--json"]));
}

export async function listGenerationPins(
  projectRoot: string,
  sceneId?: string
): Promise<GenerationPin[]> {
  const args = ["generation", "pins"];
  if (sceneId && sceneId.trim() !== "") {
    args.push("--scene", sceneId);
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<GenerationPin[]>(result);
}

export async function pinGenerationRun(
  projectRoot: string,
  payload: { sceneId: string; runId: string }
): Promise<GenerationPin> {
  const result = await runCoreCommand(projectRoot, [
    "generation",
    "pin",
    "--scene",
    payload.sceneId,
    "--run",
    payload.runId,
    "--json"
  ]);
  return decodeJson<GenerationPin>(result);
}

export async function unpinGenerationRun(
  projectRoot: string,
  sceneId: string
): Promise<{ scene_id: string; run_id: string; cleared: boolean }> {
  const result = await runCoreCommand(projectRoot, [
    "generation",
    "unpin",
    "--scene",
    sceneId,
    "--json"
  ]);
  return decodeJson<{ scene_id: string; run_id: string; cleared: boolean }>(result);
}


// ── Auth ──────────────────────────────────────────────────────

export type AuthStatus = Record<string, {
  authenticated: boolean;
  email?: string;
  expires_at?: string;
}>;

export async function authLogin(
  projectRoot: string,
  provider: string
): Promise<{ provider: string; authenticated: boolean; message: string }> {
  const result = await runCoreCommand(projectRoot, [
    "auth", "login", "--provider", provider, "--json"
  ]);
  return decodeJson<{ provider: string; authenticated: boolean; message: string }>(result);
}

export async function authLogout(
  projectRoot: string,
  provider: string
): Promise<{ provider: string; removed: boolean }> {
  const result = await runCoreCommand(projectRoot, [
    "auth", "logout", "--provider", provider, "--json"
  ]);
  return decodeJson<{ provider: string; removed: boolean }>(result);
}

export async function authStatus(
  projectRoot: string,
): Promise<AuthStatus> {
  const result = await runCoreCommand(projectRoot, [
    "auth", "status", "--json"
  ]);
  return decodeJson<AuthStatus>(result);
}
