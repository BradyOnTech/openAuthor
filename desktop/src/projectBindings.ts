import type { DesktopProjectBinding } from "./types";

const BINDINGS_STORAGE_KEY = "openauthor.projectBindings";
const MACHINE_ID_STORAGE_KEY = "openauthor.machineId";

type BindingMap = Record<string, DesktopProjectBinding>;

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `machine-${Math.random().toString(36).slice(2, 12)}`;
}

export function getMachineId(storage = getStorage()): string {
  if (!storage) return "machine-web";
  const existing = storage.getItem(MACHINE_ID_STORAGE_KEY);
  if (existing && existing.trim() !== "") {
    return existing;
  }
  const created = randomId();
  storage.setItem(MACHINE_ID_STORAGE_KEY, created);
  return created;
}

function normalizeBinding(raw: unknown): DesktopProjectBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<DesktopProjectBinding>;
  if (
    typeof row.projectId !== "string" ||
    typeof row.localPath !== "string" ||
    typeof row.machineId !== "string" ||
    typeof row.lastVerifiedAt !== "string"
  ) {
    return null;
  }
  if (!row.projectId.trim() || !row.localPath.trim()) return null;
  return {
    projectId: row.projectId.trim(),
    localPath: row.localPath.trim(),
    machineId: row.machineId.trim(),
    lastVerifiedAt: row.lastVerifiedAt.trim(),
  };
}

export function loadProjectBindings(storage = getStorage()): BindingMap {
  if (!storage) return {};
  const raw = storage.getItem(BINDINGS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const decoded = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(decoded)
      .map(([key, value]) => {
        const normalized = normalizeBinding(value);
        if (!normalized) return null;
        return [key, normalized] as const;
      })
      .filter((row): row is readonly [string, DesktopProjectBinding] => row !== null);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function saveProjectBindings(bindings: BindingMap, storage = getStorage()): void {
  if (!storage) return;
  storage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}

export function setProjectBinding(
  projectId: string,
  localPath: string,
  storage = getStorage()
): DesktopProjectBinding {
  const trimmedProjectId = projectId.trim();
  const trimmedPath = localPath.trim();
  const binding: DesktopProjectBinding = {
    projectId: trimmedProjectId,
    localPath: trimmedPath,
    machineId: getMachineId(storage),
    lastVerifiedAt: new Date().toISOString(),
  };
  const next = loadProjectBindings(storage);
  next[trimmedProjectId] = binding;
  saveProjectBindings(next, storage);
  return binding;
}

export function getProjectBinding(
  projectId: string,
  storage = getStorage()
): DesktopProjectBinding | null {
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) return null;
  const bindings = loadProjectBindings(storage);
  return bindings[trimmedProjectId] ?? null;
}

export function removeProjectBinding(projectId: string, storage = getStorage()): void {
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) return;
  const next = loadProjectBindings(storage);
  delete next[trimmedProjectId];
  saveProjectBindings(next, storage);
}
