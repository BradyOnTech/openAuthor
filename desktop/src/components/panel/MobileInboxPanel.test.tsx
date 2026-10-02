// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileInboxPanel } from "./MobileInboxPanel";

const harness = vi.hoisted(() => ({
  setError: vi.fn(),
  configured: false,
  projectFound: true,
  session: vi.fn(async () => ({ userId: "user" })),
  rpc: vi.fn(),
  connect: vi.fn(),
  signIn: vi.fn(),
  projectId: "project-one",
  projectRoot: "/project",
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
  getIdentity: vi.fn(() => null),
  unlockRecoveryKey: vi.fn(),
  publishSnapshot: vi.fn(),
  importOutbox: vi.fn(),
}));

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    projectFound: harness.projectFound,
    activeProjectId: harness.projectId,
    projectRoot: harness.projectRoot,
    setError: harness.setError,
  }),
}));

vi.mock("../../cloud/account", async importOriginal => ({
  ...await importOriginal<typeof import("../../cloud/account")>(),
  cloudConfiguration: () => harness.configured ? { url: "https://example.com", publishableKey: "public" } : null,
  desktopAccount: async () => ({ session: harness.session, signIn: harness.signIn, rpc: harness.rpc }),
}));
vi.mock("../../cloud/secretStore", () => ({ hasNativeCredentialStore: () => true }));
vi.mock("../../mobileSync/connectDesktop", () => ({ connectDesktopMobileSync: harness.connect }));

vi.mock("../../api", () => ({
  listMobileInboxItems: vi.fn(async () => harness.inbox),
  listMobileReviewDecisions: vi.fn(async () => harness.reviews),
}));

vi.mock("../../mobileSync/hostedCoordinator", () => ({
  createHostedMobileSyncCoordinator: vi.fn(() => coordinator),
}));

describe("MobileInboxPanel", () => {
  let serial = 0;
  beforeEach(() => { harness.projectRoot = `/synthetic-panel-${++serial}`; harness.connect.mockReset(); harness.signIn.mockReset(); harness.rpc.mockReset(); harness.projectFound = true; harness.session.mockResolvedValue({ userId: "user" }); });
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
    expect(harness.connect).toHaveBeenCalledWith(harness.projectId, harness.projectRoot);
    fireEvent.click(screen.getByRole("button", { name: "Publish snapshot" }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Encrypted snapshot published.")).toBeTruthy();
    expect(harness.setError).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });

  it("keeps account review and sign-in reachable with no open project", async () => {
    harness.configured = true; harness.projectFound = false;
    render(<MobileInboxPanel />);
    expect(screen.getByText("Hosted account deletion")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Companion account" }));
    expect(screen.getByRole("form", { name: "Companion sign-in" })).toBeTruthy();
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it("blocks hosted sync and device management during an account deletion request and after its lost reply", async () => {
    harness.configured = true;
    const userId = "a0000000-0000-4000-8000-000000000001", deviceId = "a0000000-0000-4000-8000-000000000002";
    const workspaceId = "a0000000-0000-4000-8000-000000000004", projectId = "a0000000-0000-4000-8000-000000000005";
    harness.session.mockResolvedValue({ userId, email: "synthetic@example.test", accessToken: `header.${btoa(JSON.stringify({ session_id: "a0000000-0000-4000-8000-000000000003" }))}.signature` } as never);
    let fail!: (reason: Error) => void;
    harness.rpc.mockImplementation(async name => {
      if (name === "mobile_get_account_deletion") return null;
      if (name === "mobile_begin_account_deletion") return new Promise((_, reject) => { fail = reject; });
      return { schema_version: 1, inventory_sha256: "a".repeat(64), inventory: { user_id: userId,
        workspaces: [{ workspace_id: workspaceId, name: "Solo", role: "owner", other_members: 0, other_owners: 0, project_ids: [projectId] }],
        projects: [{ project_id: projectId, workspace_id: workspaceId, name: "Book", needs_rotation: false, previous_key_version: 3, own_outbox_ids: [], project_deletion_job: null }],
        devices: [{ device_id: deviceId, platform: "desktop", device_label: "Computer" }], existing_project_jobs: [],
      } };
    });
    const publish = vi.fn(), importOutbox = vi.fn();
    harness.connect.mockResolvedValue({ ...coordinator, getIdentity: () => ({ userId, deviceId }),
      getState: () => ({ status: "ready", activeKeyVersion: 3, latestKeyVersion: 3, message: "Current book verified." }),
      listDevices: async () => [{ deviceId, keyId: "key", keyAlgorithm: "x25519-v1", publicKey: "public", projectEnrolledAt: "enrolled", projectRevokedAt: null }],
      publishSnapshot: publish, importOutbox,
    });
    const view = render(<MobileInboxPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" })); await screen.findByText("Current book verified.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Review book key rotation" }).hasAttribute("disabled")).toBe(false));
    view.container.querySelector("details")!.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Review hosted account deletion" })); await screen.findByText("Exact hosted inventory");
    fireEvent.click(screen.getByRole("checkbox", { name: /I intend to permanently/ }));
    fireEvent.click(screen.getByRole("button", { name: "Request reviewed account deletion" }));
    await waitFor(() => expect(typeof fail).toBe("function"));
    for (const name of ["Reconnect this desktop", "Publish snapshot", "Import outbox", "Unlock recovery key", "Review book key rotation"]) expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    await act(async () => fail(new Error("Reply lost"))); await screen.findByText("Reply lost");
    for (const name of ["Reconnect this desktop", "Publish snapshot", "Import outbox", "Review book key rotation"]) expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" })); await screen.findByText(/No completed request is confirmed/);
    expect(screen.getByRole("button", { name: "Publish snapshot" }).hasAttribute("disabled")).toBe(true);
    expect(publish).not.toHaveBeenCalled(); expect(importOutbox).not.toHaveBeenCalled();
  });

  it("shows captured items and flags stale review decisions as conflicts", async () => {
    render(<MobileInboxPanel />);

    await waitFor(() => expect(screen.getByText("Gate image")).toBeTruthy());
    expect(screen.getByText("Let the gate cast a longer shadow.")).toBeTruthy();
    expect(screen.getByText("Review decision · accepted")).toBeTruthy();
    expect(screen.getByText("Conflict")).toBeTruthy();
    expect(screen.getByText(/device-bound Supabase session/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review book key rotation" })).toBeNull();
    expect((screen.getByRole("button", { name: "Unlock recovery key" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Publish snapshot" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Import outbox" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });

  it("blocks sync after an unconfirmed device change until the author explicitly refreshes and reviews its state", async () => {
    harness.configured = true;
    const publish = vi.fn(async () => ({ snapshot_id: "snapshot-one" }));
    harness.connect.mockResolvedValue({
      ...coordinator,
      getIdentity: () => ({ userId: "account-one", deviceId: "desktop-one" }),
      getState: () => ({ status: "ready", activeKeyVersion: 3, latestKeyVersion: 3, message: "Current book key verified." }),
      listDevices: async () => [{ deviceId: "desktop-one", keyId: "desktop-key", keyAlgorithm: "x25519-v1", publicKey: "public", projectEnrolledAt: "enrolled", projectRevokedAt: null }],
      provisionProjectKey: async () => { throw new Error("Rotation response lost"); },
      publishSnapshot: publish,
    });
    render(<MobileInboxPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" }));
    await screen.findByRole("button", { name: "Review book key rotation" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Review book key rotation" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Review book key rotation" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this version/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    await screen.findByText(/Rotation response lost/);
    expect(screen.getByRole("button", { name: "Publish snapshot" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Import outbox" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Unlock recovery key" }).hasAttribute("disabled")).toBe(true);
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh trusted devices" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish snapshot" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Publish snapshot" }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  });

  it("restores deliberate Connect after an already-open sign-in completes during rotation and fences the old busy/secret result", async () => {
    harness.configured = true;
    let finishSignIn!: (session: { userId: string; email: string; accessToken: string }) => void;
    harness.signIn.mockImplementation(() => new Promise(resolve => { finishSignIn = resolve; }));
    let finishRotation!: (result: { keyVersion: number; recoveryKey: string; envelopeCount: number }) => void;
    const old = {
      ...coordinator,
      getIdentity: () => ({ userId: "account-one", deviceId: "desktop-one" }),
      getState: () => ({ status: "ready", activeKeyVersion: 3, latestKeyVersion: 3, message: "Old account connected." }),
      listDevices: async () => [{ deviceId: "desktop-one", keyId: "desktop-key", keyAlgorithm: "x25519-v1", publicKey: "public", projectEnrolledAt: "enrolled", projectRevokedAt: null }],
      provisionProjectKey: vi.fn(() => new Promise<{ keyVersion: number; recoveryKey: string; envelopeCount: number }>(resolve => { finishRotation = resolve; })),
    };
    harness.connect.mockResolvedValue(old);
    render(<MobileInboxPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" }));
    await screen.findByText("Old account connected.");
    fireEvent.click(screen.getByRole("button", { name: "Companion account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
    fireEvent.submit(screen.getByRole("form", { name: "Companion sign-in" }));
    await waitFor(() => expect(harness.signIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review book key rotation" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Review book key rotation" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this version/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    await waitFor(() => expect(old.provisionProjectKey).toHaveBeenCalledTimes(1));
    await act(async () => finishSignIn({ userId: "account-two", email: "synthetic@example.invalid", accessToken: "synthetic-token" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect this desktop" }).hasAttribute("disabled")).toBe(false));
    await act(async () => finishRotation({ keyVersion: 4, recoveryKey: "late-old-account-secret", envelopeCount: 1 }));
    expect(screen.queryByText("late-old-account-secret")).toBeNull();
    expect(screen.queryByText("Old account connected.")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect this desktop" }).hasAttribute("disabled")).toBe(false);
    // Return to the original synthetic scope. Its nonsecret completion remains,
    // but a reset must not let a later reply reinstate its forgotten key.
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" }));
    await screen.findByText("Old account connected.");
    await screen.findByText(/Book key 4 created/);
    expect(screen.queryByText("late-old-account-secret")).toBeNull();
  });

  it("does not let an old account's Connect completion clear the new account's busy state or replace its coordinator", async () => {
    harness.configured = true;
    let finishSignIn!: (session: { userId: string; email: string; accessToken: string }) => void;
    harness.signIn.mockImplementation(() => new Promise(resolve => { finishSignIn = resolve; }));
    let oldConnect!: (value: unknown) => void;
    let newConnect!: (value: unknown) => void;
    harness.connect.mockImplementationOnce(() => new Promise(resolve => { oldConnect = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { newConnect = resolve; }));
    render(<MobileInboxPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Companion account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
    fireEvent.submit(screen.getByRole("form", { name: "Companion sign-in" }));
    await waitFor(() => expect(harness.signIn).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" }));
    await waitFor(() => expect(harness.connect).toHaveBeenCalledTimes(1));
    await act(async () => finishSignIn({ userId: "account-two", email: "synthetic@example.invalid", accessToken: "synthetic-token" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" }));
    await waitFor(() => expect(harness.connect).toHaveBeenCalledTimes(2));
    await act(async () => oldConnect({ ...coordinator, getState: () => ({ status: "ready", activeKeyVersion: 3, message: "Old connection must stay hidden." }) }));
    expect(screen.queryByText("Old connection must stay hidden.")).toBeNull();
    expect(screen.getByRole("button", { name: "Working…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => newConnect({ ...coordinator, getState: () => ({ status: "ready", activeKeyVersion: 5, message: "New account connected deliberately." }) }));
    await screen.findByText("New account connected deliberately.");
    expect(screen.getByRole("button", { name: "Reconnect this desktop" }).hasAttribute("disabled")).toBe(false);
  });

  it("redacts recovery input on account reset even when the initial disconnected coordinator does not change", async () => {
    harness.configured = true;
    harness.signIn.mockResolvedValue({ userId: "account-two", email: "synthetic@example.invalid", accessToken: "synthetic-token" });
    render(<MobileInboxPanel />);
    fireEvent.change(screen.getByLabelText("Recovery key", { exact: true }), { target: { value: "old-account-synthetic-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Companion account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
    fireEvent.submit(screen.getByRole("form", { name: "Companion sign-in" }));
    await waitFor(() => expect((screen.getByLabelText("Recovery key", { exact: true }) as HTMLInputElement).value).toBe(""));
    expect(screen.getByRole("button", { name: "Connect this desktop" }).hasAttribute("disabled")).toBe(false);
  });

  it("retains recoverable input on a same-account unlock refusal without logging or storing the candidate", async () => {
    harness.configured = true;
    const unlock = vi.fn(async () => { throw new Error("The recovery key does not match this book's verified current key."); });
    harness.connect.mockResolvedValue({ ...coordinator, unlockRecoveryKey: unlock,
      getState: () => ({ status: "ready", activeKeyVersion: 3, message: "Current book key remains verified." }),
    });
    render(<MobileInboxPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Connect this desktop" })); await screen.findByText("Current book key remains verified.");
    fireEvent.change(screen.getByLabelText("Recovery key version"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Recovery key", { exact: true }), { target: { value: "synthetic-wrong-book-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock recovery key" }));
    await waitFor(() => expect(harness.setError).toHaveBeenCalledWith(expect.stringContaining("does not match")));
    expect((screen.getByLabelText("Recovery key", { exact: true }) as HTMLInputElement).value).toBe("synthetic-wrong-book-key");
    expect(JSON.stringify(harness.setError.mock.calls)).not.toContain("synthetic-wrong-book-key");
    expect(JSON.stringify(localStorage)).not.toContain("synthetic-wrong-book-key");
  });
});
