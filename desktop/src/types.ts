export type CoreCommandResponse = {
  status: number;
  stdout: string;
  stderr: string;
};

export type ProposalProvider = "local" | "openai" | "anthropic";

export type ProjectStatus = {
  found: boolean;
  project_root: string;
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
  status: "pending" | "applied" | "rejected";
  created_at: string;
  updated_at: string;
  notes: string;
  source?: "manual" | "ai_generate";
  generation?: {
    id: string;
    provider: ProposalProvider;
    model: string;
    temperature: number;
    max_output_tokens: number;
    context_scene_radius: number;
    codex_limit: number;
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
