export type CoreCommandResponse = {
  status: number;
  stdout: string;
  stderr: string;
};

export type ProposalProvider = "local" | "openai" | "anthropic" | "openrouter" | "openai-codex";

export type ProjectStatus = {
  found: boolean;
  project_root: string;
};

export type ProjectIdentity = {
  project_id: string;
  name: string;
  created_at: string;
  project_root: string;
  config_path?: string;
  storage?: Record<string, unknown>;
};

export type InitProjectResult = ProjectIdentity & {
  initialized: boolean;
  import_summary?: {
    mode: "project" | "scaffold";
    archive_path?: string;
    source_path?: string;
    source_root: string;
    project_id: string;
    imported: {
      manuscript: boolean;
      codex_sqlite: boolean;
      codex_snapshot: boolean;
      project_marker: boolean;
      codex_folder?: boolean;
      codex_folder_entities?: number;
    };
  } | null;
};

export type WorkspaceRole = "owner" | "editor" | "viewer";
export type ProjectStatusValue = "active" | "archived";
export type ProjectKind = "book";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  kind: ProjectKind;
  status: ProjectStatusValue;
  settings: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMember = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};

export type ProjectActivityEvent = {
  id: string;
  projectId: string;
  actorUserId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceUserState = {
  workspaceId: string;
  userId: string;
  activeProjectId: string;
  recentProjectIds: string[];
  updatedAt: string;
};

export type DesktopProjectBinding = {
  projectId: string;
  localPath: string;
  machineId: string;
  lastVerifiedAt: string;
};

export type SceneSummary = {
  id: string;
  title: string;
  summary: string;
  pov: string;
  status: string;
  created_at: string;
  updated_at: string;
  path: string;
};

export type SceneDetail = {
  id: string;
  title: string;
  summary: string;
  pov: string;
  status: string;
  created_at: string;
  updated_at: string;
  path: string;
  body: string;
};

export type ProposalRecord = {
  id: string;
  title: string;
  instruction: string;
  scene_id: string;
  scene_digest?: string;
  vcs_branch?: string;
  vcs_base_commit?: string;
  stale?: boolean;
  status: "pending" | "applied" | "rejected";
  created_at: string;
  updated_at: string;
  notes: string;
  source?: "manual" | "ai_generate" | "chat_agent" | string;
  generation?: {
    id: string;
    provider: ProposalProvider;
    model: string;
    temperature: number;
    max_output_tokens: number;
    context_scene_radius: number;
    codex_limit: number;
    retrieval?: {
      mode: "off" | "auto" | "required" | string;
      used: boolean;
      query: string;
      limit: number;
      min_score: number;
      require_fresh: boolean;
      result_count: number;
      citations: Array<{
        source_type: string;
        source_ref: string;
        source_path: string;
        source_title: string;
        chunk_id: string;
        chunk_position: number;
        score: number | null;
        coverage: number | null;
        matched_terms: string[];
        excerpt: string;
      }>;
      index: {
        path: string;
        stale: boolean;
        stale_reasons: string[];
        chunk_count: number;
        source_count: number;
        git_head: string;
        indexed_git_head: string;
      };
      degraded: boolean;
      error: string;
    };
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    provider_attempts: number;
    estimated_cost_usd: number | null;
    quality_score?: number | null;
    quality_tier?: "high" | "medium" | "low" | string;
    quality_flags?: string[];
    log_path: string;
  };
};

export type ChatThreadRecord = {
  id: string;
  title: string;
  provider: ProposalProvider;
  model: string;
  mode: "chat" | "agent";
  created_at: string;
  updated_at: string;
  context_profile: {
    include_current_scene: boolean;
    include_selection: boolean;
    include_recent_scenes_radius: number;
    include_codex: "off" | "explicit" | "auto" | "auto_and_explicit";
    retrieval_mode: "off" | "auto" | "required";
    retrieval_limit: number;
    retrieval_min_score: number;
    retrieval_require_fresh: boolean;
    agent_auto_read_only: boolean;
    agent_confirm_writes: boolean;
  };
  vcs_branch: string;
  vcs_base_commit: string;
};

export type ChatToolCall = {
  tool: string;
  args: Record<string, unknown>;
  classification: "read" | "write" | "risky" | string;
  executed: boolean;
  result_summary?: string;
  error?: string;
};

export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant" | "tool";
  created_at: string;
  content: string;
  context_used: Record<string, unknown>;
  tool_calls: ChatToolCall[];
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    latency_ms?: number;
    provider_attempts?: number;
    estimated_cost_usd?: number | null;
    provider?: ProposalProvider | string;
    model?: string;
  };
};

export type ChatSendResult = {
  thread: ChatThreadRecord;
  user_message: ChatMessageRecord;
  assistant_message: ChatMessageRecord;
  tool_messages: ChatMessageRecord[];
  pending_tool_calls: ChatToolCall[];
};

export type GenerationRunSummary = {
  run_id: string;
  status: "succeeded" | "failed" | string;
  created_at: string;
  scene_id: string;
  provider: ProposalProvider | string;
  model: string;
  proposal_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  provider_attempts: number | null;
  estimated_cost_usd: number | null;
  error_category: string;
  error_retriable: boolean | null;
  normalization_changed: boolean | null;
  missing_sections_filled: string[];
  quality_score: number | null;
  quality_tier: "high" | "medium" | "low" | string | null;
  quality_flags: string[];
  retrieval_mode?: "off" | "auto" | "required" | string;
  retrieval_used?: boolean;
  retrieval_result_count?: number;
  preferred_for_scene?: boolean;
  log_path: string;
};

export type GenerationRunDetail = {
  run_id: string;
  status: "succeeded" | "failed" | string;
  created_at: string;
  scene_id: string;
  provider: ProposalProvider | string;
  model: string;
  temperature?: number;
  max_output_tokens?: number;
  context_scene_radius?: number;
  codex_limit?: number;
  instruction: string;
  prompt_sha256: string;
  system_prompt: string;
  user_prompt: string;
  context: Record<string, unknown>;
  proposal_id?: string;
  raw_response_text?: string;
  normalized_instruction?: string;
  normalization?: {
    schema_version?: number;
    raw_nonempty_line_count?: number;
    preamble_line_count?: number;
    detected_headers?: string[];
    missing_sections_filled?: string[];
    normalization_changed?: boolean;
    section_item_counts?: Record<string, number>;
  };
  quality?: {
    score?: number;
    tier?: "high" | "medium" | "low" | string;
    flags?: string[];
  };
  retrieval?: {
    mode?: "off" | "auto" | "required" | string;
    used?: boolean;
    query?: string;
    limit?: number;
    min_score?: number;
    require_fresh?: boolean;
    result_count?: number;
    citations?: Array<{
      source_type?: string;
      source_ref?: string;
      source_path?: string;
      source_title?: string;
      chunk_id?: string;
      chunk_position?: number;
      score?: number | null;
      coverage?: number | null;
      matched_terms?: string[];
      excerpt?: string;
    }>;
    index?: {
      path?: string;
      stale?: boolean;
      stale_reasons?: string[];
      chunk_count?: number;
      source_count?: number;
      git_head?: string;
      indexed_git_head?: string;
    };
    degraded?: boolean;
    error?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    latency_ms?: number;
    provider_attempts?: number;
    estimated_cost_usd?: number | null;
  };
  error?: {
    message?: string;
    category?: string;
    retriable?: boolean;
    http_status?: number | null;
    attempts?: number;
    provider?: string;
  };
  preferred_for_scene?: boolean;
  log_path: string;
};

export type GenerationPin = {
  scene_id: string;
  run_id: string;
};

export type GenerationRuntimeConfig = {
  retry: {
    max_retries: number;
    base_delay_ms: number;
  };
  providers: {
    local: {
      default_model: string;
      credential_present: boolean;
    };
    openai: {
      default_model: string;
      credential_present: boolean;
      base_url: string;
    };
    anthropic: {
      default_model: string;
      credential_present: boolean;
      base_url: string;
    };
    openrouter: {
      default_model: string;
      credential_present: boolean;
      base_url: string;
    };
    "openai-codex": {
      default_model: string;
      credential_present: boolean;
      auth_type: string;
    };
  };
  budget?: GenerationBudgetReport;
};

export type GenerationBudgetPolicy = {
  schema_version: number;
  enforcement: "fail_closed" | string;
  per_run: {
    max_input_tokens: number | null;
    max_output_tokens: number | null;
    max_total_tokens: number | null;
    max_estimated_cost_usd: number | null;
  };
  rolling: {
    daily_tokens: number | null;
    daily_estimated_cost_usd: number | null;
    weekly_tokens: number | null;
    weekly_estimated_cost_usd: number | null;
  };
};

export type GenerationBudgetUsageWindow = {
  runs: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  unknown_cost_runs: number;
  since?: string;
};

export type GenerationBudgetReport = {
  policy: GenerationBudgetPolicy;
  usage: {
    as_of: string;
    daily: GenerationBudgetUsageWindow;
    weekly: GenerationBudgetUsageWindow;
    lifetime: GenerationBudgetUsageWindow;
  };
};

export type CodexEntity = {
  id: string;
  type: "character" | "location" | "lore" | "item" | "faction" | "event";
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type ContinuityIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  title: string;
  message: string;
  scene_id: string;
  path: string;
};

export type BranchSummary = {
  name: string;
  current: boolean;
  upstream: string;
};

export type BranchDiffFile = {
  status: string;
  path: string;
  added: number | null;
  deleted: number | null;
};

export type BranchDiffReport = {
  base: string;
  head: string;
  ahead_by: number;
  behind_by: number;
  files: BranchDiffFile[];
};

export type BranchPreflightReport = {
  base: string;
  head: string;
  merge_base: string;
  base_changed_count: number;
  head_changed_count: number;
  overlap_count: number;
  overlap_by_category: Record<string, string[]>;
  safe_to_merge: boolean;
  risk_level: "low" | "medium" | "high" | string;
  recommendations: string[];
};

export type BranchMergeResult = {
  base: string;
  head: string;
  merged: boolean;
  merge_commit: string;
  current_branch: string;
  merge_output: string;
};

export type WorkspaceAuditIssue = {
  code: string;
  severity: "warning" | "error" | "info" | string;
  message: string;
  recovery: string;
};

export type WorkspacePinIssue = {
  scene_id: string;
  run_id: string;
  code: string;
  detail: string;
};

export type WorkspaceAuditReport = {
  checked_at: string;
  repair_requested: boolean;
  repair_applied: boolean;
  ok: boolean;
  branch: {
    current_branch?: string;
    detached_head?: boolean;
    local_branch_count?: number;
    current_marked_count?: number;
    known_current_branch?: boolean;
    drift_detected?: boolean;
    drift_reasons?: string[];
    recommendations?: string[];
    error?: string;
  };
  retrieval: {
    present?: boolean;
    stale?: boolean;
    stale_reasons?: string[];
    schema_version?: number;
    chunk_count?: number;
    source_count?: number;
    error?: string;
  };
  generation_pins: {
    total: number;
    valid: number;
    stale: number;
    repair_applied: boolean;
    repaired_count: number;
    issues: WorkspacePinIssue[];
    error?: string;
    repair_note?: string;
  };
  issues: WorkspaceAuditIssue[];
  recovery_actions: string[];
};

export type PerformanceBaselineMetric = {
  name: string;
  samples_ms: number[];
  min_ms: number;
  avg_ms: number;
  max_ms: number;
};

export type PerformanceBaselineReport = {
  checked_at: string;
  repeat: number;
  counts: {
    scenes: number;
    proposals: number;
    generation_runs: number;
  };
  metrics: PerformanceBaselineMetric[];
  retrieval?: {
    present?: boolean;
    stale?: boolean;
    chunk_count?: number;
    source_count?: number;
  };
};
