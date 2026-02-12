import { describeVoiceIntent, type VoiceIntent } from "./voice";

export type VoiceCommandSource = "stt" | "manual";
export type VoiceCommandStatus = "executed" | "rejected" | "failed" | "ignored";

export type VoiceCommandLogEntry = {
  id: string;
  timestamp: string;
  projectRoot: string;
  source: VoiceCommandSource;
  transcript: string;
  normalized: string;
  confidence: number;
  status: VoiceCommandStatus;
  intentKind: string;
  intentLabel: string;
  detail: string;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const MAX_VOICE_LOG_ROWS = 200;

function getStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(projectRoot: string): string {
  const normalized = projectRoot.trim() || "__no_project__";
  return `openauthor.voice.log.v1::${normalized}`;
}

function readRows(storage: StorageLike, key: string): VoiceCommandLogEntry[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is VoiceCommandLogEntry => {
      return Boolean(
        row &&
          typeof row.id === "string" &&
          typeof row.timestamp === "string" &&
          typeof row.projectRoot === "string" &&
          typeof row.source === "string" &&
          typeof row.transcript === "string" &&
          typeof row.normalized === "string" &&
          typeof row.confidence === "number" &&
          typeof row.status === "string" &&
          typeof row.intentKind === "string" &&
          typeof row.intentLabel === "string" &&
          typeof row.detail === "string"
      );
    });
  } catch {
    return [];
  }
}

export function listVoiceCommandLog(
  projectRoot: string,
  limit = 40,
  storage = getStorage()
): VoiceCommandLogEntry[] {
  if (!storage) return [];
  const key = storageKey(projectRoot);
  const rows = readRows(storage, key);
  const normalizedLimit = Math.max(1, limit);
  return rows.slice(0, normalizedLimit);
}

export function appendVoiceCommandLog(
  projectRoot: string,
  row: {
    source: VoiceCommandSource;
    transcript: string;
    normalized: string;
    confidence: number;
    status: VoiceCommandStatus;
    intent: VoiceIntent | null;
    detail: string;
  },
  storage = getStorage()
): VoiceCommandLogEntry | null {
  if (!storage) return null;
  const key = storageKey(projectRoot);
  const now = new Date().toISOString();
  const entry: VoiceCommandLogEntry = {
    id: `voice-${Math.random().toString(16).slice(2, 10)}`,
    timestamp: now,
    projectRoot: projectRoot.trim(),
    source: row.source,
    transcript: row.transcript,
    normalized: row.normalized,
    confidence: Number.isFinite(row.confidence) ? row.confidence : 0,
    status: row.status,
    intentKind: row.intent ? row.intent.kind : "none",
    intentLabel: row.intent ? describeVoiceIntent(row.intent) : "unmatched",
    detail: row.detail
  };
  const rows = readRows(storage, key);
  const nextRows = [entry, ...rows].slice(0, MAX_VOICE_LOG_ROWS);
  storage.setItem(key, JSON.stringify(nextRows));
  return entry;
}

export function clearVoiceCommandLog(projectRoot: string, storage = getStorage()): void {
  if (!storage) return;
  storage.setItem(storageKey(projectRoot), "[]");
}
