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
  CoreCommandResponse,
  GenerationBudgetReport,
  GenerationPin,
  GenerationRunDetail,
  GenerationRuntimeConfig,
  GenerationRunSummary,
  InitProjectResult,
  PerformanceBaselineReport,
  ProposalProvider,
  ProposalRecord,
  ProjectIdentity,
  ProjectStatus,
  SceneDetail,
  SceneSummary,
  WorkspaceAuditReport
} from "./types";

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
  "auth"
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

export async function runCoreCommand(
  projectRoot: string,
  args: string[]
): Promise<CoreCommandResponse> {
  ensureAllowed(args);
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
): Promise<void> {
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
    payload.body
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Unable to add scene.");
  }
}

export async function updateScene(
  projectRoot: string,
  sceneId: string,
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
    "update",
    "--id",
    sceneId,
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

export async function generateProposal(
  projectRoot: string,
  payload: {
    sceneId: string;
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
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ProposalRecord>(result);
}

export async function applyProposal(
  projectRoot: string,
  proposalId: string,
  notes = ""
): Promise<ProposalRecord> {
  const result = await runCoreCommand(projectRoot, [
    "proposal",
    "apply",
    "--id",
    proposalId,
    "--notes",
    notes,
    "--json"
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

export async function listChatThreads(projectRoot: string): Promise<ChatThreadRecord[]> {
  const result = await runCoreCommand(projectRoot, ["chat", "thread", "list", "--json"]);
  return decodeJson<ChatThreadRecord[]>(result);
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
  const args = ["chat", "message", "list", "--thread", payload.threadId];
  if (typeof payload.limit === "number") {
    args.push("--limit", String(payload.limit));
  }
  args.push("--json");
  const result = await runCoreCommand(projectRoot, args);
  return decodeJson<ChatMessageRecord[]>(result);
}

export type ChatSendPayload = {
  threadId: string;
  message: string;
  currentSceneId?: string;
  sceneIds?: string[];
  selectedText?: string;
  codexIds?: string[];
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
};

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
    const category = frame.error.category ? ` [${frame.error.category}]` : "";
    throw new Error(`${frame.error.message ?? "Sidecar request failed."}${category}`);
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
  return {
    thread_id: payload.threadId,
    message: payload.message,
    current_scene_id: payload.currentSceneId ?? "",
    scene_ids: (payload.sceneIds ?? []).filter((item) => item.trim() !== ""),
    selected_text: payload.selectedText ?? "",
    codex_ids: (payload.codexIds ?? []).filter((item) => item.trim() !== ""),
    context_overrides: Object.keys(contextOverrides).length > 0 ? contextOverrides : null,
  };
}

export async function sendChatMessageStreamed(
  projectRoot: string,
  payload: ChatSendPayload,
  handlers: {
    onDelta: (text: string) => void;
    onStart?: (requestId: string) => void;
  }
): Promise<ChatSendResult> {
  const requestId = nextSidecarRequestId();
  handlers.onStart?.(requestId);
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<SidecarEventEnvelope>(SIDECAR_EVENT_CHANNEL, (event) => {
    const frame = event.payload.frame;
    if (frame.event !== "chat.delta" || !frame.payload) return;
    if (frame.payload.request_id !== requestId) return;
    handlers.onDelta(String(frame.payload.text ?? ""));
  });
  try {
    return await sidecarRequest<ChatSendResult>(
      projectRoot,
      requestId,
      "chat.send",
      chatSendParams(payload)
    );
  } finally {
    unlisten();
  }
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
  }
): Promise<CodexEntity> {
  const result = await runCoreCommand(projectRoot, [
    "codex",
    "add",
    "--type",
    payload.type,
    "--name",
    payload.name,
    "--description",
    payload.description,
    "--json"
  ]);
  return decodeJson<CodexEntity>(result);
}

export async function updateCodexEntity(
  projectRoot: string,
  entityId: string,
  payload: {
    type: CodexEntity["type"];
    name: string;
    description: string;
  }
): Promise<CodexEntity> {
  const result = await runCoreCommand(projectRoot, [
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
    "--json"
  ]);
  return decodeJson<CodexEntity>(result);
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
  payload: { base: string; head: string }
): Promise<BranchMergeResult> {
  const result = await runCoreCommand(projectRoot, [
    "branch",
    "merge",
    "--base",
    payload.base,
    "--head",
    payload.head,
    "--json"
  ]);
  return decodeJson<BranchMergeResult>(result);
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
