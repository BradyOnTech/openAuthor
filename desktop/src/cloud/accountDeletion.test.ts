import { describe, expect, it, vi } from "vitest";
import { createAccountDeletionClient, type AccountDeletionChoices } from "./accountDeletion";
import type { CompanionAccount } from "./account";

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
