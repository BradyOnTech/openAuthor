// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDeletionPanel } from "./AccountDeletionPanel";
import { CompanionRpcRefusal } from "../../cloud/account";

const fixture = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), onIdentityChange: vi.fn(), enrollAccount: vi.fn(), listener: null as (() => void) | null, unsubscribe: vi.fn() }));
vi.mock("../../cloud/account", async importOriginal => ({ ...await importOriginal<typeof import("../../cloud/account")>(), cloudConfiguration: () => ({ url: "https://synthetic.invalid", publishableKey: "synthetic" }), desktopAccount: async () => fixture }));
vi.mock("../../cloud/secretStore", () => ({ deploymentScope: async () => "a".repeat(64), nativeSecrets: {} }));
vi.mock("../../cloud/desktopEnrollment", () => ({ enrollDesktopAccount: fixture.enrollAccount }));
const uuid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: uuid(1), deviceId: uuid(2) };
const session = { userId: identity.userId, email: "synthetic@example.test", accessToken: `header.${btoa(JSON.stringify({ session_id: uuid(3) }))}.signature` };
function inventory(otherOwners = 1) {
  return { schema_version: 1, inventory_sha256: "a".repeat(64), inventory: { user_id: identity.userId,
    workspaces: [{ workspace_id: uuid(4), name: "Solo workspace", role: "owner", other_members: 0, other_owners: 0, project_ids: [uuid(5)] }, { workspace_id: uuid(7), name: "Shared workspace", role: "owner", other_members: 1, other_owners: otherOwners, project_ids: [uuid(8)] }],
    projects: [{ project_id: uuid(5), workspace_id: uuid(4), name: "Solo book", needs_rotation: false, previous_key_version: 1, own_outbox_ids: [], project_deletion_job: null }, { project_id: uuid(8), workspace_id: uuid(7), name: "Shared book", needs_rotation: true, previous_key_version: 3, own_outbox_ids: [uuid(9)], project_deletion_job: null }],
    devices: [{ device_id: identity.deviceId, platform: "desktop", device_label: "Computer", private_key: "never render this fingerprint-only extra" }],
    existing_project_jobs: [{ job_id: uuid(10), project_id: uuid(11), workspace_id: null, phase: "finalized" }],
  } };
}
function progress() { return { job_id: uuid(6), phase: "awaiting_shared_rotation", inventory_sha256: "a".repeat(64), blockers: ["shared_rotation_required"], projects: [{ project_id: uuid(8), name: "Shared book", action: "retain", phase: "awaiting_rotation", needs_rotation: true, blockers: ["key_rotation_required"] }] }; }
function amendableProgress() { return { ...progress(), phase: "auth_ready", original_inventory_sha256: "a".repeat(64), amendment_revision: 0, amendment_receipt: null }; }
function changedScope() { return { schema_version: 1, job_id: uuid(6), phase: "auth_ready", base_revision: 0,
  original_inventory_sha256: "a".repeat(64), intent_sha256: "a".repeat(64), review_sha256: "b".repeat(64), foreign_workspace_name: "Never expose destination names",
  projects: [
    { project_id: uuid(8), name: "Shared book", reviewed_workspace_id: uuid(7), effective_workspace_id: uuid(7), current_workspace_id: uuid(21), resolution: "retained", needs_rotation: true, previous_key_version: 3, active_key_version: 4, remaining_owner: true, independent_deletion: null, allowed_resolution: "retain_current_scope", blockers: [] },
    { project_id: uuid(22), name: "Previously retained book", reviewed_workspace_id: uuid(7), effective_workspace_id: uuid(7), current_workspace_id: null, resolution: "retained", needs_rotation: true, previous_key_version: 3, active_key_version: null, remaining_owner: false, independent_deletion: { job_id: uuid(23), phase: "finalized", backend_verification_sha256: "d".repeat(64) }, allowed_resolution: "attach_finalized_deletion", blockers: [] },
    { project_id: uuid(24), name: "Unverified absent book", reviewed_workspace_id: uuid(7), effective_workspace_id: uuid(7), current_workspace_id: null, resolution: "retained", needs_rotation: false, previous_key_version: 0, active_key_version: null, remaining_owner: false, independent_deletion: null, allowed_resolution: null, blockers: ["Independent deletion verification required"] },
  ] }; }
function amendedProgress(amendmentId: string) { return { ...amendableProgress(), phase: "deleting", inventory_sha256: "c".repeat(64), amendment_revision: 1,
  amendment_receipt: { amendment_id: amendmentId, revision: 1, review_sha256: "b".repeat(64), intent_sha256: "c".repeat(64) } }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function opened(props: { identity: typeof identity | null; disabled: boolean; onRequested: () => void } = { identity, disabled: false, onRequested: vi.fn() }) {
  const result = render(<AccountDeletionPanel {...props} />); result.container.querySelector("details")!.open = true; return result;
}
async function reviewed() { fireEvent.click(screen.getByRole("button", { name: "Review hosted account deletion" })); await screen.findByText("Exact hosted inventory"); }
function acknowledge() { fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed the retained/ })); fireEvent.click(screen.getByRole("checkbox", { name: /I intend to permanently/ })); }
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); fixture.listener = null; fixture.session.mockResolvedValue(session);
  fixture.enrollAccount.mockResolvedValue(identity);
  fixture.onIdentityChange.mockImplementation(listener => { fixture.listener = listener; return fixture.unsubscribe; });
  fixture.rpc.mockImplementation(async name => name === "mobile_get_account_deletion" ? null : name === "mobile_account_deletion_preflight" ? inventory() : progress());
});
describe("hosted account deletion review", () => {
  it("requires both scope confirmations and submits every exact disposition without touching a manuscript", async () => {
    const onRequested = vi.fn(); opened({ identity, disabled: false, onRequested }); await reviewed();
    const button = screen.getByRole("button", { name: "Request reviewed account deletion" }); expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/never render this/)).toBeNull();
    expect(screen.getByText("Previously approved book deletion")).toBeTruthy();
    expect(screen.getByText(uuid(11))).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "remove" } }); acknowledge(); fireEvent.click(button);
    await screen.findByRole("region", { name: "Account deletion progress" }); expect(onRequested).toHaveBeenCalledOnce();
    expect(fixture.rpc).toHaveBeenCalledWith("mobile_begin_account_deletion", { p_requesting_device_id: identity.deviceId, p_expected_inventory_sha256: "a".repeat(64), p_acknowledge_retained_history: true, p_dispositions: { workspaces: [{ workspace_id: uuid(4), action: "delete" }, { workspace_id: uuid(7), action: "leave" }], projects: [{ project_id: uuid(5), action: "delete", outbox: "preserve" }, { project_id: uuid(8), action: "retain", outbox: "remove" }] } });
    expect(screen.getByText(/Local manuscript folders stay/)).toBeTruthy();
  });
  it("blocks a sole shared owner until handoff instead of silently deleting others' work", async () => {
    fixture.rpc.mockImplementation(async name => name === "mobile_get_account_deletion" ? null : inventory(0)); opened(); await reviewed();
    expect(screen.getByText(/Assign another owner/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Request reviewed account deletion" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.rpc.mock.calls.some(([name]) => name === "mobile_begin_account_deletion")).toBe(false);
  });
  it("resets confirmations when a pending-capture choice changes", async () => {
    opened(); await reviewed(); acknowledge(); fireEvent.change(screen.getByRole("combobox"), { target: { value: "remove" } });
    expect((screen.getByRole("checkbox", { name: /I reviewed the retained/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /I intend to permanently/ }) as HTMLInputElement).checked).toBe(false);
  });
  it("blocks other hosted actions before requesting, preserves an uncertain review, and confirms only positive owned status", async () => {
    const onRequestPending = vi.fn();
    const result = render(<AccountDeletionPanel identity={identity} disabled={false} onRequested={vi.fn()} onRequestPending={onRequestPending} />);
    result.container.querySelector("details")!.open = true;
    await reviewed(); acknowledge(); fixture.rpc.mockRejectedValueOnce(new Error("Reply lost"));
    fireEvent.click(screen.getByRole("button", { name: "Request reviewed account deletion" })); await screen.findByText("Reply lost");
    expect(onRequestPending).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" })); await screen.findByText(/No completed request is confirmed/);
    expect(screen.getByText("Exact hosted inventory")).toBeTruthy(); expect((screen.getByRole("button", { name: "Review hosted account deletion" }) as HTMLButtonElement).disabled).toBe(true);
    fixture.rpc.mockResolvedValueOnce(progress()); fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" })); await screen.findByRole("region", { name: "Account deletion progress" });
    expect(fixture.rpc.mock.calls.filter(([name]) => name === "mobile_begin_account_deletion")).toHaveLength(1);
  });
  it("reads durable owned progress with no connected or active device", async () => {
    fixture.rpc.mockResolvedValue(progress()); opened({ identity: null, disabled: false, onRequested: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" })); await screen.findByRole("region", { name: "Account deletion progress" });
    expect(fixture.rpc).toHaveBeenCalledWith("mobile_get_account_deletion", { p_job_id: null });
    expect(fixture.session).toHaveBeenCalledWith({ userId: identity.userId });
    expect(fixture.enrollAccount).not.toHaveBeenCalled();
  });
  it("reviews and requests an empty hosted account without needing a hosted book", async () => {
    const empty = { schema_version: 1, inventory_sha256: "a".repeat(64), inventory: { user_id: identity.userId, workspaces: [], projects: [], devices: inventory().inventory.devices, existing_project_jobs: [] } };
    fixture.rpc.mockImplementation(async name => name === "mobile_get_account_deletion" ? null : name === "mobile_account_deletion_preflight" ? empty : { ...progress(), projects: [] });
    opened({ identity: null, disabled: false, onRequested: vi.fn() }); await reviewed();
    expect(fixture.enrollAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: identity.userId }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I intend to permanently/ }));
    fireEvent.click(screen.getByRole("button", { name: "Request reviewed account deletion" }));
    await screen.findByRole("region", { name: "Account deletion progress" });
    expect(fixture.rpc).toHaveBeenCalledWith("mobile_begin_account_deletion", expect.objectContaining({ p_requesting_device_id: identity.deviceId, p_dispositions: { workspaces: [], projects: [] } }));
  });
  it("redacts review and withholds a late submitted result after Auth identity changes", async () => {
    const onRequested = vi.fn(), pending = deferred<ReturnType<typeof progress>>(); opened({ identity, disabled: false, onRequested }); await reviewed(); acknowledge();
    fixture.rpc.mockReturnValueOnce(pending.promise); fireEvent.click(screen.getByRole("button", { name: "Request reviewed account deletion" }));
    await waitFor(() => expect(fixture.rpc.mock.calls.some(([name]) => name === "mobile_begin_account_deletion")).toBe(true));
    act(() => fixture.listener?.()); await act(async () => pending.resolve(progress()));
    expect(screen.queryByText("Solo book")).toBeNull(); expect(screen.queryByRole("region", { name: "Account deletion progress" })).toBeNull(); expect(onRequested).not.toHaveBeenCalled();
  });
  it("drops late preflight on account/device scope replacement and unsubscribes on unmount", async () => {
    const pending = deferred<ReturnType<typeof inventory>>(); fixture.rpc.mockImplementation(async name => name === "mobile_get_account_deletion" ? null : pending.promise);
    const result = opened(); fireEvent.click(screen.getByRole("button", { name: "Review hosted account deletion" }));
    await waitFor(() => expect(fixture.rpc).toHaveBeenCalledWith("mobile_account_deletion_preflight", expect.anything()));
    result.rerender(<AccountDeletionPanel identity={{ userId: uuid(99), deviceId: uuid(98) }} disabled={false} onRequested={vi.fn()} />);
    await act(async () => pending.resolve(inventory())); expect(screen.queryByText("Solo book")).toBeNull(); result.unmount(); expect(fixture.unsubscribe).toHaveBeenCalled();
  });
});

describe("changed shared-book scope review", () => {
  let acceptedId = "";
  async function openReview() {
    opened({ identity: null, disabled: false, onRequested: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" }));
    await screen.findByRole("region", { name: "Account deletion progress" });
    fireEvent.click(screen.getByRole("button", { name: "Review changed shared books" }));
    await screen.findByRole("region", { name: "Changed shared-book scope review" });
  }
  function selectCorrections() {
    fireEvent.click(screen.getByRole("checkbox", { name: "Use this current workspace for retained shared history" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Record this exact independently finalized deletion receipt" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed the selected shared-book corrections/ }));
  }
  beforeEach(() => {
    acceptedId = "";
    fixture.rpc.mockImplementation(async (name, args) => {
      if (name === "mobile_get_account_deletion") return acceptedId ? amendedProgress(acceptedId) : amendableProgress();
      if (name === "mobile_account_deletion_amendment_preflight") return changedScope();
      acceptedId = args.p_amendment_id;
      return amendedProgress(acceptedId).amendment_receipt;
    });
  });
  it("starts with no selected correction and submits only explicitly reviewed scope and receipt", async () => {
    await openReview();
    const submit = screen.getByRole("button", { name: "Confirm reviewed shared-book corrections" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); expect(screen.queryByText(/Never expose/)).toBeNull();
    expect(screen.getByText("Unverified absent book")).toBeTruthy(); expect(screen.getByText("Independent deletion verification required")).toBeTruthy();
    expect(fixture.enrollAccount).not.toHaveBeenCalled();
    selectCorrections(); expect(submit.disabled).toBe(false);
    fireEvent.click(submit); await screen.findByText(/Shared-book correction confirmed/);
    const call = fixture.rpc.mock.calls.find(([name]) => name === "mobile_amend_account_deletion")!;
    expect(call[1]).toEqual({ p_job_id: uuid(6), p_amendment_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_expected_revision: 0, p_expected_review_sha256: "b".repeat(64), p_resolutions: [
      { project_id: uuid(8), resolution: "retain_current_scope", workspace_id: uuid(21) },
      { project_id: uuid(22), resolution: "attach_finalized_deletion", project_job_id: uuid(23), backend_verification_sha256: "d".repeat(64) },
    ] });
    expect(screen.getByText("Reviewed request revision: 1")).toBeTruthy();
    expect(fixture.rpc.mock.calls.some(([name]) => name === "mobile_begin_account_deletion")).toBe(false);
  });
  it("resets final confirmation when the selected correction changes", async () => {
    await openReview(); selectCorrections();
    fireEvent.click(screen.getByRole("checkbox", { name: "Record this exact independently finalized deletion receipt" }));
    expect((screen.getByRole("checkbox", { name: /I reviewed the selected shared-book corrections/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Confirm reviewed shared-book corrections" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps an uncertain correction pending despite readable older progress and accepts only the exact receipt", async () => {
    await openReview(); selectCorrections(); fixture.rpc.mockRejectedValueOnce(new Error("Correction reply lost"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed shared-book corrections" })); await screen.findByText("Correction reply lost");
    const call = fixture.rpc.mock.calls.find(([name]) => name === "mobile_amend_account_deletion")!;
    fixture.rpc.mockImplementation(async name => name === "mobile_get_account_deletion_amendment" ? null : amendableProgress());
    fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" })); await screen.findByText(/existing account request does not confirm/);
    expect(screen.getByRole("region", { name: "Changed shared-book scope review" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review changed shared books" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Confirm reviewed shared-book corrections" }) as HTMLButtonElement).disabled).toBe(true);
    fixture.rpc.mockImplementation(async name => name === "mobile_get_account_deletion_amendment" ? amendedProgress(call[1].p_amendment_id).amendment_receipt : amendedProgress(call[1].p_amendment_id));
    fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" })); await screen.findByText(/correction 1 is confirmed/);
    expect(screen.queryByRole("region", { name: "Changed shared-book scope review" })).toBeNull();
    expect(fixture.rpc.mock.calls.filter(([name]) => name === "mobile_amend_account_deletion")).toHaveLength(1);
  });
  it("permits a fresh review after a known transaction rejection without automatic retry", async () => {
    await openReview(); selectCorrections(); fixture.rpc.mockRejectedValueOnce(new CompanionRpcRefusal());
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed shared-book corrections" })); await screen.findByText(/shared-book correction was refused/);
    expect(screen.queryByText(/correction may have reached/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Changed shared-book scope review" })).toBeNull();
    expect((screen.getByRole("button", { name: "Review changed shared books" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fixture.rpc.mock.calls.filter(([name]) => name === "mobile_amend_account_deletion")).toHaveLength(1);
  });
  it("redacts a submitted review and ignores a late correction after account replacement", async () => {
    await openReview(); selectCorrections(); const pending = deferred<ReturnType<typeof amendedProgress>>();
    fixture.rpc.mockImplementationOnce((_name, args) => pending.promise.then(() => amendedProgress(args.p_amendment_id).amendment_receipt));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed shared-book corrections" }));
    await waitFor(() => expect(fixture.rpc.mock.calls.some(([name]) => name === "mobile_amend_account_deletion")).toBe(true));
    act(() => fixture.listener?.()); await act(async () => pending.resolve(amendedProgress(uuid(99))));
    expect(screen.queryByRole("region", { name: "Changed shared-book scope review" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Account deletion progress" })).toBeNull();
    expect(screen.queryByText(/correction confirmed/)).toBeNull();
  });
  it("retains the internally enrolled account client through a lost correction reply while disconnected", async () => {
    let owned: ReturnType<typeof amendableProgress> | ReturnType<typeof amendedProgress> | null = null;
    let receipt: ReturnType<typeof amendedProgress>["amendment_receipt"] | null = null;
    fixture.rpc.mockImplementation(async (name, args) => {
      if (name === "mobile_get_account_deletion") return owned;
      if (name === "mobile_account_deletion_preflight") return inventory();
      if (name === "mobile_begin_account_deletion") { owned = amendableProgress(); return owned; }
      if (name === "mobile_account_deletion_amendment_preflight") return changedScope();
      if (name === "mobile_amend_account_deletion") { owned = amendedProgress(args.p_amendment_id); receipt = owned.amendment_receipt; throw new Error("Enrolled account correction reply lost"); }
      if (name === "mobile_get_account_deletion_amendment") return receipt;
      throw new Error("Unexpected account operation");
    });
    opened({ identity: null, disabled: false, onRequested: vi.fn() }); await reviewed(); acknowledge();
    fireEvent.click(screen.getByRole("button", { name: "Request reviewed account deletion" })); await screen.findByRole("region", { name: "Account deletion progress" });
    fireEvent.click(screen.getByRole("button", { name: "Review changed shared books" })); await screen.findByRole("region", { name: "Changed shared-book scope review" });
    selectCorrections(); fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed shared-book corrections" }));
    await screen.findByText("Enrolled account correction reply lost");
    fireEvent.click(screen.getByRole("button", { name: "Check account deletion status" })); await screen.findByText(/correction 1 is confirmed/);
    expect(fixture.enrollAccount).toHaveBeenCalledOnce();
    expect(fixture.rpc.mock.calls.filter(([name]) => name === "mobile_amend_account_deletion")).toHaveLength(1);
    expect(fixture.rpc.mock.calls.some(([name]) => name === "mobile_get_account_deletion_amendment")).toBe(true);
  });
});
