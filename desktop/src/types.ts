export type CoreCommandResponse = {
  status: number;
  stdout: string;
  stderr: string;
};

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
    provider: string;
    model: string;
    temperature: number;
    max_output_tokens: number;
    context_scene_radius: number;
    codex_limit: number;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    estimated_cost_usd: number | null;
    log_path: string;
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
