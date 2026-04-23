import { afterEach, describe, expect, it } from "vitest";
import { createProjectRegistryClient } from "./projectRegistry";

const originalWindow = (globalThis as { window?: unknown }).window;

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  if (typeof originalWindow === "undefined") {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("local project registry", () => {
  it("creates, opens, archives, restores, copies, and tracks activity", async () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: new MemoryStorage(),
      location: { pathname: "/" },
      history: { replaceState() {} },
    };
    const client = createProjectRegistryClient();
    const workspaces = await client.listWorkspaces();
    expect(workspaces.length).toBeGreaterThan(0);
    const workspaceId = workspaces[0].id;

    const created = await client.createProject({
      workspaceId,
      projectId: "project-abc",
      name: "Story A",
    });
    expect(created.id).toBe("project-abc");

    const opened = await client.openProject(workspaceId, created.id);
    expect(opened.activeProjectId).toBe(created.id);
    expect(opened.recentProjectIds[0]).toBe(created.id);

    const renamed = await client.renameProject(created.id, "Story B");
    expect(renamed.name).toBe("Story B");

    const archived = await client.archiveProject(created.id);
    expect(archived.status).toBe("archived");
    const restored = await client.restoreProject(created.id);
    expect(restored.status).toBe("active");

    const copied = await client.copyProject(created.id);
    expect(copied.id).not.toBe(created.id);
    expect(copied.name).toContain("Copy");

    const activity = await client.listProjectActivity(created.id);
    expect(activity.length).toBeGreaterThan(0);
  });

  it("manages member roles", async () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: new MemoryStorage(),
      location: { pathname: "/" },
      history: { replaceState() {} },
    };
    const client = createProjectRegistryClient();
    const workspace = (await client.listWorkspaces())[0];
    await client.setMemberRole(workspace.id, "user-2", "editor");
    const members = await client.listMembers(workspace.id);
    expect(members.some((member) => member.userId === "user-2" && member.role === "editor")).toBe(true);
  });
});
