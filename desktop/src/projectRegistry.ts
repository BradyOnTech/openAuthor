import { desktopAccessToken } from "./cloud/account";
import type {
  Project,
  ProjectActivityEvent,
  ProjectKind,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceUserState,
} from "./types";

type ProjectRecord = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  kind: ProjectKind;
  status: "active" | "archived";
  settings: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

type WorkspaceMemberRecord = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
};

type ProjectActivityRecord = {
  id: string;
  project_id: string;
  actor_user_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type WorkspaceUserStateRecord = {
  workspace_id: string;
  user_id: string;
  active_project_id: string;
  recent_project_ids: string[];
  updated_at: string;
};

export type ProjectRegistryClient = {
  bootstrapWorkspace: (name?: string, slug?: string) => Promise<Workspace>;
  listWorkspaces: () => Promise<Workspace[]>;
  listProjects: (workspaceId: string, options?: { includeArchived?: boolean }) => Promise<Project[]>;
  createProject: (input: {
    workspaceId: string;
    name: string;
    projectId?: string;
    kind?: ProjectKind;
    settings?: Record<string, unknown>;
  }) => Promise<Project>;
  openProject: (workspaceId: string, projectId: string) => Promise<WorkspaceUserState>;
  renameProject: (projectId: string, name: string) => Promise<Project>;
  archiveProject: (projectId: string) => Promise<Project>;
  restoreProject: (projectId: string) => Promise<Project>;
  moveProject: (projectId: string, workspaceId: string) => Promise<Project>;
  copyProject: (projectId: string, workspaceId?: string) => Promise<Project>;
  listProjectActivity: (projectId: string, limit?: number) => Promise<ProjectActivityEvent[]>;
  setMemberRole: (workspaceId: string, userId: string, role: WorkspaceRole) => Promise<WorkspaceMember>;
  listMembers: (workspaceId: string) => Promise<WorkspaceMember[]>;
  getWorkspaceUserState: (workspaceId: string) => Promise<WorkspaceUserState | null>;
};

const STORAGE_KEY = "openauthor.projectRegistry.v1";
const LOCAL_USER_ID_KEY = "openauthor.registryUserId";
const DEFAULT_WORKSPACE_ID = "ws-default";

type LocalRegistryData = {
  workspaces: WorkspaceRecord[];
  projects: ProjectRecord[];
  members: WorkspaceMemberRecord[];
  activity: ProjectActivityRecord[];
  userState: WorkspaceUserStateRecord[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "untitled";
}

function randomId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function localUserId(storage = getStorage()): string {
  if (!storage) return "local-user";
  const existing = storage.getItem(LOCAL_USER_ID_KEY);
  if (existing && existing.trim() !== "") return existing;
  const created = randomId("user");
  storage.setItem(LOCAL_USER_ID_KEY, created);
  return created;
}

function mapWorkspace(row: WorkspaceRecord): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProject(row: ProjectRecord): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    settings: row.settings || {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: WorkspaceMemberRecord): WorkspaceMember {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
  };
}

function mapActivity(row: ProjectActivityRecord): ProjectActivityEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

function mapUserState(row: WorkspaceUserStateRecord): WorkspaceUserState {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    activeProjectId: row.active_project_id,
    recentProjectIds: Array.isArray(row.recent_project_ids) ? row.recent_project_ids : [],
    updatedAt: row.updated_at,
  };
}

function bootstrapLocalRegistry(data: LocalRegistryData, userId: string): LocalRegistryData {
  if (data.workspaces.length > 0) return data;
  const ts = nowIso();
  const workspace: WorkspaceRecord = {
    id: DEFAULT_WORKSPACE_ID,
    name: "Personal Workspace",
    slug: "personal-workspace",
    created_at: ts,
    updated_at: ts,
  };
  data.workspaces.push(workspace);
  data.members.push({
    workspace_id: workspace.id,
    user_id: userId,
    role: "owner",
  });
  return data;
}

function loadLocalRegistry(storage = getStorage()): LocalRegistryData {
  const fallback: LocalRegistryData = {
    workspaces: [],
    projects: [],
    members: [],
    activity: [],
    userState: [],
  };
  if (!storage) {
    return bootstrapLocalRegistry(fallback, "local-user");
  }
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    const bootstrapped = bootstrapLocalRegistry(fallback, localUserId(storage));
    storage.setItem(STORAGE_KEY, JSON.stringify(bootstrapped));
    return bootstrapped;
  }
  try {
    const decoded = JSON.parse(raw) as Partial<LocalRegistryData>;
    const loaded: LocalRegistryData = {
      workspaces: Array.isArray(decoded.workspaces) ? decoded.workspaces : [],
      projects: Array.isArray(decoded.projects) ? decoded.projects : [],
      members: Array.isArray(decoded.members) ? decoded.members : [],
      activity: Array.isArray(decoded.activity) ? decoded.activity : [],
      userState: Array.isArray(decoded.userState) ? decoded.userState : [],
    };
    return bootstrapLocalRegistry(loaded, localUserId(storage));
  } catch {
    const bootstrapped = bootstrapLocalRegistry(fallback, localUserId(storage));
    storage.setItem(STORAGE_KEY, JSON.stringify(bootstrapped));
    return bootstrapped;
  }
}

function saveLocalRegistry(data: LocalRegistryData, storage = getStorage()): void {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function appendRecent(list: string[], projectId: string): string[] {
  const filtered = list.filter((id) => id !== projectId);
  return [projectId, ...filtered].slice(0, 20);
}

class LocalProjectRegistryClient implements ProjectRegistryClient {
  async bootstrapWorkspace(name = "Personal Workspace", slug = "personal-workspace"): Promise<Workspace> {
    const storage = getStorage();
    const state = loadLocalRegistry(storage);
    const existing = state.workspaces.find((row) => row.slug === slug);
    if (existing) {
      const userId = localUserId(storage);
      const existingMember = state.members.find(
        (row) => row.workspace_id === existing.id && row.user_id === userId
      );
      if (!existingMember) {
        state.members.push({
          workspace_id: existing.id,
          user_id: userId,
          role: "owner",
        });
        saveLocalRegistry(state, storage);
      }
      return mapWorkspace(existing);
    }
    const ts = nowIso();
    const created: WorkspaceRecord = {
      id: randomId("ws"),
      name,
      slug: slugify(slug),
      created_at: ts,
      updated_at: ts,
    };
    state.workspaces.push(created);
    state.members.push({
      workspace_id: created.id,
      user_id: localUserId(storage),
      role: "owner",
    });
    saveLocalRegistry(state, storage);
    return mapWorkspace(created);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const state = loadLocalRegistry();
    return state.workspaces
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(mapWorkspace);
  }

  async listProjects(workspaceId: string, options?: { includeArchived?: boolean }): Promise<Project[]> {
    const state = loadLocalRegistry();
    return state.projects
      .filter((row) => row.workspace_id === workspaceId)
      .filter((row) => options?.includeArchived || row.status === "active")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(mapProject);
  }

  async createProject(input: {
    workspaceId: string;
    name: string;
    projectId?: string;
    kind?: ProjectKind;
    settings?: Record<string, unknown>;
  }): Promise<Project> {
    const storage = getStorage();
    const state = loadLocalRegistry(storage);
    const ts = nowIso();
    const userId = localUserId(storage);
    const row: ProjectRecord = {
      id: input.projectId && input.projectId.trim() ? input.projectId.trim() : randomId("proj"),
      workspace_id: input.workspaceId,
      name: input.name.trim(),
      slug: slugify(input.name),
      kind: input.kind ?? "book",
      status: "active",
      settings: input.settings ?? {},
      created_by: userId,
      created_at: ts,
      updated_at: ts,
    };
    state.projects.push(row);
    state.activity.push({
      id: randomId("evt"),
      project_id: row.id,
      actor_user_id: userId,
      event_type: "project_created",
      payload: {
        workspace_id: row.workspace_id,
      },
      created_at: ts,
    });
    saveLocalRegistry(state, storage);
    return mapProject(row);
  }

  async openProject(workspaceId: string, projectId: string): Promise<WorkspaceUserState> {
    const storage = getStorage();
    const state = loadLocalRegistry(storage);
    const userId = localUserId(storage);
    const ts = nowIso();
    const existing = state.userState.find(
      (row) => row.workspace_id === workspaceId && row.user_id === userId
    );
    if (existing) {
      existing.active_project_id = projectId;
      existing.recent_project_ids = appendRecent(existing.recent_project_ids || [], projectId);
      existing.updated_at = ts;
      saveLocalRegistry(state, storage);
      return mapUserState(existing);
    }
    const created: WorkspaceUserStateRecord = {
      workspace_id: workspaceId,
      user_id: userId,
      active_project_id: projectId,
      recent_project_ids: [projectId],
      updated_at: ts,
    };
    state.userState.push(created);
    saveLocalRegistry(state, storage);
    return mapUserState(created);
  }

  async renameProject(projectId: string, name: string): Promise<Project> {
    return this.updateProject(projectId, (row) => {
      row.name = name.trim();
      row.slug = slugify(name);
      return "project_renamed";
    });
  }

  async archiveProject(projectId: string): Promise<Project> {
    return this.updateProject(projectId, (row) => {
      row.status = "archived";
      return "project_archived";
    });
  }

  async restoreProject(projectId: string): Promise<Project> {
    return this.updateProject(projectId, (row) => {
      row.status = "active";
      return "project_restored";
    });
  }

  async moveProject(projectId: string, workspaceId: string): Promise<Project> {
    return this.updateProject(projectId, (row) => {
      row.workspace_id = workspaceId;
      return "project_moved";
    }, { workspace_id: workspaceId });
  }

  async copyProject(projectId: string, workspaceId?: string): Promise<Project> {
    const storage = getStorage();
    const state = loadLocalRegistry(storage);
    const source = state.projects.find((row) => row.id === projectId);
    if (!source) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const ts = nowIso();
    const userId = localUserId(storage);
    const copy: ProjectRecord = {
      ...source,
      id: randomId("proj"),
      workspace_id: workspaceId ?? source.workspace_id,
      name: `${source.name} Copy`,
      slug: slugify(`${source.slug}-copy`),
      status: "active",
      created_by: userId,
      created_at: ts,
      updated_at: ts,
      settings: { ...source.settings },
    };
    state.projects.push(copy);
    state.activity.push({
      id: randomId("evt"),
      project_id: copy.id,
      actor_user_id: userId,
      event_type: "project_copied",
      payload: {
        source_project_id: source.id,
        workspace_id: copy.workspace_id,
      },
      created_at: ts,
    });
    saveLocalRegistry(state, storage);
    return mapProject(copy);
  }

  async listProjectActivity(projectId: string, limit = 100): Promise<ProjectActivityEvent[]> {
    const state = loadLocalRegistry();
    return state.activity
      .filter((row) => row.project_id === projectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map(mapActivity);
  }

  async setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const storage = getStorage();
    const state = loadLocalRegistry(storage);
    const existing = state.members.find(
      (row) => row.workspace_id === workspaceId && row.user_id === userId
    );
    if (existing) {
      existing.role = role;
      saveLocalRegistry(state, storage);
      return mapMember(existing);
    }
    const created: WorkspaceMemberRecord = {
      workspace_id: workspaceId,
      user_id: userId,
      role,
    };
    state.members.push(created);
    saveLocalRegistry(state, storage);
    return mapMember(created);
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const state = loadLocalRegistry();
    return state.members
      .filter((row) => row.workspace_id === workspaceId)
      .map(mapMember);
  }

  async getWorkspaceUserState(workspaceId: string): Promise<WorkspaceUserState | null> {
    const storage = getStorage();
    const state = loadLocalRegistry(storage);
    const userId = localUserId(storage);
    const row = state.userState.find(
      (candidate) => candidate.workspace_id === workspaceId && candidate.user_id === userId
    );
    return row ? mapUserState(row) : null;
  }

  private async updateProject(
    projectId: string,
    mutator: (row: ProjectRecord) => string,
    payload: Record<string, unknown> = {}
  ): Promise<Project> {
    const storage = getStorage();
    const state = loadLocalRegistry(storage);
    const row = state.projects.find((candidate) => candidate.id === projectId);
    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const eventType = mutator(row);
    row.updated_at = nowIso();
    state.activity.push({
      id: randomId("evt"),
      project_id: row.id,
      actor_user_id: localUserId(storage),
      event_type: eventType,
      payload,
      created_at: row.updated_at,
    });
    saveLocalRegistry(state, storage);
    return mapProject(row);
  }
}

class SupabaseProjectRegistryClient implements ProjectRegistryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly anonKey: string,
    private readonly getAuthToken: () => Promise<string | null>
  ) {}

  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.request<WorkspaceRecord[]>(
      "/rest/v1/workspaces?select=id,name,slug,created_at,updated_at&order=updated_at.desc"
    );
    return rows.map(mapWorkspace);
  }

  async bootstrapWorkspace(name = "Personal Workspace", slug = "personal-workspace"): Promise<Workspace> {
    const row = await this.request<WorkspaceRecord>("/rest/v1/rpc/workspace_bootstrap", {
      method: "POST",
      body: JSON.stringify({
        p_name: name,
        p_slug: slug,
      }),
    });
    return mapWorkspace(row);
  }

  async listProjects(workspaceId: string, options?: { includeArchived?: boolean }): Promise<Project[]> {
    const includeArchived = options?.includeArchived === true;
    const statusFilter = includeArchived ? "" : "&status=eq.active";
    const rows = await this.request<ProjectRecord[]>(
      `/rest/v1/projects?select=id,workspace_id,name,slug,kind,status,settings,created_by,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}${statusFilter}&order=updated_at.desc`
    );
    return rows.map(mapProject);
  }

  async createProject(input: {
    workspaceId: string;
    name: string;
    projectId?: string;
    kind?: ProjectKind;
    settings?: Record<string, unknown>;
  }): Promise<Project> {
    const row = await this.request<ProjectRecord>("/rest/v1/rpc/project_create", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_id: input.workspaceId,
        p_project_id: input.projectId ?? null,
        p_name: input.name,
        p_kind: input.kind ?? "book",
        p_settings: input.settings ?? {},
      }),
    });
    return mapProject(row);
  }

  async openProject(workspaceId: string, projectId: string): Promise<WorkspaceUserState> {
    const row = await this.request<WorkspaceUserStateRecord>("/rest/v1/rpc/project_open", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_id: workspaceId,
        p_project_id: projectId,
      }),
    });
    return mapUserState(row);
  }

  async renameProject(projectId: string, name: string): Promise<Project> {
    const row = await this.request<ProjectRecord>("/rest/v1/rpc/project_rename", {
      method: "POST",
      body: JSON.stringify({
        p_project_id: projectId,
        p_name: name,
      }),
    });
    return mapProject(row);
  }

  async archiveProject(projectId: string): Promise<Project> {
    const row = await this.request<ProjectRecord>("/rest/v1/rpc/project_archive", {
      method: "POST",
      body: JSON.stringify({ p_project_id: projectId }),
    });
    return mapProject(row);
  }

  async restoreProject(projectId: string): Promise<Project> {
    const row = await this.request<ProjectRecord>("/rest/v1/rpc/project_restore", {
      method: "POST",
      body: JSON.stringify({ p_project_id: projectId }),
    });
    return mapProject(row);
  }

  async moveProject(projectId: string, workspaceId: string): Promise<Project> {
    const row = await this.request<ProjectRecord>("/rest/v1/rpc/project_move", {
      method: "POST",
      body: JSON.stringify({
        p_project_id: projectId,
        p_workspace_id: workspaceId,
      }),
    });
    return mapProject(row);
  }

  async copyProject(projectId: string, workspaceId?: string): Promise<Project> {
    const row = await this.request<ProjectRecord>("/rest/v1/rpc/project_copy", {
      method: "POST",
      body: JSON.stringify({
        p_project_id: projectId,
        p_workspace_id: workspaceId ?? null,
      }),
    });
    return mapProject(row);
  }

  async listProjectActivity(projectId: string, limit = 100): Promise<ProjectActivityEvent[]> {
    const rows = await this.request<ProjectActivityRecord[]>(
      `/rest/v1/project_activity?select=id,project_id,actor_user_id,event_type,payload,created_at&project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&limit=${limit}`
    );
    return rows.map(mapActivity);
  }

  async setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const row = await this.request<WorkspaceMemberRecord>("/rest/v1/rpc/workspace_member_set_role", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_role: role,
      }),
    });
    return mapMember(row);
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = await this.request<WorkspaceMemberRecord[]>(
      `/rest/v1/workspace_members?select=workspace_id,user_id,role&workspace_id=eq.${encodeURIComponent(workspaceId)}`
    );
    return rows.map(mapMember);
  }

  async getWorkspaceUserState(workspaceId: string): Promise<WorkspaceUserState | null> {
    const rows = await this.request<WorkspaceUserStateRecord[]>(
      `/rest/v1/workspace_user_state?select=workspace_id,user_id,active_project_id,recent_project_ids,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`
    );
    return rows[0] ? mapUserState(rows[0]) : null;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAuthToken();
    if (!token) throw new Error("Sign in to access your shared project library.");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: this.anonKey,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      throw new Error(`Shared project library request failed (${response.status}). Check your connection and access.`);
    }
    if (response.status === 204) {
      return {} as T;
    }
    return response.json() as Promise<T>;
  }
}

function env(name: string): string | undefined {
  return import.meta.env[name];
}

async function defaultSupabaseTokenProvider(): Promise<string | null> {
  return desktopAccessToken();
}

export function createProjectRegistryClient(override: "auto" | "local" = "auto"): ProjectRegistryClient {
  const mode = override === "local" ? "local" : env("VITE_PROJECT_REGISTRY");
  if (mode === "local") {
    return new LocalProjectRegistryClient();
  }
  // Tests must stay hermetic: ambient Supabase credentials (e.g. from
  // .env.local) must not switch the registry to a network client under
  // Vitest unless the test explicitly opts in.
  const underTest = Boolean(env("VITEST"));
  if (underTest && mode !== "supabase") {
    return new LocalProjectRegistryClient();
  }
  const baseUrl = env("VITE_SUPABASE_URL");
  const anonKey = env("VITE_SUPABASE_ANON_KEY");
  if (baseUrl && anonKey) {
    return new SupabaseProjectRegistryClient(baseUrl, anonKey, defaultSupabaseTokenProvider);
  }
  return new LocalProjectRegistryClient();
}
