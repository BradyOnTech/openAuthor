import { afterEach, describe, expect, it } from "vitest";
import {
  getMachineId,
  getProjectBinding,
  removeProjectBinding,
  setProjectBinding,
} from "./projectBindings";

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

describe("projectBindings", () => {
  it("stores and clears binding by project id", () => {
    const storage = new MemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };

    const binding = setProjectBinding("project-1", "/tmp/demo");
    expect(binding.projectId).toBe("project-1");
    expect(binding.localPath).toBe("/tmp/demo");
    expect(getProjectBinding("project-1")?.localPath).toBe("/tmp/demo");

    removeProjectBinding("project-1");
    expect(getProjectBinding("project-1")).toBeNull();
  });

  it("persists machine id", () => {
    const storage = new MemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };
    const first = getMachineId();
    const second = getMachineId();
    expect(second).toBe(first);
  });
});
