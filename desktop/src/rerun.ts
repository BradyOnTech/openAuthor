import type { ProposalProvider, GenerationRunDetail } from "./types";

export type RerunDraft = {
  title: string;
  provider: ProposalProvider;
  model: string;
  temperature: string;
  maxOutputTokens: string;
  contextScenes: string;
  codexLimit: string;
  retrievalMode: "off" | "auto" | "required";
  retrievalLimit: string;
  retrievalMinScore: string;
  retrievalRequireFresh: boolean;
};

export type RerunPayload = {
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
};

export const EMPTY_RERUN_DRAFT: RerunDraft = {
  title: "",
  provider: "local",
  model: "",
  temperature: "",
  maxOutputTokens: "",
  contextScenes: "",
  codexLimit: "",
  retrievalMode: "off",
  retrievalLimit: "",
  retrievalMinScore: "",
  retrievalRequireFresh: false
};

function asProposalProvider(value: unknown): ProposalProvider | null {
  if (value === "local" || value === "openai" || value === "anthropic") {
    return value;
  }
  return null;
}

function asRetrievalMode(value: unknown): "off" | "auto" | "required" {
  if (value === "off" || value === "auto" || value === "required") {
    return value;
  }
  return "off";
}

function numberString(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(value);
}

function parseFloatOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseIntOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function draftRerunFromRun(run: GenerationRunDetail): RerunDraft {
  return {
    title: "",
    provider: asProposalProvider(run.provider) ?? "local",
    model: run.model ?? "",
    temperature: numberString(run.temperature),
    maxOutputTokens: numberString(run.max_output_tokens),
    contextScenes: numberString(run.context_scene_radius),
    codexLimit: numberString(run.codex_limit),
    retrievalMode: asRetrievalMode(run.retrieval?.mode),
    retrievalLimit: numberString(run.retrieval?.limit),
    retrievalMinScore: numberString(run.retrieval?.min_score),
    retrievalRequireFresh: Boolean(run.retrieval?.require_fresh)
  };
}

export function buildRerunPayload(runId: string, draft: RerunDraft): RerunPayload {
  const title = draft.title.trim();
  const model = draft.model.trim();
  return {
    runId,
    title: title === "" ? undefined : title,
    provider: draft.provider,
    model: model === "" ? undefined : model,
    temperature: parseFloatOrUndefined(draft.temperature),
    maxOutputTokens: parseIntOrUndefined(draft.maxOutputTokens),
    contextScenes: parseIntOrUndefined(draft.contextScenes),
    codexLimit: parseIntOrUndefined(draft.codexLimit),
    retrievalMode: draft.retrievalMode,
    retrievalLimit: parseIntOrUndefined(draft.retrievalLimit),
    retrievalMinScore: parseFloatOrUndefined(draft.retrievalMinScore),
    retrievalRequireFresh: draft.retrievalRequireFresh
  };
}
