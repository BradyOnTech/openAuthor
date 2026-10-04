import assert from "node:assert/strict";
import test from "node:test";
import { AccountDeletionProblem, AccountDeletionWorker, accountDeletionState, finalizeAccountAuth, SupabaseAccountDeletionAuthAdmin, SupabaseAccountDeletionJobStore } from "../src/accountDeletion.ts";
import type { AccountDeletionState } from "../src/accountDeletion.ts";
import { runAccountDeletionCommand } from "../src/accountDeletionMain.ts";

const id = (suffix = 1) => `d1000000-0000-7000-8000-${String(suffix).padStart(12, "0")}`;
const hash = "ab".repeat(32);
function state(phase: AccountDeletionState["phase"] = "deleting"): AccountDeletionState {
  return { job_id: id(), user_id: id(2), inventory_sha256: hash, phase, blockers: [], projects: [
    { project_id: id(3), action: "delete", project_job_id: id(4), phase: phase === "deleting" ? "pending" : "finalized", blockers: [] },
    { project_id: id(5), action: "retain", project_job_id: null, phase: "retained", blockers: [] },
  ] };
}
const code = (expected: string) => (error: unknown) => error instanceof AccountDeletionProblem && error.code === expected && !String(error).includes("private");

test("strict durable-state validation refuses changed IDs, routes, receipts and duplicate children", () => {
  assert.deepEqual(accountDeletionState(state(), id()), state());
  for (const value of [null, { ...state(), job_id: id(9) }, { ...state(), inventory_sha256: null },
    { ...state(), projects: [...state().projects, state().projects[0]] },
    { ...state(), projects: [{ ...state().projects[1], project_job_id: id(8) }] },
    { ...state(), projects: [{ ...state().projects[0], phase: "retained" }] }]) {
    assert.throws(() => accountDeletionState(value, id()), code("invalid_account_state"));
  }
});

test("account worker drains only an approved pending child, then freshly reports the verifier boundary", async () => {
  let current = state(); const calls: string[] = []; let reads = 0;
  const worker = new AccountDeletionWorker({ get: async () => { reads++; return structuredClone(current); } }, async child => {
    calls.push(child); current.projects[0]!.phase = "awaiting_backend_verification";
  });
  assert.deepEqual(await worker.runOnce(id()), { job_id: id(), phase: "deleting", children_pending: 0, awaiting_backend_verification: 1, shared_blockers: 0 });
  await worker.runOnce(id()); assert.deepEqual(calls, [id(4)]); assert.equal(reads, 4);
  current = state("auth_ready"); await worker.runOnce(id()); assert.equal(calls.length, 1);
});

test("parallel local account work is refused and a changed durable intent never becomes a success", async () => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let reads = 0;
  const worker = new AccountDeletionWorker({ get: async () => { reads++; return reads === 1 ? state() : { ...state(), user_id: id(9) }; } }, async () => held);
  const first = worker.runOnce(id()); await Promise.resolve();
  await assert.rejects(worker.runOnce(id()), code("account_job_busy")); release();
  await assert.rejects(first, code("account_intent_changed"));
});

test("Auth finalization requires the exact reviewed inventory and complete children/retention", async () => {
  let deletes = 0; const auth = { deleteUser: async () => { deletes++; } };
  for (const current of [state(), { ...state("auth_ready"), projects: [{ ...state("auth_ready").projects[1]!, blockers: ["Rotation pending"] }] },
    { ...state("auth_ready"), projects: [{ ...state("auth_ready").projects[0]!, phase: "awaiting_backend_verification" }] }]) {
    await assert.rejects(finalizeAccountAuth({ get: async () => current }, auth, id(), hash), code("account_not_ready"));
  }
  await assert.rejects(finalizeAccountAuth({ get: async () => state("auth_ready") }, auth, id(), "cd".repeat(32)), code("account_intent_changed"));
  assert.equal(deletes, 0);
});

test("lost Auth reply resolves only from a matching positive finalized receipt without a second DELETE", async () => {
  let current = state("auth_ready"), deletes = 0;
  const jobs = { get: async () => structuredClone(current) };
  const auth = { deleteUser: async (user: string) => { assert.equal(user, id(2)); deletes++; current = state("finalized"); throw new Error("private transport detail"); } };
  assert.equal((await finalizeAccountAuth(jobs, auth, id(), hash)).phase, "finalized");
  await finalizeAccountAuth(jobs, auth, id(), hash); assert.equal(deletes, 1);
  current = state("auth_ready");
  await assert.rejects(finalizeAccountAuth(jobs, { deleteUser: async () => { deletes++; throw new Error("private"); } }, id(), hash), code("auth_outcome_unconfirmed"));
  assert.equal(deletes, 2);
});

test("HTTP adapters use exact control routes, bounded discovery and a separate hard Auth deletion", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init! });
    return new Response(JSON.stringify(String(input).includes("mobile_list") ? [{ job_id: id(), phase: "deleting" }] : state()), { status: 200 });
  };
  const options = { supabaseUrl: "https://fixture.invalid", serviceKey: "synthetic-storage-key", fetch: fetcher };
  const jobs = new SupabaseAccountDeletionJobStore(options);
  await jobs.get(id()); await jobs.list(null, 1);
  const auth = new SupabaseAccountDeletionAuthAdmin({ ...options, serviceKey: "synthetic-auth-key" }); await auth.deleteUser(id(2));
  assert.deepEqual(calls.map(item => [item.url, item.init.method, JSON.parse(String(item.init.body))]), [
    ["https://fixture.invalid/rest/v1/rpc/mobile_get_account_deletion_worker", "POST", { p_job_id: id() }],
    ["https://fixture.invalid/rest/v1/rpc/mobile_list_account_deletion_work", "POST", { p_after_job_id: null, p_limit: 1 }],
    [`https://fixture.invalid/auth/v1/admin/users/${id(2)}`, "DELETE", { should_soft_delete: false }],
  ]);
  assert.equal((calls[2]!.init.headers as Record<string, string>).authorization, "Bearer synthetic-auth-key");
  assert.ok(calls.every(item => item.init.redirect === "error"));
  await assert.rejects(jobs.list(null, 101), code("invalid_bounds"));
});

test("malformed, duplicate or oversized discovery cannot feed the scheduler", async () => {
  for (const payload of [null, [{ job_id: id(), phase: "finalized" }], [{ job_id: id(), phase: "deleting" }, { job_id: id(), phase: "deleting" }]]) {
    const jobs = new SupabaseAccountDeletionJobStore({ supabaseUrl: "https://fixture.invalid", serviceKey: "synthetic", fetch: async () => new Response(JSON.stringify(payload)) });
    await assert.rejects(jobs.list(null, 2), code("invalid_account_state"));
  }
});

test("uncooperative control transport still times out with a content-free failure", async () => {
  const jobs = new SupabaseAccountDeletionJobStore({ supabaseUrl: "https://fixture.invalid", serviceKey: "synthetic", timeoutMs: 15, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(jobs.get(id()), code("request_timeout"));
  const failure = new SupabaseAccountDeletionJobStore({ supabaseUrl: "https://fixture.invalid", serviceKey: "synthetic", fetch: async () => new Response("private author identity", { status: 500 }) });
  await assert.rejects(failure.get(id()), code("account_control_unavailable"));
});

test("unsafe destination/configuration and incomplete CLI authorization refuse before network work", async () => {
  for (const url of ["http://remote.invalid", "https://user:secret@fixture.invalid", "https://fixture.invalid/project", "https://fixture.invalid#private"]) {
    assert.throws(() => new SupabaseAccountDeletionAuthAdmin({ supabaseUrl: url, serviceKey: "synthetic" }), code("invalid_configuration"));
  }
  await assert.rejects(runAccountDeletionCommand(["--finalize-auth", id(), "--reviewed-inventory", hash], { SUPABASE_URL: "https://fixture.invalid", SUPABASE_DELETION_SERVICE_KEY: "synthetic" }), code("invalid_configuration"));
  await assert.rejects(runAccountDeletionCommand(["--delete-everything"], { SUPABASE_URL: "https://fixture.invalid", SUPABASE_DELETION_SERVICE_KEY: "synthetic" }), code("invalid_arguments"));
});
