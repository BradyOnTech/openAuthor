import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { flushProjectSceneSaves } from "../sceneSaveSession";
import {
  getProjectStatus,
  listScenes,
  listCodexEntities,
  listProposals,
  listGenerationRuns,
  runContinuityChecks as apiRunContinuityChecks,
  listBranches as apiListBranches,
  getGenerationBudget as apiGetBudget,
  getGenerationRuntimeConfig as apiGetRuntimeConfig,
  listChatThreads as apiListChatThreads,
  listChatMessages as apiListChatMessages,
  projectEnsureId,
  projectInspect,
  initializeLocalProject,
  importManuscript,
  type ImportCorrections,
  getStartupHealth,
} from "../api";
import { getProjectBinding, setProjectBinding } from "../projectBindings";
import { createProjectRegistryClient } from "../projectRegistry";
import type {
  SceneSummary,
  CodexEntity,
  ProposalRecord,
  GenerationRunSummary,
  ContinuityIssue,
  BranchSummary,
  GenerationBudgetReport,
  GenerationRuntimeConfig,
  ChatThreadRecord,
  ChatMessageRecord,
  Project,
  ProjectActivityEvent,
  InitProjectResult,
  Workspace,
  WorkspaceMember,
  StartupHealthReport,
} from "../types";

type WorkspaceState = {
  activeWorkspaceId: string;
  setActiveWorkspaceId: (workspaceId: string) => void;
  activeProjectId: string;
  openProject: (projectId: string) => Promise<void>;
  createAndOpenProject: (params: {
    name: string;
    savePath: string;
    importSource?: {
      kind: "manuscript_file" | "manuscript_folder";
      path: string;
      strategy: "auto" | "files" | "headings" | "single";
      corrections: ImportCorrections;
      expectedFingerprint: string;
    };
  }) => Promise<boolean>;
  closeProject: () => void;

  workspaces: Workspace[];
  projects: Project[];
  members: WorkspaceMember[];
  projectActivity: ProjectActivityEvent[];

  refreshRegistry: () => Promise<void>;
  refreshProjectActivity: () => Promise<void>;
  createProjectRecord: (name: string) => Promise<Project | null>;
  renameProjectRecord: (projectId: string, name: string) => Promise<void>;
  archiveProjectRecord: (projectId: string) => Promise<void>;
  restoreProjectRecord: (projectId: string) => Promise<void>;
  moveProjectRecord: (projectId: string, workspaceId: string) => Promise<void>;
  copyProjectRecord: (projectId: string, workspaceId?: string) => Promise<void>;
  setMemberRole: (userId: string, role: "owner" | "editor" | "viewer") => Promise<void>;

  projectRoot: string;
  setProjectRoot: (root: string) => void;
  attachProjectRoot: (root: string) => Promise<boolean>;
  createLocalProjectScaffold: (
    root: string,
    name?: string,
    projectId?: string
  ) => Promise<boolean>;
  importProjectArchive: (
    archivePath: string,
    root: string,
    name?: string,
    projectId?: string
  ) => Promise<boolean>;
  importProjectFolder: (
    sourcePath: string,
    root: string,
    name?: string,
    projectId?: string
  ) => Promise<boolean>;
  projectFound: boolean | null;
  startupHealth: StartupHealthReport | null;
  refreshStartupHealth: (repair?: boolean) => Promise<void>;

  scenes: SceneSummary[];
  refreshScenes: () => Promise<void>;

  codexEntities: CodexEntity[];
  refreshCodex: () => Promise<void>;

  proposals: ProposalRecord[];
  refreshProposals: () => Promise<void>;

  runs: GenerationRunSummary[];
  refreshRuns: () => Promise<void>;

  continuityIssues: ContinuityIssue[];
  checksCompleted: boolean;
  runChecks: () => Promise<void>;

  branches: BranchSummary[];
  refreshBranches: () => Promise<void>;

  budget: GenerationBudgetReport | null;
  refreshBudget: () => Promise<void>;

  runtimeConfig: GenerationRuntimeConfig | null;
  refreshRuntimeConfig: () => Promise<void>;

  chatThreads: ChatThreadRecord[];
  refreshChatThreads: () => Promise<void>;
  activeChatThreadId: string;
  setActiveChatThreadId: (id: string) => void;
  chatMessages: ChatMessageRecord[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageRecord[]>>;
  refreshChatMessages: () => Promise<void>;

  busy: boolean;
  error: string;
  message: string;
  setError: (e: string) => void;
  setMessage: (m: string) => void;
};

const ACTIVE_WORKSPACE_STORAGE_KEY = "openauthor.activeWorkspaceId";
const ACTIVE_PROJECT_STORAGE_KEY = "openauthor.activeProjectId";
const ACTIVE_PROJECT_ROOT_STORAGE_KEY = "openauthor.activeProjectRoot";

export function isMissingGitRepositoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("not a git repository");
}

function createProjectId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `proj-${crypto.randomUUID()}`;
  }
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const LEGACY_PROJECT_ROOT_STORAGE_KEY = "openauthor.projectRoot";

const WorkspaceCtx = createContext<WorkspaceState | null>(null);

function routeProjectSelection(): { workspaceSlug: string; projectId: string } | null {
  if (typeof window === "undefined") return null;
  const match = /^\/w\/([^/]+)\/p\/([^/]+)$/.exec(window.location.pathname);
  if (!match) return null;
  return {
    workspaceSlug: decodeURIComponent(match[1]),
    projectId: decodeURIComponent(match[2]),
  };
}

function summarizeImportMessage(
  initialized: InitProjectResult,
  sourceLabel: "archive" | "folder"
): string {
  const summary = initialized.import_summary;
  if (!summary) {
    return `Project ${sourceLabel} imported and attached.`;
  }
  const imported = summary.imported;
  const parts: string[] = [];
  if (imported.manuscript) parts.push("manuscript");
  if (imported.codex_sqlite) parts.push("codex sqlite");
  if (imported.codex_snapshot) parts.push("codex snapshot");
  const folderEntityCount = imported.codex_folder_entities ?? 0;
  if (imported.codex_folder && folderEntityCount > 0) {
    parts.push(`${folderEntityCount} codex entities`);
  }
  if (parts.length === 0) {
    return `Project ${sourceLabel} imported and attached.`;
  }
  return `Imported ${parts.join(", ")} and attached project.`;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ children, registryMode = "auto" }: { children: ReactNode; registryMode?: "auto" | "local" }) {
  const registry = useMemo(() => createProjectRegistryClient(registryMode), [registryMode]);
  const routeSelectionRef = useRef(routeProjectSelection());
  const legacyMigratedRef = useRef(false);

  const [activeWorkspaceId, setActiveWorkspaceIdRaw] = useLocalStorage<string>(
    ACTIVE_WORKSPACE_STORAGE_KEY,
    ""
  );
  const [activeProjectId, setActiveProjectIdRaw] = useLocalStorage<string>(
    ACTIVE_PROJECT_STORAGE_KEY,
    ""
  );
  const [projectRoot, setProjectRootRaw] = useLocalStorage<string>(
    ACTIVE_PROJECT_ROOT_STORAGE_KEY,
    ""
  );

  const [projectFound, setProjectFound] = useState<boolean | null>(null);
  const [startupHealth, setStartupHealth] = useState<StartupHealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState("");
  const [message, setMessageState] = useState("");
  const setError = useCallback((next: string) => {
    setErrorState(next);
    if (next) setMessageState("");
  }, []);
  const setMessage = useCallback((next: string) => {
    setMessageState(next);
    if (next) setErrorState("");
  }, []);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [projectActivity, setProjectActivity] = useState<ProjectActivityEvent[]>([]);

  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const sceneReadTarget = useRef({ projectRoot, request: 0 });
  if (sceneReadTarget.current.projectRoot !== projectRoot) sceneReadTarget.current = { projectRoot, request: 0 };
  const [codexEntities, setCodexEntities] = useState<CodexEntity[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [runs, setRuns] = useState<GenerationRunSummary[]>([]);
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [checksCompleted, setChecksCompleted] = useState(false);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [budget, setBudget] = useState<GenerationBudgetReport | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<GenerationRuntimeConfig | null>(null);
  const [chatThreads, setChatThreads] = useState<ChatThreadRecord[]>([]);
  const [activeChatThreadId, setActiveChatThreadId] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);
  const chatTargetRef = useRef({ projectRoot, threadId: activeChatThreadId });
  chatTargetRef.current = { projectRoot, threadId: activeChatThreadId };
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const activeProjectIdRef = useRef(activeProjectId);
  const workspacesRef = useRef(workspaces);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  activeProjectIdRef.current = activeProjectId;
  workspacesRef.current = workspaces;
  const projectSelectionRevision = useRef(0);
  const projectExplicitlyClosed = useRef(false);
  const beginProjectSelection = useCallback((closed = false) => {
    routeSelectionRef.current = null;
    projectExplicitlyClosed.current = closed;
    return ++projectSelectionRevision.current;
  }, []);

  const setActiveWorkspaceId = useCallback((workspaceId: string) => {
    beginProjectSelection();
    activeWorkspaceIdRef.current = workspaceId;
    activeProjectIdRef.current = "";
    setActiveWorkspaceIdRaw(workspaceId);
    setActiveProjectIdRaw("");
    setProjectRootRaw("");
    setProjectFound(null);
  }, [beginProjectSelection, setActiveWorkspaceIdRaw, setActiveProjectIdRaw, setProjectRootRaw]);

  const refreshScenes = useCallback(async () => {
    if (!projectRoot || sceneReadTarget.current.projectRoot !== projectRoot) return;
    const target = sceneReadTarget.current;
    const request = ++target.request;
    try {
      const data = await listScenes(projectRoot);
      if (sceneReadTarget.current !== target || target.request !== request) return;
      setScenes(data);
    } catch (e) {
      if (sceneReadTarget.current !== target || target.request !== request) return;
      setError(`Failed to load scenes: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshStartupHealth = useCallback(async (repair = false) => {
    if (!projectRoot) return;
    try {
      const report = await getStartupHealth(projectRoot, repair);
      setStartupHealth(report);
      if (repair && report.ready) {
        setMessage("Project health repaired and ready.");
      }
    } catch (e) {
      setStartupHealth(null);
      setError(`Startup health check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshCodex = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await listCodexEntities(projectRoot);
      setCodexEntities(data);
    } catch (e) {
      setError(`Failed to load codex: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshProposals = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await listProposals(projectRoot);
      setProposals(data);
    } catch (e) {
      setError(`Failed to load proposals: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshRuns = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await listGenerationRuns(projectRoot);
      setRuns(data);
    } catch (e) {
      setError(`Failed to load runs: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const runChecks = useCallback(async () => {
    if (!projectRoot) return;
    setBusy(true);
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending writing before running checks.");
      const data = await apiRunContinuityChecks(projectRoot);
      setContinuityIssues(data);
      setChecksCompleted(true);
      setMessage(`Manuscript hygiene check complete: ${data.length} finding${data.length === 1 ? "" : "s"}. This is not a story-consistency verdict.`);
    } catch (e) {
      setError(`Manuscript hygiene check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [projectRoot]);

  const refreshBranches = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await apiListBranches(projectRoot);
      setBranches(data);
    } catch (e) {
      if (isMissingGitRepositoryError(e)) {
        setBranches([]);
        return;
      }
      setError(`Failed to load branches: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshBudget = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await apiGetBudget(projectRoot);
      setBudget(data);
    } catch (e) {
      setError(`Failed to load budget: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshRuntimeConfig = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await apiGetRuntimeConfig(projectRoot);
      setRuntimeConfig(data);
    } catch (e) {
      setError(`Failed to load runtime config: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshChatThreads = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await apiListChatThreads(projectRoot);
      if (chatTargetRef.current.projectRoot !== projectRoot) return;
      setChatThreads(data);
    } catch (e) {
      setError(`Failed to load chat threads: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshChatMessages = useCallback(async () => {
    if (!projectRoot || !activeChatThreadId) return;
    try {
      const data = await apiListChatMessages(projectRoot, { threadId: activeChatThreadId });
      if (chatTargetRef.current.projectRoot !== projectRoot || chatTargetRef.current.threadId !== activeChatThreadId) return;
      setChatMessages(data);
    } catch (e) {
      setError(`Failed to load chat messages: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot, activeChatThreadId]);

  const refreshProjectActivity = useCallback(async () => {
    if (!activeProjectId) {
      setProjectActivity([]);
      return;
    }
    try {
      const data = await registry.listProjectActivity(activeProjectId, 200);
      setProjectActivity(data);
    } catch (e) {
      setError(`Failed to load project activity: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeProjectId, registry]);

  const publishAutomaticProjectId = useCallback((projectId: string) => {
    // Parallel startup reads must observe a selected route before React renders.
    activeProjectIdRef.current = projectId;
    setActiveProjectIdRaw(projectId);
  }, [setActiveProjectIdRaw]);

  const refreshWorkspaceData = useCallback(async (workspaceId: string, options: {
    selectionRevision?: number;
    selectProject?: boolean;
  } = {}) => {
    const selectionRevision = options.selectionRevision ?? projectSelectionRevision.current;
    if (!workspaceId) {
      setProjects([]);
      setMembers([]);
      return;
    }
    try {
      const [projectRows, memberRows, userState] = await Promise.all([
        registry.listProjects(workspaceId, { includeArchived: true }),
        registry.listMembers(workspaceId),
        registry.getWorkspaceUserState(workspaceId),
      ]);
      setProjects(projectRows);
      setMembers(memberRows);
      if (options.selectProject === false
          || selectionRevision !== projectSelectionRevision.current
          || projectExplicitlyClosed.current) return;

      const routeSelection = routeSelectionRef.current;
      if (routeSelection) {
        const targetWorkspace = workspacesRef.current.find((row) => row.slug === routeSelection.workspaceSlug);
        if (targetWorkspace?.id === workspaceId && projectRows.some((row) => row.id === routeSelection.projectId)) {
          publishAutomaticProjectId(routeSelection.projectId);
          routeSelectionRef.current = null;
          return;
        }
      }

      const currentProjectId = activeProjectIdRef.current;
      if (currentProjectId && projectRows.some((row) => row.id === currentProjectId)) {
        return;
      }
      if (userState?.activeProjectId && projectRows.some((row) => row.id === userState.activeProjectId)) {
        publishAutomaticProjectId(userState.activeProjectId);
        return;
      }
      const firstActive = projectRows.find((row) => row.status === "active");
      publishAutomaticProjectId(firstActive?.id ?? "");
    } catch (e) {
      if (selectionRevision !== projectSelectionRevision.current) return;
      setError(`Failed to load workspace projects: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [publishAutomaticProjectId, registry]);

  const refreshRegistry = useCallback(async () => {
    const selectionRevision = projectSelectionRevision.current;
    try {
      let workspaceRows = await registry.listWorkspaces();
      if (workspaceRows.length === 0) {
        try {
          await registry.bootstrapWorkspace("Personal Workspace", "personal-workspace");
          workspaceRows = await registry.listWorkspaces();
        } catch {
          // Bootstrap may fail for already-provisioned environments or restricted roles.
        }
      }
      setWorkspaces(workspaceRows);
      workspacesRef.current = workspaceRows;
      if (selectionRevision !== projectSelectionRevision.current) return;
      if (!workspaceRows.length) {
        setActiveWorkspaceIdRaw("");
        setProjects([]);
        setMembers([]);
        return;
      }
      const routeSelection = routeSelectionRef.current;
      const currentWorkspaceId = activeWorkspaceIdRef.current;
      let nextWorkspace = workspaceRows.find((row) => row.id === currentWorkspaceId) ?? null;
      if (!nextWorkspace && routeSelection) {
        nextWorkspace = workspaceRows.find((row) => row.slug === routeSelection.workspaceSlug) ?? null;
      }
      if (!nextWorkspace) {
        nextWorkspace = workspaceRows[0];
      }
      if (nextWorkspace.id !== currentWorkspaceId) {
        setActiveWorkspaceIdRaw(nextWorkspace.id);
      }
      await refreshWorkspaceData(nextWorkspace.id, { selectionRevision });
    } catch (e) {
      if (selectionRevision !== projectSelectionRevision.current) return;
      setError(`Failed to load workspaces: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refreshWorkspaceData, registry, setActiveWorkspaceIdRaw]);

  const openProject = useCallback(async (projectId: string) => {
    if (!activeWorkspaceId || !projectId) return;
    const selectionRevision = beginProjectSelection();
    try {
      await registry.openProject(activeWorkspaceId, projectId);
      if (selectionRevision !== projectSelectionRevision.current) return;
      activeProjectIdRef.current = projectId;
      setActiveProjectIdRaw(projectId);
      const workspace = workspaces.find((row) => row.id === activeWorkspaceId);
      if (workspace && typeof window !== "undefined") {
        const nextPath = `/w/${encodeURIComponent(workspace.slug)}/p/${encodeURIComponent(projectId)}`;
        window.history.replaceState({}, "", nextPath);
      }
      setMessage("Project opened.");
    } catch (e) {
      if (selectionRevision !== projectSelectionRevision.current) return;
      setError(`Failed to open project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeWorkspaceId, beginProjectSelection, registry, setActiveProjectIdRaw, workspaces]);

  const closeProject = useCallback(() => {
    beginProjectSelection(true);
    activeProjectIdRef.current = "";
    setActiveProjectIdRaw("");
    setProjectRootRaw("");
    setProjectFound(null);
    setStartupHealth(null);
    setScenes([]);
    setCodexEntities([]);
    setProposals([]);
    setRuns([]);
    setContinuityIssues([]);
    setChecksCompleted(false);
    setBranches([]);
    setBudget(null);
    setRuntimeConfig(null);
    setChatThreads([]);
    setActiveChatThreadId("");
    setChatMessages([]);
    setProjectActivity([]);
    if (typeof window !== "undefined") {
      const workspace = workspaces.find((row) => row.id === activeWorkspaceId);
      if (workspace) {
        window.history.replaceState({}, "", `/w/${encodeURIComponent(workspace.slug)}`);
      }
    }
  }, [activeWorkspaceId, beginProjectSelection, setActiveProjectIdRaw, setProjectRootRaw, workspaces]);

  const createAndOpenProject = useCallback(async (params: {
    name: string;
    savePath: string;
    importSource?: {
      kind: "manuscript_file" | "manuscript_folder";
      path: string;
      strategy: "auto" | "files" | "headings" | "single";
      corrections: ImportCorrections;
      expectedFingerprint: string;
    };
  }): Promise<boolean> => {
    if (!activeWorkspaceId) {
      setError("Select a workspace before creating a project.");
      return false;
    }
    const trimmedName = params.name.trim();
    const trimmedPath = params.savePath.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return false;
    }
    if (!trimmedPath) {
      setError("Save location is required.");
      return false;
    }
    const selectionRevision = beginProjectSelection();
    setBusy(true);
    try {
      const hasTauri = typeof window !== "undefined" &&
        typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
      let resolvedRoot = trimmedPath;
      const projectId = createProjectId();
      if (hasTauri) {
        const initOpts: { name?: string; projectId?: string; fromZip?: string; fromFolder?: string } = {
          name: trimmedName,
          projectId,
        };
        const initialized = await initializeLocalProject(trimmedPath, initOpts);
        resolvedRoot = initialized.project_root || trimmedPath;
        await projectEnsureId(resolvedRoot, projectId);
        if (params.importSource) {
          await importManuscript(
            resolvedRoot,
            params.importSource.path,
            params.importSource.strategy,
            params.importSource.corrections,
            params.importSource.expectedFingerprint
          );
        }
      }
      const row = await registry.createProject({
        workspaceId: activeWorkspaceId,
        name: trimmedName,
        projectId,
        kind: "book",
      });
      setProjectBinding(row.id, resolvedRoot);
      await registry.openProject(activeWorkspaceId, row.id);
      await refreshWorkspaceData(activeWorkspaceId, { selectionRevision, selectProject: false });
      if (selectionRevision !== projectSelectionRevision.current) return false;
      activeProjectIdRef.current = row.id;
      setActiveProjectIdRaw(row.id);
      setProjectRootRaw(resolvedRoot);
      setProjectFound(hasTauri);
      const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
      if (workspace && typeof window !== "undefined") {
        window.history.replaceState({}, "", `/w/${encodeURIComponent(workspace.slug)}/p/${encodeURIComponent(row.id)}`);
      }
      setMessage(hasTauri
        ? `Project '${trimmedName}' created and opened.`
        : `Project '${trimmedName}' created. Open in the desktop app to scaffold local files.`);
      return true;
    } catch (e) {
      if (selectionRevision !== projectSelectionRevision.current) return false;
      setError(`Failed to create project: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeWorkspaceId, beginProjectSelection, refreshWorkspaceData, registry, setActiveProjectIdRaw, setProjectRootRaw, workspaces]);

  const attachProjectRoot = useCallback(async (root: string, initialSelectionRevision?: number) => {
    if (!activeWorkspaceId) {
      setError("Select a workspace before attaching a local folder.");
      return false;
    }
    const trimmed = root.trim();
    if (!trimmed) {
      setError("Provide a local project path.");
      return false;
    }
    // Scaffold/import callers retain the intent that preceded initialization.
    const selectionRevision = initialSelectionRevision ?? beginProjectSelection();
    const isCurrentSelection = () => selectionRevision === projectSelectionRevision.current;
    if (!isCurrentSelection()) return false;
    setBusy(true);
    try {
      const status = await getProjectStatus(trimmed);
      if (!isCurrentSelection()) return false;
      if (!status.found) {
        throw new Error(`No openAuthor project found at '${status.project_root || trimmed}'.`);
      }
      const identity = await projectInspect(status.project_root);
      if (!isCurrentSelection()) return false;
      const resolvedProjectId = identity.project_id;
      if (activeProjectId !== resolvedProjectId) {
        let existing = projects.find((row) => row.id === resolvedProjectId);
        if (!existing) {
          // A startup read may still be pending; missing cached rows are not
          // evidence that an existing folder needs a new registry record.
          const currentProjects = await registry.listProjects(activeWorkspaceId, { includeArchived: true });
          if (!isCurrentSelection()) return false;
          existing = currentProjects.find((row) => row.id === resolvedProjectId);
        }
        if (!existing) {
          await registry.createProject({
            workspaceId: activeWorkspaceId,
            projectId: resolvedProjectId,
            name: identity.name || "Imported Project",
            kind: "book",
            settings: {
              linked_project_id: resolvedProjectId,
            },
          });
          if (!isCurrentSelection()) return false;
          await refreshWorkspaceData(activeWorkspaceId, { selectionRevision, selectProject: false });
          if (!isCurrentSelection()) return false;
        }
        await registry.openProject(activeWorkspaceId, resolvedProjectId);
        if (!isCurrentSelection()) return false;
      }
      await projectEnsureId(status.project_root, resolvedProjectId);
      if (!isCurrentSelection()) return false;
      setProjectBinding(resolvedProjectId, status.project_root);
      activeProjectIdRef.current = resolvedProjectId;
      setActiveProjectIdRaw(resolvedProjectId);
      setProjectRootRaw(status.project_root);
      setProjectFound(true);
      setMessage("Project folder attached.");
      return true;
    } catch (e) {
      if (!isCurrentSelection()) return false;
      setProjectFound(false);
      setError(`Project attach failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    activeProjectId,
    activeWorkspaceId,
    beginProjectSelection,
    projects,
    refreshWorkspaceData,
    registry,
    setActiveProjectIdRaw,
    setProjectRootRaw,
  ]);

  const setProjectRoot = useCallback((root: string) => {
    void attachProjectRoot(root);
  }, [attachProjectRoot]);

  const createLocalProjectScaffold = useCallback(async (
    root: string,
    name?: string,
    projectId?: string,
  ) => {
    if (!activeWorkspaceId) {
      setError("Select a workspace before scaffolding a project.");
      return false;
    }
    const trimmedRoot = root.trim();
    if (!trimmedRoot) {
      setError("Provide a destination folder path.");
      return false;
    }
    const selectionRevision = beginProjectSelection();
    const desiredProjectId = projectId?.trim() || activeProjectId || undefined;
    setBusy(true);
    try {
      const initialized = await initializeLocalProject(trimmedRoot, {
        name,
        projectId: desiredProjectId,
      });
      if (selectionRevision !== projectSelectionRevision.current) return false;
      const attached = await attachProjectRoot(initialized.project_root || trimmedRoot, selectionRevision);
      if (!attached) {
        return false;
      }
      setMessage("Local project scaffold created and attached.");
      return true;
    } catch (e) {
      if (selectionRevision !== projectSelectionRevision.current) return false;
      setError(`Project scaffold failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, activeWorkspaceId, attachProjectRoot, beginProjectSelection]);

  const importProjectArchive = useCallback(async (
    archivePath: string,
    root: string,
    name?: string,
    projectId?: string,
  ) => {
    if (!activeWorkspaceId) {
      setError("Select a workspace before importing.");
      return false;
    }
    const trimmedArchive = archivePath.trim();
    const trimmedRoot = root.trim();
    if (!trimmedArchive) {
      setError("Provide a zip archive path.");
      return false;
    }
    if (!trimmedRoot) {
      setError("Provide a destination folder path.");
      return false;
    }
    const selectionRevision = beginProjectSelection();
    const desiredProjectId = projectId?.trim() || activeProjectId || undefined;
    setBusy(true);
    try {
      const initialized = await initializeLocalProject(trimmedRoot, {
        name,
        projectId: desiredProjectId,
        fromZip: trimmedArchive,
      });
      if (selectionRevision !== projectSelectionRevision.current) return false;
      const attached = await attachProjectRoot(initialized.project_root || trimmedRoot, selectionRevision);
      if (!attached) {
        return false;
      }
      setMessage(summarizeImportMessage(initialized, "archive"));
      return true;
    } catch (e) {
      if (selectionRevision !== projectSelectionRevision.current) return false;
      setError(`Project import failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, activeWorkspaceId, attachProjectRoot, beginProjectSelection]);

  const importProjectFolder = useCallback(async (
    sourcePath: string,
    root: string,
    name?: string,
    projectId?: string,
  ) => {
    if (!activeWorkspaceId) {
      setError("Select a workspace before importing.");
      return false;
    }
    const trimmedSource = sourcePath.trim();
    const trimmedRoot = root.trim();
    if (!trimmedSource) {
      setError("Provide a source folder path.");
      return false;
    }
    if (!trimmedRoot) {
      setError("Provide a destination folder path.");
      return false;
    }
    const selectionRevision = beginProjectSelection();
    const desiredProjectId = projectId?.trim() || activeProjectId || undefined;
    setBusy(true);
    try {
      const initialized = await initializeLocalProject(trimmedRoot, {
        name,
        projectId: desiredProjectId,
        fromFolder: trimmedSource,
      });
      if (selectionRevision !== projectSelectionRevision.current) return false;
      const attached = await attachProjectRoot(initialized.project_root || trimmedRoot, selectionRevision);
      if (!attached) {
        return false;
      }
      setMessage(summarizeImportMessage(initialized, "folder"));
      return true;
    } catch (e) {
      if (selectionRevision !== projectSelectionRevision.current) return false;
      setError(`Project folder import failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, activeWorkspaceId, attachProjectRoot, beginProjectSelection]);

  const createProjectRecord = useCallback(async (name: string): Promise<Project | null> => {
    if (!activeWorkspaceId) {
      setError("Select a workspace before creating a project.");
      return null;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return null;
    }
    try {
      const row = await registry.createProject({
        workspaceId: activeWorkspaceId,
        name: trimmedName,
        kind: "book",
      });
      setMessage(`Created project '${row.name}'.`);
      await refreshWorkspaceData(activeWorkspaceId);
      return row;
    } catch (e) {
      setError(`Failed to create project: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, [activeWorkspaceId, refreshWorkspaceData, registry]);

  const renameProjectRecord = useCallback(async (projectId: string, name: string) => {
    try {
      await registry.renameProject(projectId, name);
      await refreshWorkspaceData(activeWorkspaceId);
      await refreshProjectActivity();
      setMessage("Project renamed.");
    } catch (e) {
      setError(`Failed to rename project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeWorkspaceId, refreshProjectActivity, refreshWorkspaceData, registry]);

  const archiveProjectRecord = useCallback(async (projectId: string) => {
    try {
      await registry.archiveProject(projectId);
      await refreshWorkspaceData(activeWorkspaceId);
      await refreshProjectActivity();
      setMessage("Project archived.");
    } catch (e) {
      setError(`Failed to archive project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeWorkspaceId, refreshProjectActivity, refreshWorkspaceData, registry]);

  const restoreProjectRecord = useCallback(async (projectId: string) => {
    try {
      await registry.restoreProject(projectId);
      await refreshWorkspaceData(activeWorkspaceId);
      await refreshProjectActivity();
      setMessage("Project restored.");
    } catch (e) {
      setError(`Failed to restore project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeWorkspaceId, refreshProjectActivity, refreshWorkspaceData, registry]);

  const moveProjectRecord = useCallback(async (projectId: string, workspaceId: string) => {
    try {
      await registry.moveProject(projectId, workspaceId);
      await refreshRegistry();
      setMessage("Project moved.");
    } catch (e) {
      setError(`Failed to move project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refreshRegistry, registry]);

  const copyProjectRecord = useCallback(async (projectId: string, workspaceId?: string) => {
    try {
      await registry.copyProject(projectId, workspaceId);
      await refreshRegistry();
      setMessage("Project copied.");
    } catch (e) {
      setError(`Failed to copy project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refreshRegistry, registry]);

  const setMemberRole = useCallback(async (userId: string, role: "owner" | "editor" | "viewer") => {
    if (!activeWorkspaceId) return;
    try {
      await registry.setMemberRole(activeWorkspaceId, userId, role);
      await refreshWorkspaceData(activeWorkspaceId);
      setMessage("Member role updated.");
    } catch (e) {
      setError(`Failed to update role: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeWorkspaceId, refreshWorkspaceData, registry]);

  useEffect(() => {
    if (activeChatThreadId) {
      void refreshChatMessages();
    } else {
      setChatMessages([]);
    }
  }, [activeChatThreadId, refreshChatMessages]);

  useEffect(() => {
    void refreshRegistry();
  }, [refreshRegistry]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    void refreshWorkspaceData(activeWorkspaceId);
  }, [activeWorkspaceId, refreshWorkspaceData]);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectRootRaw("");
      setProjectFound(null);
      return;
    }
    const binding = getProjectBinding(activeProjectId);
    if (!binding) {
      setProjectRootRaw("");
      setProjectFound(false);
      return;
    }
    setProjectRootRaw(binding.localPath);
  }, [activeProjectId, setProjectRootRaw]);

  useEffect(() => {
    if (legacyMigratedRef.current) return;
    // Legacy migration belongs to startup. A rerender must not let it claim
    // the revision of a newer explicit attachment, import or selection.
    if (projectSelectionRevision.current !== 0) {
      legacyMigratedRef.current = true;
      return;
    }
    if (activeProjectId) {
      legacyMigratedRef.current = true;
      return;
    }
    if (!activeWorkspaceId) return;
    if (typeof window === "undefined") return;
    const legacyRoot = window.localStorage.getItem(LEGACY_PROJECT_ROOT_STORAGE_KEY);
    if (!legacyRoot || !legacyRoot.trim()) {
      legacyMigratedRef.current = true;
      return;
    }
    const selectionRevision = projectSelectionRevision.current;
    let cancelled = false;
    const isCurrentSelection = () => !cancelled
      && selectionRevision === projectSelectionRevision.current
      && !projectExplicitlyClosed.current;
    (async () => {
      try {
        const status = await getProjectStatus(legacyRoot);
        if (!status.found) {
          legacyMigratedRef.current = true;
          return;
        }
        if (!isCurrentSelection()) return;
        const identity = await projectInspect(status.project_root);
        if (!isCurrentSelection()) return;

        const projectByIdentity = projects.find((row) => row.id === identity.project_id);
        let resolvedProject = projectByIdentity;
        if (!resolvedProject) {
          resolvedProject = await registry.createProject({
            workspaceId: activeWorkspaceId,
            projectId: identity.project_id,
            name: identity.name || "Imported Project",
            kind: "book",
            settings: {
              linked_project_id: identity.project_id,
            },
          });
        }
        if (!isCurrentSelection()) return;
        if (resolvedProject.id !== identity.project_id) {
          setError(
            "Legacy project id does not match registry id. " +
            "Create/select the project with matching id and attach it manually."
          );
          legacyMigratedRef.current = true;
          return;
        }
        setProjectBinding(resolvedProject.id, status.project_root);
        publishAutomaticProjectId(resolvedProject.id);
        setProjectRootRaw(status.project_root);
        setMessage("Migrated legacy project root to project binding.");
      } catch (e) {
        if (isCurrentSelection()) {
          setError(`Legacy migration failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        legacyMigratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    activeWorkspaceId,
    projects,
    registry,
    publishAutomaticProjectId,
    setProjectRootRaw,
  ]);

  useEffect(() => {
    if (!projectRoot) {
      setProjectFound(activeProjectId ? false : null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await getProjectStatus(projectRoot);
        if (cancelled) return;
        if (status.project_root && status.project_root !== projectRoot) {
          setProjectRootRaw(status.project_root);
        }
        if (status.found && activeProjectId) {
          await projectEnsureId(status.project_root, activeProjectId);
        }
        if (cancelled) return;
        setProjectFound(status.found);
        if (status.found) {
          await Promise.all([
            refreshStartupHealth(),
            refreshScenes(),
            refreshCodex(),
            refreshProposals(),
            refreshRuns(),
            refreshBranches(),
            refreshBudget(),
            refreshRuntimeConfig(),
            refreshChatThreads(),
            refreshProjectActivity(),
          ]);
        }
      } catch (e) {
        if (cancelled) return;
        setProjectFound(false);
        setError(`Project check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    projectRoot,
    refreshBudget,
    refreshBranches,
    refreshChatThreads,
    refreshCodex,
    refreshProjectActivity,
    refreshProposals,
    refreshRuns,
    refreshRuntimeConfig,
    refreshScenes,
    refreshStartupHealth,
    setProjectRootRaw,
  ]);

  const value: WorkspaceState = {
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeProjectId,
    openProject,
    createAndOpenProject,
    closeProject,
    workspaces,
    projects,
    members,
    projectActivity,
    refreshRegistry,
    refreshProjectActivity,
    createProjectRecord,
    renameProjectRecord,
    archiveProjectRecord,
    restoreProjectRecord,
    moveProjectRecord,
    copyProjectRecord,
    setMemberRole,

    projectRoot,
    setProjectRoot,
    attachProjectRoot,
    createLocalProjectScaffold,
    importProjectArchive,
    importProjectFolder,
    projectFound,
    startupHealth,
    refreshStartupHealth,

    scenes,
    refreshScenes,
    codexEntities,
    refreshCodex,
    proposals,
    refreshProposals,
    runs,
    refreshRuns,
    continuityIssues,
    checksCompleted,
    runChecks,
    branches,
    refreshBranches,
    budget,
    refreshBudget,
    runtimeConfig,
    refreshRuntimeConfig,
    chatThreads,
    refreshChatThreads,
    activeChatThreadId,
    setActiveChatThreadId,
    chatMessages,
    setChatMessages,
    refreshChatMessages,
    busy,
    error,
    message,
    setError,
    setMessage,
  };

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
