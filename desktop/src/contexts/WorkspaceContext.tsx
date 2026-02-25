import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
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
} from "../api";
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
} from "../types";

type WorkspaceState = {
  projectRoot: string;
  setProjectRoot: (root: string) => void;
  projectFound: boolean | null;

  scenes: SceneSummary[];
  refreshScenes: () => Promise<void>;

  codexEntities: CodexEntity[];
  refreshCodex: () => Promise<void>;

  proposals: ProposalRecord[];
  refreshProposals: () => Promise<void>;

  runs: GenerationRunSummary[];
  refreshRuns: () => Promise<void>;

  continuityIssues: ContinuityIssue[];
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
  chatSending: boolean;
  setChatSending: (v: boolean) => void;

  busy: boolean;
  error: string;
  message: string;
  setError: (e: string) => void;
  setMessage: (m: string) => void;
};

const WorkspaceCtx = createContext<WorkspaceState | null>(null);

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projectRoot, setProjectRootRaw] = useLocalStorage("openauthor.projectRoot", "");
  const [projectFound, setProjectFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [codexEntities, setCodexEntities] = useState<CodexEntity[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [runs, setRuns] = useState<GenerationRunSummary[]>([]);
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [budget, setBudget] = useState<GenerationBudgetReport | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<GenerationRuntimeConfig | null>(null);
  const [chatThreads, setChatThreads] = useState<ChatThreadRecord[]>([]);
  const [activeChatThreadId, setActiveChatThreadId] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);
  const [chatSending, setChatSending] = useState(false);

  const setProjectRoot = useCallback((root: string) => {
    setProjectRootRaw(root);
    setProjectFound(null);
  }, [setProjectRootRaw]);

  const refreshScenes = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const data = await listScenes(projectRoot);
      setScenes(data);
    } catch (e) {
      setError(`Failed to load scenes: ${e instanceof Error ? e.message : String(e)}`);
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
      const data = await apiRunContinuityChecks(projectRoot);
      setContinuityIssues(data);
      setMessage(`Continuity check complete: ${data.length} issue${data.length === 1 ? "" : "s"} found.`);
    } catch (e) {
      setError(`Continuity check failed: ${e instanceof Error ? e.message : String(e)}`);
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
      setChatThreads(data);
    } catch (e) {
      setError(`Failed to load chat threads: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot]);

  const refreshChatMessages = useCallback(async () => {
    if (!projectRoot || !activeChatThreadId) return;
    try {
      const data = await apiListChatMessages(projectRoot, { threadId: activeChatThreadId });
      setChatMessages(data);
    } catch (e) {
      setError(`Failed to load chat messages: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectRoot, activeChatThreadId]);

  useEffect(() => {
    if (activeChatThreadId) {
      refreshChatMessages();
    } else {
      setChatMessages([]);
    }
  }, [activeChatThreadId, refreshChatMessages]);

  useEffect(() => {
    if (!projectRoot) {
      setProjectFound(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await getProjectStatus(projectRoot);
        if (cancelled) return;
        setProjectFound(status.found);
        if (status.found) {
          await Promise.all([
            refreshScenes(),
            refreshCodex(),
            refreshProposals(),
            refreshRuns(),
            refreshBranches(),
            refreshBudget(),
            refreshRuntimeConfig(),
            refreshChatThreads(),
          ]);
        }
      } catch (e) {
        if (cancelled) return;
        setProjectFound(false);
        setError(`Project check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [projectRoot, refreshScenes, refreshCodex, refreshProposals, refreshRuns, refreshBranches, refreshBudget, refreshRuntimeConfig, refreshChatThreads]);

  const value: WorkspaceState = {
    projectRoot, setProjectRoot, projectFound,
    scenes, refreshScenes,
    codexEntities, refreshCodex,
    proposals, refreshProposals,
    runs, refreshRuns,
    continuityIssues, runChecks,
    branches, refreshBranches,
    budget, refreshBudget,
    runtimeConfig, refreshRuntimeConfig,
    chatThreads, refreshChatThreads,
    activeChatThreadId, setActiveChatThreadId,
    chatMessages, setChatMessages, refreshChatMessages,
    chatSending, setChatSending,
    busy, error, message, setError, setMessage,
  };

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
