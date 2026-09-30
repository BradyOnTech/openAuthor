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
  word_count?: number;
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

export type StartupHealthReport = {
  checked_at: string;
  project_root: string;
  repair_requested: boolean;
  ready: boolean;
  errors: number;
  warnings: number;
  checks: Array<{
    id: string;
    status: "ok" | "warning" | "error";
    message: string;
    recovery: string;
    repairable: boolean;
    repaired: boolean;
  }>;
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
  source?: "manual" | "ai_generate" | "chat_agent" | "merge_resolution" | string;
  change_group_id?: string;
  proposed_body?: string;
  revision_intent?: {
    goal: string;
    scope: string;
    constraints: string[];
    protected_elements: string[];
  };
  rebase_report?: {
    status: "rebased" | "conflicted";
    carried_hunk_ids: string[];
    conflicts: Array<{ hunk_id: string; reason: string; message: string }>;
  };
  applied_changes?: boolean;
  applied_at?: string;
  pre_apply_snapshot?: string;
  applied_revision?: string;
  applied_scene_digest?: string;
  undone_at?: string;
  undo_revision?: string;
  restored_revision?: string;
  accepted_hunk_ids?: string[];
  rejected_hunk_ids?: string[];
  change_set?: {
    schema_version: number;
    id: string;
    proposal_id: string;
    scene_id: string;
    created_at: string;
    intent: {
      goal: string;
      scope: string;
      constraints: string[];
      protected_elements: string[];
    };
    base_body: string;
    proposed_body: string;
    hunks: Array<{
      id: string;
      order: number;
      kind: "insert" | "delete" | "replace";
      before_start: number;
      before_end: number;
      after_start: number;
      after_end: number;
      before_text: string;
      after_text: string;
      decision: "accepted" | "rejected";
      rationale: string;
      edited_by?: "author" | "ai" | string;
      edited_at?: string;
      regeneration?: Record<string, unknown>;
    }>;
    impact_report: {
      risk: "low" | "medium" | "high" | string;
      affected_scenes: string[];
      affected_story_memory: Array<string | { kind: string; id: string; label: string; reason: string }>;
      warnings: string[];
    };
    provenance: {
      provider?: string;
      model?: string;
      generation_id?: string;
      citations?: unknown[];
    };
  };
  draft?: {
    generation_id: string;
    provider: string;
    model: string;
    temperature: number;
    max_output_tokens: number;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    estimated_cost_usd: number | null;
    changed: boolean;
    log_path: string;
    created_at: string;
  };
  merge?: {
    base_commit?: string;
    head_commit?: string;
    base: string;
    head: string;
    merge_base: string;
    path: string;
    file_content: string;
  };
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

export type RevisionSummary = {
  id: string;
  parent: string;
  created_at: string;
  message: string;
  kind: string;
  file_count: number;
  metadata: Record<string, unknown>;
};

export type RevisionComparison = {
  base_revision: string;
  head_revision: string;
  changed_file_count: number;
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | string;
    before: string;
    after: string;
    diff: string;
  }>;
};

export type RevisionRetrospective = {
  base_revision: string;
  head_revision: string;
  intent: string;
  accepted_hunk_ids: string[];
  changed_scenes: Array<{ path: string; scene_id: string; title: string; status: string; word_count_before: number; word_count_after: number; word_count_delta: number }>;
  word_count_delta: number;
  story_memory_changed: boolean;
  changed_artifact_count: number;
  remaining_goals: Array<{ kind: string; label: string; severity: string }>;
  summary: string;
};

export type ManuscriptPlan = {
  schema_version: number;
  brief: {
    synopsis: string;
    genre: string;
    themes: string[];
    style_guide: string;
    outline: string;
  };
  acts: Array<{
    id: string;
    title: string;
    synopsis: string;
    position: number;
    chapters: Array<{
      id: string;
      title: string;
      synopsis: string;
      position: number;
      scene_ids: string[];
    }>;
  }>;
  unassigned_scene_ids: string[];
  scene_metadata: Record<string, {
    timeline_position: string;
    labels: string[];
  }>;
  beats: Array<{
    id: string;
    scene_id: string;
    summary: string;
    status: string;
    position: number;
    created_at: string;
  }>;
  notes: Array<{
    id: string;
    scene_id: string;
    title: string;
    content: string;
    source: string;
    created_at: string;
  }>;
};

export type PlanMovePreview = {
  scene_id: string;
  from: {
    act_id: string;
    act_title: string;
    chapter_id: string;
    chapter_title: string;
    chapter_position: number;
    narrative_index: number;
  };
  to: {
    act_id: string;
    chapter_id: string;
    chapter_title: string;
    before_scene_id: string;
    position: number;
  };
  crossed_scene_ids: string[];
  warnings: string[];
  summary: string;
};

export type LocalProductDashboard = {
  generated_at: string;
  privacy: {
    content_free: true;
    local_only: true;
    external_telemetry_enabled: false;
    local_signals_enabled: boolean;
    retention_days: number;
  };
  event_count: number;
  active_days: number;
  counts: Record<string, number>;
  activation: {
    scene_created: boolean;
    change_reviewed: boolean;
    change_applied: boolean;
    change_undone: boolean;
    golden_loop_completed: boolean;
  };
  trust: {
    accepted_hunks: number;
    rejected_hunks: number;
    hunk_acceptance_rate: number | null;
    applied_change_sets: number;
    undone_change_sets: number;
    undo_rate: number | null;
    memory_suggestions: Record<string, number>;
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
    history_token_budget?: number;
    agent_auto_read_only: boolean;
    agent_confirm_writes: boolean;
  };
  vcs_branch: string;
  vcs_base_commit: string;
};

export type ChatToolCall = {
  id?: string;
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
    generation_id?: string;
  };
};

export type ChatSendResult = {
  thread: ChatThreadRecord;
  user_message: ChatMessageRecord;
  assistant_message: ChatMessageRecord;
  tool_messages: ChatMessageRecord[];
  pending_tool_calls: ChatToolCall[];
};

export type ChatRetrievalCitation = {
  source_type: "scene" | "codex" | string;
  source_ref: string;
  source_title?: string;
  source_path?: string;
  chunk_id?: string;
  score?: number | null;
  excerpt?: string;
};

export type ChatTurnVcs = {
  branch?: string;
  base_commit?: string;
  before_commit?: string;
  after_commit?: string;
  changed?: boolean;
  snapshot?: string;
};

export type ChatTurnDiffFile = {
  status: string;
  path: string;
  added: number | null;
  deleted: number | null;
};

export type ChatTurnDiff = {
  thread_id: string;
  message_id: string;
  base: string;
  head: string;
  ahead_by: number;
  behind_by: number;
  files: ChatTurnDiffFile[];
};

export type GenerationRunSummary = {
  run_id: string;
  kind?: "proposal" | "chat" | string;
  status: "succeeded" | "failed" | string;
  created_at: string;
  scene_id: string;
  thread_id?: string;
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
      runtime_available: boolean;
      auth_type: string;
      email: string;
      plan_type: string;
      error: string;
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
  category?: string;
  aliases?: string[];
  tags?: string[];
  details?: Array<{
    key: string;
    type: "text" | "number" | "boolean" | "date" | "scene" | "entity" | "list";
    value: unknown;
    ai_visibility: "include" | "exclude" | "ask";
  }>;
  notes?: string;
  ai_visibility?: "include" | "exclude" | "ask";
  scope?: "project" | "series";
  created_at: string;
  updated_at: string;
};

export type CodexRelationship = {
  id: string;
  source_entity_id: string;
  source_name: string;
  target_entity_id: string;
  target_name: string;
  relation: string;
  notes: string;
  valid_from_scene_id: string;
  valid_to_scene_id: string;
  created_at: string;
};

export type CanonEvidence = { scene_id: string; excerpt: string; start: number; end: number; attribution?: string; anchor_text?: string; source_field?: "pov" };
export type CanonFact = {
  id: string;
  subject_entity_id: string;
  predicate: string;
  value: string;
  status: "accepted" | "suggested" | "rejected";
  confidence: number;
  evidence: CanonEvidence[];
  validity: { from_scene_id: string; to_scene_id: string };
  knowledge: Array<{ character_entity_id: string; state: "knows" | "believes" | "does_not_know"; from_scene_id: string }>;
  scope: "project" | "series";
};
export type NarrativeSetup = {
  id: string;
  description: string;
  status: "open" | "paid_off";
  setup_evidence: CanonEvidence;
  payoff_evidence: CanonEvidence | null;
};
export type OpenQuestion = { id: string; question: string; scene_id: string; status: "open" | "intentionally_unresolved" | "answered"; answer: string };
export type CharacterArcState = { id: string; character_entity_id: string; dimension: string; value: string; scene_id: string; state_type: "observed" | "planned"; evidence: CanonEvidence; created_at: string; updated_at: string };
export type CanonDiagnostic = {
  id: string;
  code: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  fact_ids: string[];
  scene_ids: string[];
  evidence: CanonEvidence[];
  disposition?: { disposition: "fixed" | "dismissed" | "intentional" | "deferred"; notes: string };
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
  resolved_paths?: string[];
  applied_resolutions?: string[];
};

export type MergeConflict = {
  path: string;
  category: "scene" | "codex" | "project" | "budget" | "other" | string;
  kind: "content" | "delete_modify" | string;
  conflict_count: number;
  ours_text: string | null;
  theirs_text: string | null;
  ancestor_text: string;
  merged_with_markers?: string;
};

export type MergeConflictScan = {
  base: string;
  head: string;
  merge_base: string;
  overlap_count: number;
  auto_mergeable: string[];
  conflicts: MergeConflict[];
  conflict_count: number;
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
