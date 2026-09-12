// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileInboxPanel } from "./MobileInboxPanel";

const harness = vi.hoisted(() => ({
  setError: vi.fn(),
  configured: false,
  session: vi.fn(async () => ({ userId: "user" })),
  connect: vi.fn(),
  inbox: [{
    schema_version: 1,
    id: "mobile-inbox-one",
    project_id: "project-one",
    device_id: "device-one",
    operation_id: "operation-note-one",
    base_revision: "revision-one",
    imported_revision: "revision-one",
    payload_digest: `sha256:${"a".repeat(64)}`,
    kind: "capture_note",
    title: "Gate image",
    payload: { content: "Let the gate cast a longer shadow." },
    created_at: "2026-08-30T12:00:00Z",
  }],
  reviews: [{
    schema_version: 1,
    id: "mobile-review-one",
    project_id: "project-one",
    device_id: "device-one",
    operation_id: "operation-review-one",
    base_revision: "revision-one",
    imported_revision: "revision-two",
    payload_digest: `sha256:${"b".repeat(64)}`,
    kind: "review_decision",
    status: "conflict",
    stale: true,
    payload: { target_kind: "proposal", decision: "accepted" },
    created_at: "2026-08-30T12:01:00Z",
  }],
}));

const coordinator = vi.hoisted(() => ({
  getState: vi.fn(() => ({
    status: "setup_required" as const,
    activeKeyVersion: null,
    message: "A device-bound Supabase session is required; secure desktop device-key persistence is not implemented.",
  })),
  provisionProjectKey: vi.fn(),
  unlockRecoveryKey: vi.fn(),
  publishSnapshot: vi.fn(),
  importOutbox: vi.fn(),
}));

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    projectFound: true,
    activeProjectId: "project-one",
    projectRoot: "/project",
    setError: harness.setError,
  }),
}));

vi.mock("../../cloud/account", () => ({
  cloudConfiguration: () => harness.configured ? { url: "https://example.com", publishableKey: "public" } : null,
  desktopAccount: async () => ({ session: harness.session }),
}));
vi.mock("../../mobileSync/connectDesktop", () => ({ connectDesktopMobileSync: harness.connect }));

vi.mock("../../api", () => ({
  listMobileInboxItems: vi.fn(async () => harness.inbox),
  listMobileReviewDecisions: vi.fn(async () => harness.reviews),
}));

vi.mock("../../mobileSync/hostedCoordinator", () => ({
  createHostedMobileSyncCoordinator: vi.fn(() => coordinator),
}));

describe("MobileInboxPanel", () => {
  afterEach(() => {
    cleanup();
    harness.setError.mockReset();
    harness.configured = false;
  });

  it("connects the active book before allowing publication and keeps mobile review read-only", async () => {
    harness.configured = true;
    const publish = vi.fn(async () => ({ snapshot_id: "snapshot-one" }));
    harness.connect.mockResolvedValue({
      ...coordinator,
      getState: () => ({ status: "ready", activeKeyVersion: 3, message: "Desktop connected with an unlocked book key." }),
      publishSnapshot: publish,
    });
    render(<MobileInboxPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" }));
    await waitFor(() => expect(screen.getByText("Desktop connected with an unlocked book key.")).toBeTruthy());
    expect(harness.connect).toHaveBeenCalledWith("project-one", "/project");
    fireEvent.click(screen.getByRole("button", { name: "Publish snapshot" }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Encrypted snapshot published.")).toBeTruthy();
    expect(harness.setError).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });

  it("shows captured items and flags stale review decisions as conflicts", async () => {
    render(<MobileInboxPanel />);

    await waitFor(() => expect(screen.getByText("Gate image")).toBeTruthy());
    expect(screen.getByText("Let the gate cast a longer shadow.")).toBeTruthy();
    expect(screen.getByText("Review decision · accepted")).toBeTruthy();
    expect(screen.getByText("Conflict")).toBeTruthy();
    expect(screen.getByText(/device-bound Supabase session/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Provision key" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Unlock recovery key" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Publish snapshot" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Import outbox" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });
});
