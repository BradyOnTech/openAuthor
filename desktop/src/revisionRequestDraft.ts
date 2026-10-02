import type { ProposalProvider } from "./types";

export type RevisionRequestDraft = {
  sceneId: string; instruction: string; provider: ProposalProvider; model: string;
  constraints: string; protectedElements: string; selectedPassId: string;
  showPassBuilder: boolean; passName: string; passGoal: string; passInstruction: string; passCriteria: string;
  alternativeCount: 1 | 3; coordinated: boolean; coordinatedSceneIds: string[];
};

export function emptyRevisionRequest(sceneId: string, provider: ProposalProvider): RevisionRequestDraft {
  return { sceneId, provider, instruction: "", model: "", constraints: "", protectedElements: "", selectedPassId: "",
    showPassBuilder: false, passName: "", passGoal: "", passInstruction: "", passCriteria: "",
    alternativeCount: 1, coordinated: false, coordinatedSceneIds: sceneId ? [sceneId] : [] };
}

export function validRevisionRequest(value: unknown): value is RevisionRequestDraft {
  if (!value || typeof value !== "object") return false;
  const row = value as RevisionRequestDraft;
  return [row.sceneId, row.instruction, row.model, row.constraints, row.protectedElements, row.selectedPassId,
    row.passName, row.passGoal, row.passInstruction, row.passCriteria].every(item => typeof item === "string")
    && ["local", "openai", "anthropic", "openrouter", "openai-codex"].includes(row.provider)
    && typeof row.showPassBuilder === "boolean" && typeof row.coordinated === "boolean"
    && [1, 3].includes(row.alternativeCount) && Array.isArray(row.coordinatedSceneIds)
    && row.coordinatedSceneIds.every(id => typeof id === "string");
}
