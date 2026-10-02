import { UUID, cloudSessionId, type CompanionAccount, type CloudSession } from "./account";

export type AccountWorkspaceReview = { workspace_id: string; name: string; role: "owner" | "editor" | "viewer"; other_members: number; other_owners: number; project_ids: string[] };
export type AccountProjectReview = { project_id: string; workspace_id: string; name: string | null; needs_rotation: boolean; previous_key_version: number; own_outbox_ids: string[]; project_deletion_job: { job_id: string; phase: string } | null };
export type AccountHistoricalDeletion = { job_id: string; project_id: string; workspace_id: string | null; phase: string };
export type AccountDeletionReview = { schema_version: 1; inventory_sha256: string; inventory: { user_id: string; workspaces: AccountWorkspaceReview[]; projects: AccountProjectReview[]; devices: Array<{ device_id: string; platform: string; device_label: string }>; existing_project_jobs: AccountHistoricalDeletion[] } };
export type AccountDeletionChoices = { workspaces: Array<{ workspace_id: string; action: "delete" | "leave" }>; projects: Array<{ project_id: string; action: "delete" | "retain"; outbox: "preserve" | "remove" }> };
export type AccountDeletionStatus = { job_id: string; phase: string; inventory_sha256: string; blockers: string[]; projects: Array<{ project_id: string; name: string | null; action: "delete" | "retain"; phase: string; needs_rotation: boolean; blockers: string[] }> };

const HASH = /^[0-9a-f]{64}$/;
const PHASE = /^[a-z][a-z_]{0,63}$/;
const problem = () => new Error("Account deletion could not be verified. Refresh your account status before making another request.");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw problem();
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string { return typeof value === "string" && value.length <= 4096; }
function id(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function rows(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 10000) throw problem(); return value; }
function uniqueIds(values: unknown): string[] {
  const list = rows(values); if (!list.every(id) || new Set(list).size !== list.length) throw problem(); return list;
}
function namedRows<T extends { [key: string]: unknown }>(value: unknown, key: string, parse: (row: Record<string, unknown>) => T): T[] {
  const list = rows(value).map(value => parse(object(value)));
  if (new Set(list.map(row => row[key])).size !== list.length) throw problem(); return list;
}
function sourceReview(value: unknown, userId: string): AccountDeletionReview {
  const review = object(value), inventory = object(review.inventory);
  if (review.schema_version !== 1 || typeof review.inventory_sha256 !== "string" || !HASH.test(review.inventory_sha256) || inventory.user_id !== userId) throw problem();
  const workspaces = namedRows(inventory.workspaces, "workspace_id", row => {
    if (!id(row.workspace_id) || !text(row.name) || !["owner", "editor", "viewer"].includes(row.role as string) || !count(row.other_members) || !count(row.other_owners) || row.other_owners > row.other_members) throw problem();
    return { workspace_id: row.workspace_id, name: row.name, role: row.role as AccountWorkspaceReview["role"], other_members: row.other_members, other_owners: row.other_owners, project_ids: uniqueIds(row.project_ids) };
  });
  const projects = namedRows(inventory.projects, "project_id", row => {
    if (!id(row.project_id) || !id(row.workspace_id) || row.name !== null && !text(row.name) || typeof row.needs_rotation !== "boolean" || !count(row.previous_key_version)) throw problem();
    const existing = row.project_deletion_job === null ? null : object(row.project_deletion_job);
    if (existing && (!id(existing.job_id) || typeof existing.phase !== "string" || !PHASE.test(existing.phase))) throw problem();
    return { project_id: row.project_id, workspace_id: row.workspace_id, name: row.name as string | null, needs_rotation: row.needs_rotation, previous_key_version: row.previous_key_version, own_outbox_ids: uniqueIds(row.own_outbox_ids), project_deletion_job: existing as AccountProjectReview["project_deletion_job"] };
  });
  const devices = namedRows(inventory.devices, "device_id", row => {
    if (!id(row.device_id) || !text(row.platform) || !text(row.device_label)) throw problem();
    return { device_id: row.device_id, platform: row.platform, device_label: row.device_label };
  });
  const historical = namedRows(inventory.existing_project_jobs, "project_id", row => {
    // A child deletion receipt can outlive the project/workspace it removed.
    if (!id(row.job_id) || !id(row.project_id) || row.workspace_id !== null && !id(row.workspace_id) || typeof row.phase !== "string" || !PHASE.test(row.phase)) throw problem();
    return { job_id: row.job_id, project_id: row.project_id, workspace_id: row.workspace_id as string | null, phase: row.phase };
  });
  if (new Set(historical.map(row => row.job_id)).size !== historical.length) throw problem();
  if (historical.some(row => projects.some(project => project.project_id === row.project_id && (project.workspace_id !== row.workspace_id || project.project_deletion_job?.job_id !== row.job_id || project.project_deletion_job.phase !== row.phase)))) throw problem();
  if (workspaces.some(workspace => workspace.project_ids.some(projectId => !projects.some(project => project.project_id === projectId && project.workspace_id === workspace.workspace_id)))) throw problem();
  return { schema_version: 1, inventory_sha256: review.inventory_sha256, inventory: { user_id: userId, workspaces, projects, devices, existing_project_jobs: historical } };
}
function status(value: unknown): AccountDeletionStatus | null {
  if (value === null) return null;
  const row = object(value);
  if (!id(row.job_id) || typeof row.phase !== "string" || !PHASE.test(row.phase) || typeof row.inventory_sha256 !== "string" || !HASH.test(row.inventory_sha256)) throw problem();
  const blockers = rows(row.blockers); if (!blockers.every(text)) throw problem();
  const projects = namedRows(row.projects, "project_id", item => {
    const blocked = rows(item.blockers);
    if (!id(item.project_id) || item.name !== null && !text(item.name) || !["delete", "retain"].includes(item.action as string) || typeof item.phase !== "string" || !PHASE.test(item.phase) || typeof item.needs_rotation !== "boolean" || !blocked.every(text)) throw problem();
    return { project_id: item.project_id, name: item.name as string | null, action: item.action as "delete" | "retain", phase: item.phase, needs_rotation: item.needs_rotation, blockers: blocked as string[] };
  });
  return { job_id: row.job_id, phase: row.phase, inventory_sha256: row.inventory_sha256, blockers: blockers as string[], projects };
}
function sessionId(session: CloudSession): string {
  const value = cloudSessionId(session); if (!value) throw problem(); return value;
}

/** Owner review/status only. Storage, attestation and Auth deletion remain trusted backend work. */
export function createAccountDeletionClient(account: CompanionAccount, expected: { userId: string; deviceId?: string }) {
  let unresolvedSubmission = false;
  async function checked(requireDevice = false): Promise<CloudSession> {
    const session = await account.session({ userId: expected.userId, ...(requireDevice ? { deviceId: expected.deviceId } : {}) });
    if (!session || session.userId !== expected.userId || requireDevice && !expected.deviceId) throw problem();
    sessionId(session); return session;
  }
  async function read(name: string, params: Record<string, unknown>, requireDevice = false): Promise<unknown> {
    const before = await checked(requireDevice);
    const value = await account.rpc(name, params);
    const after = await checked(requireDevice);
    if (sessionId(before) !== sessionId(after)) throw problem();
    return value;
  }
  return {
    async preflight(): Promise<AccountDeletionReview> {
      if (unresolvedSubmission) throw problem();
      const review = sourceReview(await read("mobile_account_deletion_preflight", { p_requesting_device_id: expected.deviceId }, true), expected.userId);
      if (!review.inventory.devices.some(device => device.device_id === expected.deviceId)) throw problem();
      return review;
    },
    async current(): Promise<AccountDeletionStatus | null> {
      // Account progress remains readable after the initiating device is revoked.
      return status(await read("mobile_get_account_deletion", { p_job_id: null }));
    },
    async begin(review: AccountDeletionReview, choices: AccountDeletionChoices, acknowledged: boolean): Promise<AccountDeletionStatus> {
      if (unresolvedSubmission || review.inventory.user_id !== expected.userId || !HASH.test(review.inventory_sha256)) throw problem();
      const before = await checked(true);
      unresolvedSubmission = true; // A lost reply must never cause a blind retry.
      const value = await account.rpc("mobile_begin_account_deletion", {
        p_requesting_device_id: expected.deviceId, p_expected_inventory_sha256: review.inventory_sha256,
        p_dispositions: structuredClone(choices), p_acknowledge_retained_history: acknowledged,
      });
      const after = await checked(); // This request deliberately revokes its own device.
      if (sessionId(before) !== sessionId(after)) throw problem();
      const receipt = status(value);
      if (!receipt || receipt.inventory_sha256 !== review.inventory_sha256) throw problem();
      return receipt;
    },
  };
}
