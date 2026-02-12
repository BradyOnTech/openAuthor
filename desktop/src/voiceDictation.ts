export type DictationProposalDraft = {
  sceneId: string;
  title: string;
  instruction: string;
  transcript: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactIsoTimestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace(/:/g, "");
}

export function normalizeDictationTranscript(input: string): string {
  return normalizeWhitespace(input);
}

export function buildDictationProposalDraft(
  sceneId: string,
  transcript: string,
  now = new Date()
): DictationProposalDraft {
  const normalizedSceneId = sceneId.trim();
  const normalizedTranscript = normalizeDictationTranscript(transcript);
  const timestampLabel = compactIsoTimestamp(now);
  const title = `Voice dictation ${normalizedSceneId} ${timestampLabel}`;
  const instruction = [
    "Voice Dictation Transcript:",
    normalizedTranscript,
    "",
    "Requested handling:",
    "- Convert this transcript into a concrete scene revision proposal.",
    "- Preserve voice and intent from the transcript by default.",
    "- Call out continuity risks explicitly."
  ].join("\n");
  return {
    sceneId: normalizedSceneId,
    title,
    instruction,
    transcript: normalizedTranscript
  };
}
