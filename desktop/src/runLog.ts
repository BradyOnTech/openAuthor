import type { GenerationRunDetail } from "./types";

export function formatRunLogJson(run: GenerationRunDetail): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

export function generationRunLogFilename(runId: string): string {
  return `${runId}.json`;
}
