import { describe, expect, it, vi } from "vitest";
import { createAccountDeletionClient, type AccountDeletionChoices } from "./accountDeletion";
import { CompanionRpcRefusal, type CompanionAccount } from "./account";

const uuid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = uuid(1), device = uuid(2), session = uuid(3), workspace = uuid(4), project = uuid(5);
const token = (id = session) => `header.${btoa(JSON.stringify({ session_id: id }))}.signature`;
const review = () => ({ schema_version: 1, inventory_sha256: "a".repeat(64), inventory: { user_id: user,
  workspaces: [{ workspace_id: workspace, name: "Shared", role: "owner", other_members: 1, other_owners: 1, project_ids: [project] }],
  projects: [{ project_id: project, workspace_id: workspace, name: "Book", needs_rotation: true, previous_key_version: 3, own_outbox_ids: [], project_deletion_job: null }],
  devices: [{ device_id: device, platform: "desktop", device_label: "My computer" }],
  existing_project_jobs: [] as Array<{ job_id: string; project_id: string; workspace_id: string | null; phase: string }>,
} });
const status = () => ({ job_id: uuid(6), phase: "awaiting_shared_rotation", inventory_sha256: "a".repeat(64), blockers: ["shared_rotation_required"], projects: [{ project_id: project, name: "Book", action: "retain", phase: "awaiting_rotation", needs_rotation: true, blockers: ["key_rotation_required"] }] });
const choices: AccountDeletionChoices = { workspaces: [{ workspace_id: workspace, action: "leave" }], projects: [{ project_id: project, action: "retain", outbox: "preserve" }] };
const amendedWorkspace = uuid(20);
function amendmentReview() {
  return { schema_version: 1, job_id: uuid(6), phase: "deleting", base_revision: 0,
    original_inventory_sha256: "a".repeat(64), intent_sha256: "a".repeat(64), review_sha256: "b".repeat(64),
    projects: [{ project_id: project, name: "Book", reviewed_workspace_id: workspace,
      effective_workspace_id: workspace, current_workspace_id: amendedWorkspace, resolution: "retained",
      needs_rotation: true, previous_key_version: 3, active_key_version: 4, remaining_owner: true,
      independent_deletion: null, allowed_resolution: "retain_current_scope", blockers: [] }],
  };
}
const resolutions = [{ project_id: project, resolution: "retain_current_scope", workspace_id: amendedWorkspace }] as const;
function amendmentStatus(amendmentId: string, revision = 1) {
  return { ...status(), phase: "deleting", inventory_sha256: "c".repeat(64), original_inventory_sha256: "a".repeat(64),
    amendment_revision: revision, amendment_receipt: { amendment_id: amendmentId, revision, review_sha256: "b".repeat(64), intent_sha256: "c".repeat(64) } };
}
function fixture() {
  const account: CompanionAccount = { session: vi.fn(async () => ({ userId: user, email: "synthetic@example.test", accessToken: token() })), signIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn(), rpc: vi.fn(async name => name === "mobile_account_deletion_preflight" ? review() : name === "mobile_begin_account_deletion" ? status() : null) };
  return { account, client: createAccountDeletionClient(account, { userId: user, deviceId: device }) };
}
describe("reviewed account deletion client", () => {
  it("keeps exact inventory fingerprint and explicit retained-history choices in the request", async () => {
    const f = fixture(), loaded = await f.client.preflight();
    expect(await f.client.begin(loaded, choices, true)).toEqual(status());
    expect(f.account.rpc).toHaveBeenLastCalledWith("mobile_begin_account_deletion", { p_requesting_device_id: device, p_expected_inventory_sha256: "a".repeat(64), p_dispositions: choices, p_acknowledge_retained_history: true });
  });
  it("reads owned progress without active-device authorization after self-revocation", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValue(status());
    expect(await f.client.current()).toEqual(status());
    expect(f.account.session).toHaveBeenCalledWith({ userId: user });
    expect(f.account.rpc).toHaveBeenCalledWith("mobile_get_account_deletion", { p_job_id: null });
  });
  it("refuses a switched account before any request", async () => {
    const f = fixture(); vi.mocked(f.account.session).mockResolvedValue({ userId: uuid(99), email: "", accessToken: token() });
    await expect(f.client.preflight()).rejects.toThrow(/could not be verified/); expect(f.account.rpc).not.toHaveBeenCalled();
  });
  it("withholds a late preflight when the verified Auth session changed", async () => {
    const f = fixture(); vi.mocked(f.account.session).mockResolvedValueOnce({ userId: user, email: "", accessToken: token() }).mockResolvedValueOnce({ userId: user, email: "", accessToken: token(uuid(99)) });
    await expect(f.client.preflight()).rejects.toThrow(/could not be verified/);
  });
  it("keeps a lost begin reply unresolved and prevents retry or silently refreshed preconditions", async () => {
    const f = fixture(), loaded = await f.client.preflight(); vi.mocked(f.account.rpc).mockRejectedValueOnce(new Error("Lost response"));
    await expect(f.client.begin(loaded, choices, true)).rejects.toThrow("Lost response");
    await expect(f.client.begin(loaded, choices, true)).rejects.toThrow(/could not be verified/);
    await expect(f.client.preflight()).rejects.toThrow(/could not be verified/);
    vi.mocked(f.account.rpc).mockResolvedValue(status()); expect(await f.client.current()).toEqual(status());
    expect(vi.mocked(f.account.rpc).mock.calls.filter(([name]) => name === "mobile_begin_account_deletion")).toHaveLength(1);
  });
  it("rejects a receipt for a different reviewed inventory", async () => {
    const f = fixture(), loaded = await f.client.preflight(); vi.mocked(f.account.rpc).mockResolvedValue({ ...status(), inventory_sha256: "b".repeat(64) });
    await expect(f.client.begin(loaded, choices, true)).rejects.toThrow(/could not be verified/);
  });
  it("preserves original begin intent when a durable amendment already superseded its effective digest", async () => {
    const f = fixture(), loaded = await f.client.preflight();
    vi.mocked(f.account.rpc).mockResolvedValue(amendmentStatus(uuid(30)));
    expect((await f.client.begin(loaded, choices, true)).inventory_sha256).toBe("c".repeat(64));
    expect(f.account.rpc).toHaveBeenLastCalledWith("mobile_begin_account_deletion", expect.objectContaining({ p_expected_inventory_sha256: "a".repeat(64) }));
  });
  it("retains a historical deletion job after its workspace has been removed", async () => {
    const f = fixture();
    const data = review();
    data.inventory.existing_project_jobs.push({ job_id: uuid(7), project_id: uuid(8), workspace_id: null, phase: "finalized" });
    vi.mocked(f.account.rpc).mockResolvedValue(data);
    const loaded = await f.client.preflight();
    expect(loaded.inventory.existing_project_jobs).toEqual(data.inventory.existing_project_jobs);
    data.inventory.existing_project_jobs.push({ job_id: uuid(7), project_id: uuid(9), workspace_id: null, phase: "finalized" });
    await expect(f.client.preflight()).rejects.toThrow(/could not be verified/);
  });
  it.each(["wrong-user", "duplicate-project", "foreign-workspace-project", "bad-owner-count", "missing-device-id"])("withholds malformed inventory: %s", async variant => {
    const f = fixture(), data = review();
    if (variant === "wrong-user") data.inventory.user_id = uuid(99);
    if (variant === "duplicate-project") data.inventory.projects.push(data.inventory.projects[0]);
    if (variant === "foreign-workspace-project") data.inventory.workspaces[0].project_ids.push(uuid(99));
    if (variant === "bad-owner-count") data.inventory.workspaces[0].other_owners = 2;
    if (variant === "missing-device-id") data.inventory.devices[0].device_id = "";
    vi.mocked(f.account.rpc).mockResolvedValue(data); await expect(f.client.preflight()).rejects.toThrow(/could not be verified/);
  });
  it("withholds status returned after account identity changed", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValue(status());
    vi.mocked(f.account.session).mockResolvedValueOnce({ userId: user, email: "", accessToken: token() }).mockResolvedValueOnce(null);
    await expect(f.client.current()).rejects.toThrow(/could not be verified/);
  });
});

describe("reviewed retained-scope amendment client", () => {
  it("reviews a frozen owned account without requiring an active device and withholds foreign display extras", async () => {
    const f = fixture(), data = { ...amendmentReview(), foreign_member_names: ["Never display"] };
    vi.mocked(f.account.rpc).mockResolvedValue(data);
    const value = await f.client.amendmentPreflight(uuid(6));
    expect(value).toEqual(amendmentReview());
    expect(f.account.rpc).toHaveBeenCalledWith("mobile_account_deletion_amendment_preflight", { p_job_id: uuid(6) });
    expect(f.account.session).toHaveBeenCalledWith({ userId: user });
  });
  it("submits the loaded revision, review digest and exact selected scope only once", async () => {
    const f = fixture(); let submitted = "";
    vi.mocked(f.account.rpc).mockImplementation(async (name, args) => {
      if (name === "mobile_account_deletion_amendment_preflight") return amendmentReview();
      if (name === "mobile_amend_account_deletion") { submitted = args.p_amendment_id as string; return amendmentStatus(submitted).amendment_receipt; }
      return amendmentStatus(submitted);
    });
    const loaded = await f.client.amendmentPreflight(uuid(6));
    const result = await f.client.amend(loaded, [...resolutions]);
    const request = vi.mocked(f.account.rpc).mock.calls.find(([name]) => name === "mobile_amend_account_deletion")![1];
    expect(request).toEqual({ p_job_id: uuid(6), p_amendment_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_expected_revision: 0,
      p_expected_review_sha256: "b".repeat(64), p_resolutions: resolutions });
    expect(result.amendment_receipt?.amendment_id).toBe(request.p_amendment_id);
  });
  it("keeps a lost correction unresolved when the older original job is still readable", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValueOnce(amendmentReview());
    const loaded = await f.client.amendmentPreflight(uuid(6));
    vi.mocked(f.account.rpc).mockRejectedValueOnce(new Error("Amendment reply lost"));
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow("Amendment reply lost");
    vi.mocked(f.account.rpc).mockImplementation(async name => name === "mobile_get_account_deletion_amendment" ? null : { ...status(), original_inventory_sha256: "a".repeat(64), amendment_revision: 0, amendment_receipt: null });
    expect((await f.client.resolveAmendment()).receipt).toBeNull();
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow(/could not be verified/);
    await expect(f.client.amendmentPreflight(uuid(6))).rejects.toThrow(/could not be verified/);
    expect(vi.mocked(f.account.rpc).mock.calls.filter(([name]) => name === "mobile_amend_account_deletion")).toHaveLength(1);
  });
  it("confirms an exact lost receipt even when a later amendment superseded it", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValueOnce(amendmentReview());
    const loaded = await f.client.amendmentPreflight(uuid(6));
    vi.mocked(f.account.rpc).mockRejectedValueOnce(new Error("Lost"));
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow("Lost");
    const request = vi.mocked(f.account.rpc).mock.calls.find(([name]) => name === "mobile_amend_account_deletion")![1];
    const receipt = amendmentStatus(request.p_amendment_id as string).amendment_receipt;
    vi.mocked(f.account.rpc).mockImplementation(async name => name === "mobile_get_account_deletion_amendment" ? receipt : amendmentStatus(uuid(31), 2));
    const confirmed = await f.client.resolveAmendment();
    expect(confirmed.receipt).toEqual(receipt); expect(confirmed.progress.amendment_revision).toBe(2);
    expect(f.account.rpc).toHaveBeenCalledWith("mobile_get_account_deletion_amendment", { p_job_id: uuid(6), p_amendment_id: request.p_amendment_id });
    vi.mocked(f.account.rpc).mockResolvedValue(amendmentReview());
    await expect(f.client.amendmentPreflight(uuid(6))).resolves.toEqual(amendmentReview());
  });
  it("refuses malformed or broadened selected resolutions before a mutation", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValue(amendmentReview());
    const loaded = await f.client.amendmentPreflight(uuid(6));
    for (const choice of [[], [...resolutions, ...resolutions], [{ ...resolutions[0], workspace_id: uuid(99) }], [{ ...resolutions[0], outbox: "remove" }]]) {
      await expect(f.client.amend(loaded, choice)).rejects.toThrow(/could not be verified/);
    }
    expect(vi.mocked(f.account.rpc).mock.calls.some(([name]) => name === "mobile_amend_account_deletion")).toBe(false);
  });
  it("allows a fresh explicit review after an authoritative transaction rejection without retrying", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValueOnce(amendmentReview());
    const loaded = await f.client.amendmentPreflight(uuid(6));
    vi.mocked(f.account.rpc).mockRejectedValueOnce(new CompanionRpcRefusal());
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow(/was refused/);
    expect(f.client.amendmentPending).toBe(false);
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow(/could not be verified/);
    vi.mocked(f.account.rpc).mockResolvedValue(amendmentReview());
    await expect(f.client.amendmentPreflight(uuid(6))).resolves.toEqual(amendmentReview());
    expect(vi.mocked(f.account.rpc).mock.calls.filter(([name]) => name === "mobile_amend_account_deletion")).toHaveLength(1);
  });
  it("reserves one amendment across concurrent session checks", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValueOnce(amendmentReview());
    const loaded = await f.client.amendmentPreflight(uuid(6));
    vi.mocked(f.account.rpc).mockRejectedValue(new Error("Lost reply"));
    const attempts = await Promise.allSettled([f.client.amend(loaded, [...resolutions]), f.client.amend(loaded, [...resolutions])]);
    expect(attempts.every(value => value.status === "rejected")).toBe(true);
    expect(vi.mocked(f.account.rpc).mock.calls.filter(([name]) => name === "mobile_amend_account_deletion")).toHaveLength(1);
    expect(f.client.amendmentPending).toBe(true);
  });
  it("retains a positively accepted receipt when subsequent status readback fails", async () => {
    const f = fixture(); let submitted = "";
    vi.mocked(f.account.rpc).mockImplementation(async (name, args) => {
      if (name === "mobile_account_deletion_amendment_preflight") return amendmentReview();
      if (name === "mobile_amend_account_deletion") { submitted = args.p_amendment_id as string; return amendmentStatus(submitted).amendment_receipt; }
      throw new Error("Status reply lost");
    });
    const loaded = await f.client.amendmentPreflight(uuid(6));
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow("Status reply lost");
    expect(f.client.amendmentPending).toBe(true);
    vi.mocked(f.account.rpc).mockImplementation(async name => name === "mobile_get_account_deletion_amendment" ? amendmentStatus(submitted).amendment_receipt : amendmentStatus(submitted));
    expect((await f.client.resolveAmendment()).receipt?.amendment_id).toBe(submitted);
    expect(vi.mocked(f.account.rpc).mock.calls.filter(([name]) => name === "mobile_amend_account_deletion")).toHaveLength(1);
  });
  it("requires another review when the verified Auth session changes before submission", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValue(amendmentReview());
    const loaded = await f.client.amendmentPreflight(uuid(6));
    vi.mocked(f.account.session).mockResolvedValue({ userId: user, email: "", accessToken: token(uuid(99)) });
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow(/could not be verified/);
    expect(vi.mocked(f.account.rpc).mock.calls.some(([name]) => name === "mobile_amend_account_deletion")).toBe(false);
  });
  it("cannot replace captured review fields or submit a review never loaded by this client", async () => {
    const f = fixture();
    await expect(f.client.amend(amendmentReview() as never, [...resolutions])).rejects.toThrow(/could not be verified/);
    vi.mocked(f.account.rpc).mockResolvedValue(amendmentReview());
    const loaded = await f.client.amendmentPreflight(uuid(6)); loaded.projects[0].previous_key_version = 0;
    await expect(f.client.amend(loaded, [...resolutions])).rejects.toThrow(/could not be verified/);
    expect(vi.mocked(f.account.rpc).mock.calls.some(([name]) => name === "mobile_amend_account_deletion")).toBe(false);
  });
  it("ignores a late amendment review after a verified Auth-session replacement", async () => {
    const f = fixture(); vi.mocked(f.account.rpc).mockResolvedValue(amendmentReview());
    vi.mocked(f.account.session).mockResolvedValueOnce({ userId: user, email: "", accessToken: token() }).mockResolvedValueOnce({ userId: user, email: "", accessToken: token(uuid(99)) });
    await expect(f.client.amendmentPreflight(uuid(6))).rejects.toThrow(/could not be verified/);
  });
  it.each(["wrong-job", "duplicate-project", "false-owner", "missing-proof", "wrong-base", "negative-revision"])("withholds unverified server amendment evidence: %s", async variant => {
    const f = fixture(), data = amendmentReview() as any;
    if (variant === "wrong-job") data.job_id = uuid(99);
    if (variant === "duplicate-project") data.projects.push(data.projects[0]);
    if (variant === "false-owner") data.projects[0].remaining_owner = false;
    if (variant === "missing-proof") { data.projects[0].current_workspace_id = null; data.projects[0].allowed_resolution = "attach_finalized_deletion"; }
    if (variant === "wrong-base") data.intent_sha256 = "c".repeat(64);
    if (variant === "negative-revision") data.base_revision = -1;
    vi.mocked(f.account.rpc).mockResolvedValue(data);
    await expect(f.client.amendmentPreflight(uuid(6))).rejects.toThrow(/could not be verified/);
  });
});
