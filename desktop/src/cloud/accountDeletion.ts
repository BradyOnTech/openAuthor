import { CompanionRpcRefusal, UUID, cloudSessionId, type CompanionAccount, type CloudSession } from "./account";

export type AccountWorkspaceReview = { workspace_id: string; name: string; role: "owner" | "editor" | "viewer"; other_members: number; other_owners: number; project_ids: string[] };
export type AccountProjectReview = { project_id: string; workspace_id: string; name: string | null; needs_rotation: boolean; previous_key_version: number; own_outbox_ids: string[]; project_deletion_job: { job_id: string; phase: string } | null };
export type AccountHistoricalDeletion = { job_id: string; project_id: string; workspace_id: string | null; phase: string };
export type AccountDeletionReview = { schema_version: 1; inventory_sha256: string; inventory: { user_id: string; workspaces: AccountWorkspaceReview[]; projects: AccountProjectReview[]; devices: Array<{ device_id: string; platform: string; device_label: string }>; existing_project_jobs: AccountHistoricalDeletion[] } };
export type AccountDeletionChoices = { workspaces: Array<{ workspace_id: string; action: "delete" | "leave" }>; projects: Array<{ project_id: string; action: "delete" | "retain"; outbox: "preserve" | "remove" }> };
export type AccountDeletionAmendmentReceipt = { amendment_id: string; revision: number; review_sha256: string; intent_sha256: string };
type AccountRetentionStatus = { resolution?: "retained" | "independently_deleted" | null; reviewed_workspace_id?: string | null; effective_workspace_id?: string | null; independent_deletion?: { job_id: string; phase: "finalized"; backend_verification_sha256: string } | null };
export type AccountDeletionStatus = { job_id: string; phase: string; inventory_sha256: string; blockers: string[]; projects: Array<{ project_id: string; name: string | null; action: "delete" | "retain"; phase: string; needs_rotation: boolean; blockers: string[] } & AccountRetentionStatus>; original_inventory_sha256?: string; amendment_revision?: number; amendment_receipt?: AccountDeletionAmendmentReceipt | null };
export type AccountRetentionResolution = { project_id: string; resolution: "retain_current_scope"; workspace_id: string } | { project_id: string; resolution: "attach_finalized_deletion"; project_job_id: string; backend_verification_sha256: string };
export const ACCOUNT_RETENTION_MAX_SELECTION = 100;
export type AccountRetentionReview = { schema_version: 1; job_id: string; phase: "deleting" | "auth_ready"; base_revision: number; original_inventory_sha256: string; intent_sha256: string; review_sha256: string; projects: Array<{
  project_id: string; name: string | null; reviewed_workspace_id: string; effective_workspace_id: string | null; current_workspace_id: string | null;
  resolution: "retained" | "independently_deleted"; needs_rotation: boolean; previous_key_version: number; active_key_version: number | null; remaining_owner: boolean;
  independent_deletion: { job_id: string; phase: string; backend_verification_sha256: string | null } | null;
  allowed_resolution: "retain_current_scope" | "attach_finalized_deletion" | null; blockers: string[];
}> };
type PendingAmendment = { id: string; review: AccountRetentionReview };

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
function hash(value: unknown): value is string { return typeof value === "string" && HASH.test(value); }
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
    const retention: AccountRetentionStatus = {};
    if (item.resolution !== undefined) {
      if (![null, "retained", "independently_deleted"].includes(item.resolution as string | null) || item.reviewed_workspace_id !== null && !id(item.reviewed_workspace_id) || item.effective_workspace_id !== null && !id(item.effective_workspace_id)) throw problem();
      const proof = item.independent_deletion === null ? null : object(item.independent_deletion);
      if (proof && (!id(proof.job_id) || proof.phase !== "finalized" || !hash(proof.backend_verification_sha256))) throw problem();
      if (item.action === "delete" ? item.resolution !== null || proof !== null : item.resolution === "retained" ? !id(item.effective_workspace_id) || proof !== null : item.resolution !== "independently_deleted" || item.effective_workspace_id !== null || !proof) throw problem();
      Object.assign(retention, { resolution: item.resolution, reviewed_workspace_id: item.reviewed_workspace_id, effective_workspace_id: item.effective_workspace_id, independent_deletion: proof });
    }
    return { project_id: item.project_id, name: item.name as string | null, action: item.action as "delete" | "retain", phase: item.phase, needs_rotation: item.needs_rotation, blockers: blocked as string[], ...retention };
  });
  const result: AccountDeletionStatus = { job_id: row.job_id, phase: row.phase, inventory_sha256: row.inventory_sha256, blockers: blockers as string[], projects };
  if (row.amendment_revision !== undefined || row.original_inventory_sha256 !== undefined || row.amendment_receipt !== undefined) {
    if (!count(row.amendment_revision) || !hash(row.original_inventory_sha256)) throw problem();
    const receipt = amendmentReceipt(row.amendment_receipt);
    if (row.amendment_revision === 0 ? receipt !== null || row.inventory_sha256 !== row.original_inventory_sha256 : !receipt || receipt.revision !== row.amendment_revision || receipt.intent_sha256 !== row.inventory_sha256) throw problem();
    Object.assign(result, { amendment_revision: row.amendment_revision, original_inventory_sha256: row.original_inventory_sha256, amendment_receipt: receipt });
  }
  return result;
}
function amendmentReceipt(value: unknown): AccountDeletionAmendmentReceipt | null {
  if (value === null) return null;
  const row = object(value);
  if (!id(row.amendment_id) || !count(row.revision) || row.revision < 1 || !hash(row.review_sha256) || !hash(row.intent_sha256)) throw problem();
  return { amendment_id: row.amendment_id, revision: row.revision, review_sha256: row.review_sha256, intent_sha256: row.intent_sha256 };
}
function retentionReview(value: unknown, jobId: string): AccountRetentionReview {
  const row = object(value);
  if (!id(jobId) || row.job_id !== jobId || row.schema_version !== 1 || !["deleting", "auth_ready"].includes(row.phase as string) || !count(row.base_revision) || row.base_revision >= 2147483647 || !hash(row.original_inventory_sha256) || !hash(row.intent_sha256) || !hash(row.review_sha256) || row.base_revision === 0 && row.intent_sha256 !== row.original_inventory_sha256) throw problem();
  const projects = namedRows(row.projects, "project_id", item => {
    const blockers = rows(item.blockers);
    if (!id(item.project_id) || item.name !== null && !text(item.name) || !id(item.reviewed_workspace_id) || item.effective_workspace_id !== null && !id(item.effective_workspace_id) || item.current_workspace_id !== null && !id(item.current_workspace_id) || !["retained", "independently_deleted"].includes(item.resolution as string) || typeof item.needs_rotation !== "boolean" || !count(item.previous_key_version) || item.active_key_version !== null && (!count(item.active_key_version) || item.active_key_version < 1) || typeof item.remaining_owner !== "boolean" || !blockers.every(text)) throw problem();
    const deletion = item.independent_deletion === null ? null : object(item.independent_deletion);
    if (deletion && (!id(deletion.job_id) || typeof deletion.phase !== "string" || !PHASE.test(deletion.phase) || deletion.backend_verification_sha256 !== null && !hash(deletion.backend_verification_sha256))) throw problem();
    if (![null, "retain_current_scope", "attach_finalized_deletion"].includes(item.allowed_resolution as null | string)) throw problem();
    if (item.allowed_resolution === "retain_current_scope" && (item.resolution !== "retained" || !id(item.current_workspace_id) || !item.remaining_owner || item.current_workspace_id === item.effective_workspace_id)) throw problem();
    if (item.allowed_resolution === "attach_finalized_deletion" && (item.resolution !== "retained" || item.current_workspace_id !== null || !deletion || deletion.phase !== "finalized" || !hash(deletion.backend_verification_sha256))) throw problem();
    return { project_id: item.project_id, name: item.name as string | null, reviewed_workspace_id: item.reviewed_workspace_id, effective_workspace_id: item.effective_workspace_id as string | null, current_workspace_id: item.current_workspace_id as string | null,
      resolution: item.resolution as "retained" | "independently_deleted", needs_rotation: item.needs_rotation, previous_key_version: item.previous_key_version, active_key_version: item.active_key_version as number | null, remaining_owner: item.remaining_owner,
      independent_deletion: deletion as AccountRetentionReview["projects"][number]["independent_deletion"], allowed_resolution: item.allowed_resolution as AccountRetentionReview["projects"][number]["allowed_resolution"], blockers: blockers as string[] };
  });
  return { schema_version: 1, job_id: jobId, phase: row.phase as AccountRetentionReview["phase"], base_revision: row.base_revision, original_inventory_sha256: row.original_inventory_sha256, intent_sha256: row.intent_sha256, review_sha256: row.review_sha256, projects };
}
function retentionChoices(review: AccountRetentionReview, values: AccountRetentionResolution[]): AccountRetentionResolution[] {
  const choices = namedRows(values, "project_id", row => {
    const project = review.projects.find(project => project.project_id === row.project_id);
    if (!project || !project.allowed_resolution || row.resolution !== project.allowed_resolution) throw problem();
    if (row.resolution === "retain_current_scope") {
      if (Object.keys(row).sort().join(",") !== "project_id,resolution,workspace_id" || row.workspace_id !== project.current_workspace_id) throw problem();
      return { project_id: project.project_id, resolution: "retain_current_scope" as const, workspace_id: row.workspace_id as string };
    }
    if (!project.independent_deletion || Object.keys(row).sort().join(",") !== "backend_verification_sha256,project_id,project_job_id,resolution" || row.project_job_id !== project.independent_deletion.job_id || row.backend_verification_sha256 !== project.independent_deletion.backend_verification_sha256) throw problem();
    return { project_id: project.project_id, resolution: "attach_finalized_deletion" as const, project_job_id: row.project_job_id as string, backend_verification_sha256: row.backend_verification_sha256 as string };
  });
  if (!choices.length || choices.length > ACCOUNT_RETENTION_MAX_SELECTION) throw problem();
  return choices;
}
function sessionId(session: CloudSession): string {
  const value = cloudSessionId(session); if (!value) throw problem(); return value;
}

/** Owner review/status only. Storage, attestation and Auth deletion remain trusted backend work. */
export function createAccountDeletionClient(account: CompanionAccount, expected: { userId: string; deviceId?: string }) {
  let unresolvedSubmission = false;
  let pendingAmendment: PendingAmendment | null = null;
  let loadedAmendmentReview: AccountRetentionReview | null = null;
  let loadedAmendmentSession = "";
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
  function confirmAmendment(receipt: AccountDeletionAmendmentReceipt, progress: AccountDeletionStatus, pending: PendingAmendment) {
    if (progress.job_id !== pending.review.job_id || progress.original_inventory_sha256 !== pending.review.original_inventory_sha256 || progress.amendment_revision === undefined || receipt.amendment_id !== pending.id || receipt.review_sha256 !== pending.review.review_sha256 || receipt.revision !== pending.review.base_revision + 1 || progress.amendment_revision < receipt.revision || progress.amendment_revision === receipt.revision && progress.inventory_sha256 !== receipt.intent_sha256) throw problem();
  }
  return {
    get amendmentPending(): boolean { return pendingAmendment !== null; },
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
    async amendmentPreflight(jobId: string): Promise<AccountRetentionReview> {
      if (pendingAmendment) throw problem();
      const before = await checked();
      const review = retentionReview(await read("mobile_account_deletion_amendment_preflight", { p_job_id: jobId }), jobId);
      const after = await checked();
      if (pendingAmendment || sessionId(before) !== sessionId(after)) throw problem();
      loadedAmendmentReview = structuredClone(review);
      loadedAmendmentSession = sessionId(before);
      return review;
    },
    async amend(review: AccountRetentionReview, choices: AccountRetentionResolution[]): Promise<AccountDeletionStatus> {
      if (pendingAmendment) throw problem();
      const captured = retentionReview(review, review.job_id), selected = retentionChoices(captured, choices);
      if (!loadedAmendmentReview || JSON.stringify(captured) !== JSON.stringify(loadedAmendmentReview)) throw problem();
      const before = await checked(), amendmentId = crypto.randomUUID();
      if (pendingAmendment || sessionId(before) !== loadedAmendmentSession) throw problem();
      pendingAmendment = { id: amendmentId, review: structuredClone(captured) };
      let value: unknown;
      try {
        value = await account.rpc("mobile_amend_account_deletion", { p_job_id: captured.job_id, p_amendment_id: amendmentId,
          p_expected_revision: captured.base_revision, p_expected_review_sha256: captured.review_sha256, p_resolutions: structuredClone(selected) });
      } catch (reason) {
        if (reason instanceof CompanionRpcRefusal) { pendingAmendment = null; loadedAmendmentReview = null; throw new Error("The shared-book correction was refused. Review the current shared-book scope before making a new request."); }
        throw reason;
      }
      const receipt = amendmentReceipt(value);
      if (!receipt) throw problem();
      const result = status(await read("mobile_get_account_deletion", { p_job_id: captured.job_id }));
      const after = await checked();
      if (sessionId(before) !== sessionId(after) || !result) throw problem();
      confirmAmendment(receipt, result, pendingAmendment);
      pendingAmendment = null; loadedAmendmentReview = null;
      return result;
    },
    async resolveAmendment(): Promise<{ receipt: AccountDeletionAmendmentReceipt | null; progress: AccountDeletionStatus }> {
      if (!pendingAmendment) throw problem();
      const pending = pendingAmendment, before = await checked();
      const receipt = amendmentReceipt(await read("mobile_get_account_deletion_amendment", { p_job_id: pending.review.job_id, p_amendment_id: pending.id }));
      const progress = status(await read("mobile_get_account_deletion", { p_job_id: pending.review.job_id }));
      const after = await checked();
      if (sessionId(before) !== sessionId(after) || !progress || progress.job_id !== pending.review.job_id || progress.original_inventory_sha256 !== pending.review.original_inventory_sha256 || progress.amendment_revision === undefined) throw problem();
      if (receipt) {
        confirmAmendment(receipt, progress, pending);
        pendingAmendment = null; loadedAmendmentReview = null;
      }
      return { receipt, progress };
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
      if (!receipt || (receipt.original_inventory_sha256 ?? receipt.inventory_sha256) !== review.inventory_sha256) throw problem();
      return receipt;
    },
  };
}
