import type {
  BranchDiffReport,
  BranchMergeResult,
  BranchPreflightReport,
  BranchSummary,
  CodexEntity,
  ContinuityIssue,
  CoreCommandResponse,
  GenerationBudgetReport,
  GenerationPin,
  GenerationRunDetail,
  GenerationRuntimeConfig,
  GenerationRunSummary,
  ProposalProvider,
  ProposalRecord,
  ProjectStatus,
  SceneDetail,
  SceneSummary
} from "./types";

const ALLOWED = new Set([
  "init",
  "scene",
  "codex",
  "proposal",
  "snapshot",
  "branch",
  "check",
  "retrieval",
  "generation"
]);

function ensureAllowed(args: string[]): void {
  if (args.length === 0) {
    throw new Error("No core command supplied.");
  }
  if (!ALLOWED.has(args[0])) {
    throw new Error(`Unsupported command prefix: ${args[0]}`);
  }
}

export async function getProjectStatus(projectRoot: string): Promise<ProjectStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectStatus>("project_status", { projectRoot });
}

export async function runCoreCommand(
  projectRoot: string,
  args: string[]
): Promise<CoreCommandResponse> {
  ensureAllowed(args);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CoreCommandResponse>("core_command", { projectRoot, args });
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
