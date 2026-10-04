import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectDeletionWorker, SupabaseDeletionStorage, SupabaseProjectDeletionJobStore } from "../src/projectDeletion.ts";
import type { ProjectDeletionLease, ProjectDeletionJobStore } from "../src/projectDeletion.ts";

const PROJECT = "10000000-0000-4000-8000-000000000001";
const PREFIX = `projects/${PROJECT}`;
const OTHER = "20000000-0000-4000-8000-000000000001";
const IDENTITY = { job_id: "30000000-0000-4000-8000-000000000001", project_id: PROJECT, lease_token: "40000000-0000-4000-8000-000000000001" };

async function fixture() {
  let lease: ProjectDeletionLease = { ...IDENTITY, lease_expires_at: new Date(Date.now() + 60000).toISOString(), phase: "deleting", pending_paths: [] };
  const directory = mkdtempSync(join(tmpdir(), "openauthor-deletion-"));
  const jobPath = join(directory, "job.json");
  const persist = () => {
    const temporary = `${jobPath}.new`;
    const file = openSync(temporary, "w", 0o600);
    try { writeFileSync(file, JSON.stringify(lease)); fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, jobPath);
    const parent = openSync(directory, "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  };
  persist();
  const objects = new Set<string>();
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  let deleteMode: "normal" | "lost" | "partial" | "refused" = "normal";
  let listMode: "normal" | "duplicate" | "foreign" | "unsafe" | "malformed" | "refused" | "missing" | "stalled" = "normal";
  let afterDelete: (() => void) | undefined;
  let holdPrepared = false;
  let holdDeleted = false;
  const provider = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text) as Record<string, unknown>;
    requests.push({ method: request.method!, path: request.url!, body });
    assert.equal(request.headers.authorization, "Bearer synthetic-private-storage-key");
    if (request.url?.startsWith("/rest/v1/rpc/")) {
      const expected = { job_id: String(body.p_job_id), project_id: String(body.p_project_id), lease_token: String(body.p_lease_token) };
      try {
        let result: ProjectDeletionLease;
        if (request.url.endsWith("mobile_claim_project_deletion")) { assert.equal(body.p_job_id, lease.job_id); result = structuredClone(lease); }
        else if (request.url.endsWith("mobile_renew_project_deletion_lease")) result = await store.renewLease(expected);
        else if (request.url.endsWith("mobile_prepare_project_deletion_batch")) {
          result = await store.prepareDeleteBatch(expected, body.p_paths as string[]);
          while (holdPrepared && !response.destroyed) await new Promise(resolve => setTimeout(resolve, 5));
        }
        else if (request.url.endsWith("mobile_ack_project_deletion_batch")) result = await store.acknowledgeBatch(expected, body.p_paths as string[]);
        else if (request.url.endsWith("mobile_mark_project_deletion_storage_empty")) result = await store.markStorageEmpty(expected);
        else throw new Error("Unknown trusted operation.");
        response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result));
      } catch { response.writeHead(409); response.end("synthetic-private-job-error"); }
    } else if (request.method === "POST" && request.url === "/storage/v1/object/list/mobile-encrypted-sync") {
      if (listMode === "refused") { response.writeHead(503); response.end("private-source-data"); return; }
      while (listMode === "stalled" && !response.destroyed) await new Promise(resolve => setTimeout(resolve, 5));
      const prefix = `${body.prefix}/`;
      const entries = new Map<string, { name: string; id: string | null; metadata: object | null }>();
      for (const path of objects) {
        if (!path.startsWith(prefix)) continue;
        const [name, ...tail] = path.slice(prefix.length).split("/");
        entries.set(name!, { name: name!, id: tail.length ? null : "50000000-0000-4000-8000-000000000001", metadata: tail.length ? null : { size: 32 } });
      }
      let rows: unknown[] = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(Number(body.offset), Number(body.offset) + Number(body.limit));
      if (listMode === "duplicate" && rows.length) rows = [rows[0], rows[0]];
      if (listMode === "foreign") rows = [{ name: `projects/${OTHER}/foreign.bin`, id: "file", metadata: {} }];
      if (listMode === "unsafe") rows = [{ name: "..", id: null, metadata: null }];
      if (listMode === "missing") rows = [];
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(listMode === "malformed" ? { objects: [] } : rows));
    } else if (request.method === "DELETE" && request.url === "/storage/v1/object/mobile-encrypted-sync") {
      const paths = body.prefixes as string[];
      if (deleteMode === "refused") { response.writeHead(503); response.end("private-source-data"); return; }
      const deleted = paths.filter(path => objects.has(path));
      for (const path of deleteMode === "partial" ? deleted.slice(0, 1) : deleted) objects.delete(path);
      afterDelete?.();
      if (deleteMode === "lost") { request.socket.destroy(); return; }
      while (holdDeleted && !response.destroyed) await new Promise(resolve => setTimeout(resolve, 5));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify((deleteMode === "partial" ? deleted.slice(0, 1) : deleted).map(name => ({ name }))));
    } else { response.writeHead(404); response.end(); }
  });
  provider.listen(0, "127.0.0.1"); await once(provider, "listening");
  const guard = (identity: typeof IDENTITY) => {
    if (JSON.stringify(identity) !== JSON.stringify({ job_id: lease.job_id, project_id: lease.project_id, lease_token: lease.lease_token })) throw new Error("Lease superseded.");
  };
  let ackFailure = false;
  const store: ProjectDeletionJobStore = {
    async assertLease(identity) { guard(identity); return structuredClone(lease); },
    async renewLease(identity) { guard(identity); lease.lease_expires_at = new Date(Date.now() + 60000).toISOString(); persist(); return structuredClone(lease); },
    async prepareDeleteBatch(identity, paths) {
      guard(identity); assert.equal(lease.pending_paths.length, 0); lease.pending_paths = [...paths]; persist(); return structuredClone(lease);
    },
    async acknowledgeBatch(identity, paths) {
      guard(identity); if (ackFailure) throw new Error("Acknowledgement unavailable.");
      assert.deepEqual(paths, lease.pending_paths);
      assert.equal(paths.some(path => objects.has(path)), false, "The database must independently reject a missed pending object.");
      lease.pending_paths = []; persist(); return structuredClone(lease);
    },
    async markStorageEmpty(identity) {
      guard(identity); assert.equal(lease.pending_paths.length, 0);
      assert.equal([...objects].some(path => path.startsWith(`${PREFIX}/`)), false);
      lease.phase = "awaiting_backend_verification"; persist(); return structuredClone(lease);
    },
  };
  const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  const storage = new SupabaseDeletionStorage({ supabaseUrl: baseUrl, serviceKey: "synthetic-private-storage-key", timeoutMs: 500 });
  const worker = new ProjectDeletionWorker({ jobs: store, storage, pageSize: 2, batchSize: 100, operationTimeoutMs: 500 });
  return { objects, requests, worker, store, storage, baseUrl, jobPath, get lease() { return JSON.parse(readFileSync(jobPath, "utf8")) as ProjectDeletionLease; },
    deletion: (mode: typeof deleteMode) => { deleteMode = mode; }, listing: (mode: typeof listMode) => { listMode = mode; },
    afterDelete: (action: () => void) => { afterDelete = action; },
    holdPrepared: (value: boolean) => { holdPrepared = value; }, holdDeleted: (value: boolean) => { holdDeleted = value; },
    ackFailure: (value: boolean) => { ackFailure = value; },
    supersede: () => { lease.lease_token = "40000000-0000-4000-8000-000000000002"; persist(); },
    async close() { holdPrepared = false; holdDeleted = false; provider.close(); await once(provider, "close"); rmSync(directory, { recursive: true, force: true }); },
  };
}

test("whole stable paginated subtree includes orphans, preserves adjacent books and stops before backing attestation", async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 7; index++) f.objects.add(`${PREFIX}/snapshots/ciphertext-${index}.bin`);
    f.objects.add(`${PREFIX}/other/nested/orphan.bin`);
    f.objects.add(`projects/${OTHER}/snapshots/untouched.bin`);
    const result = await f.worker.runOnce(f.lease);
    assert.equal(result.phase, "deleting");
    assert.equal(result.acknowledged_paths, 8);
    assert.equal(f.objects.size, 1);
    const beforeDelete = f.requests.slice(0, f.requests.findIndex(row => row.method === "DELETE"));
    assert.ok(beforeDelete.some(row => row.body.offset === 2));
    assert.ok(beforeDelete.some(row => row.body.offset === 4));
    assert.equal((await f.worker.runOnce(f.lease)).phase, "awaiting_backend_verification");
    const count = f.requests.length;
    assert.equal((await f.worker.runOnce(f.lease)).phase, "awaiting_backend_verification");
    assert.equal(f.requests.length, count);
    for (const row of f.requests.filter(row => row.method === "DELETE")) assert.ok((row.body.prefixes as string[]).every(path => path.startsWith(`${PREFIX}/`)));
  } finally { await f.close(); }
});

test("unsafe, duplicate, foreign and malformed Storage lists never authorize a DELETE", async () => {
  for (const mode of ["duplicate", "foreign", "unsafe", "malformed"] as const) {
    const f = await fixture();
    try {
      f.objects.add(`${PREFIX}/snapshots/orphan.bin`); f.listing(mode);
      await assert.rejects(f.worker.runOnce(f.lease));
      assert.equal(f.requests.some(row => row.method === "DELETE"), false);
      assert.deepEqual(f.lease.pending_paths, []);
    } finally { await f.close(); }
  }
});

test("lost DELETE reply is reconciled by fresh listing and never blindly repeated", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`); f.deletion("lost");
    const result = await f.worker.runOnce(f.lease);
    assert.equal(result.acknowledged_paths, 1);
    assert.deepEqual(f.lease.pending_paths, []);
    assert.equal(f.requests.filter(row => row.method === "DELETE").length, 1);
    assert.ok(f.requests.at(-1)!.method === "POST");
  } finally { await f.close(); }
});

test("partial deletion retains immutable pending batch, reads it before retry and cannot mark completion", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/a.bin`); f.objects.add(`${PREFIX}/snapshots/b.bin`); f.deletion("partial");
    await assert.rejects(f.worker.runOnce(f.lease));
    assert.deepEqual(f.lease.pending_paths, [`${PREFIX}/snapshots/a.bin`, `${PREFIX}/snapshots/b.bin`]);
    assert.equal(f.lease.phase, "deleting");
    const oldCount = f.requests.length; f.deletion("normal");
    assert.equal((await f.worker.runOnce(f.lease)).acknowledged_paths, 2);
    assert.equal(f.requests[oldCount]!.method, "POST");
    assert.deepEqual(f.requests.filter(row => row.method === "DELETE").at(-1)!.body.prefixes, [`${PREFIX}/snapshots/b.bin`]);
  } finally { await f.close(); }
});

test("unavailable readback retains pending intent and does not claim Storage empty", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`);
    f.afterDelete(() => f.listing("refused")); f.deletion("lost");
    await assert.rejects(f.worker.runOnce(f.lease));
    assert.equal(f.lease.pending_paths.length, 1);
    assert.equal(f.lease.phase, "deleting");
    const count = f.requests.filter(row => row.method === "DELETE").length;
    await assert.rejects(f.worker.runOnce(f.lease));
    assert.equal(f.requests.filter(row => row.method === "DELETE").length, count);
  } finally { await f.close(); }
});

test("superseded lease after Storage response cannot acknowledge or advance the old job", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`); f.afterDelete(f.supersede);
    const oldLease = f.lease;
    await assert.rejects(f.worker.runOnce(oldLease));
    assert.equal(f.lease.pending_paths.length, 1);
    assert.equal(f.lease.phase, "deleting");
    assert.equal((await f.worker.runOnce(f.lease)).acknowledged_paths, 1);
    assert.equal(f.requests.filter(row => row.method === "DELETE").length, 1);
  } finally { await f.close(); }
});

test("failed durable acknowledgement resumes pending absent paths without another DELETE", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`); f.ackFailure(true);
    await assert.rejects(f.worker.runOnce(f.lease));
    assert.equal(f.lease.pending_paths.length, 1); f.ackFailure(false);
    assert.equal((await f.worker.runOnce(f.lease)).acknowledged_paths, 1);
    assert.equal(f.requests.filter(row => row.method === "DELETE").length, 1);
  } finally { await f.close(); }
});

test("the trusted RPC adapter preserves exact lease/path arguments and cannot finalize", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`);
    const jobs = new SupabaseProjectDeletionJobStore({ supabaseUrl: f.baseUrl, serviceKey: "synthetic-private-storage-key" });
    const worker = new ProjectDeletionWorker({ jobs, storage: f.storage });
    const claimed = await jobs.claim(IDENTITY.job_id);
    assert.equal((await worker.runOnce(claimed)).acknowledged_paths, 1);
    assert.equal((await worker.runOnce(f.lease)).phase, "awaiting_backend_verification");
    const calls = f.requests.filter(row => row.path.startsWith("/rest/v1/rpc/"));
    assert.equal(calls.some(row => row.path.includes("finalize")), false);
    for (const call of calls.slice(1)) {
      assert.equal(call.body.p_project_id, PROJECT); assert.equal(call.body.p_lease_token, IDENTITY.lease_token);
    }
  } finally { await f.close(); }
});

test("negative Storage inventory cannot bypass the independent pending-path database check", async () => {
  const f = await fixture();
  try {
    const path = `${PREFIX}/snapshots/orphan.bin`; f.objects.add(path);
    await f.store.prepareDeleteBatch(IDENTITY, [path]); f.listing("missing");
    await assert.rejects(f.worker.runOnce(f.lease));
    assert.deepEqual(f.lease.pending_paths, [path]); assert.equal(f.lease.phase, "deleting");
    assert.equal(f.requests.some(row => row.method === "DELETE"), false);
  } finally { await f.close(); }
});

test("inventory bounds and malformed lease scope block before any destructive request", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/deep/nested/orphan.bin`);
    const worker = new ProjectDeletionWorker({ jobs: f.store, storage: f.storage, maxDepth: 1 });
    await assert.rejects(worker.runOnce(f.lease));
    await assert.rejects(f.worker.runOnce({ ...f.lease, project_id: OTHER }));
    assert.equal(f.requests.some(row => row.method === "DELETE"), false);
  } finally { await f.close(); }
});

test("actual SIGKILL after durable prepare and after HTTP deletion resumes the same persisted batch", async () => {
  for (const stage of ["prepared", "deleted"] as const) {
    const f = await fixture();
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`);
    if (stage === "prepared") f.holdPrepared(true); else f.holdDeleted(true);
    const source = `
      import {ProjectDeletionWorker,SupabaseDeletionStorage,SupabaseProjectDeletionJobStore} from ${JSON.stringify(new URL("../src/projectDeletion.ts", import.meta.url).href)};
      const configuration={supabaseUrl:${JSON.stringify(f.baseUrl)},serviceKey:"synthetic-private-storage-key",timeoutMs:10000};
      const worker=new ProjectDeletionWorker({jobs:new SupabaseProjectDeletionJobStore(configuration),storage:new SupabaseDeletionStorage(configuration),operationTimeoutMs:10000});
      await worker.runOnce(${JSON.stringify(f.lease)});
      process.stdout.write("COMPLETE\\n");
    `;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errors = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.stderr.on("data", chunk => { errors += chunk.toString(); });
    try {
      const deadline = Date.now() + 5000;
      while (f.lease.pending_paths.length === 0 || (stage === "deleted" && f.objects.size > 0)) {
        assert.ok(Date.now() < deadline, errors); await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(output.includes("COMPLETE"), false);
      const exited = once(child, "exit"); child.kill("SIGKILL"); assert.equal((await exited)[1], "SIGKILL");
      assert.equal(f.lease.pending_paths.length, 1);
      f.holdPrepared(false); f.holdDeleted(false);
      const jobs = new SupabaseProjectDeletionJobStore({ supabaseUrl: f.baseUrl, serviceKey: "synthetic-private-storage-key" });
      const recovered = new ProjectDeletionWorker({ jobs, storage: f.storage });
      assert.equal((await recovered.runOnce(f.lease)).acknowledged_paths, 1);
      assert.deepEqual(f.lease.pending_paths, []); assert.equal(f.objects.size, 0);
      assert.equal(f.requests.filter(row => row.method === "DELETE").length, 1);
      assert.equal((await recovered.runOnce(f.lease)).phase, "awaiting_backend_verification");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await f.close();
    }
  }
});

test("HTTP timeouts and unsafe adapter configuration preserve the frozen job without leaking secrets", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`); f.listing("stalled");
    await assert.rejects(f.worker.runOnce(f.lease), error => {
      assert.equal(String(error).includes("synthetic-private-storage-key"), false);
      assert.equal(String(error).includes("private-source-data"), false);
      return true;
    });
    assert.equal(f.lease.phase, "deleting"); assert.deepEqual(f.lease.pending_paths, []);
    assert.equal(f.requests.some(row => row.method === "DELETE"), false);
    await assert.rejects(f.storage.remove([`${PREFIX}/a.bin`, `projects/${OTHER}/b.bin`]));
    await assert.rejects(f.storage.list("projects", 100, 0));
    for (const url of ["https://user:secret@fiction.supabase.co", "https://fiction.supabase.co/path", "http://remote.example", "not-a-url"]) {
      assert.throws(() => new SupabaseDeletionStorage({ supabaseUrl: url, serviceKey: "synthetic-private-storage-key" }), error => !String(error).includes("secret"));
    }
  } finally { f.listing("normal"); await f.close(); }
});

test("the actual isolated worker command drains confirmed batches and reports only metadata emptiness", async () => {
  const f = await fixture();
  try {
    f.objects.add(`${PREFIX}/snapshots/orphan.bin`);
    const child = spawn(process.execPath, ["--experimental-strip-types", new URL("../src/projectDeletionMain.ts", import.meta.url).pathname, "--job", IDENTITY.job_id], {
      env: { PATH: process.env.PATH, SUPABASE_URL: f.baseUrl, SUPABASE_DELETION_SERVICE_KEY: "synthetic-private-storage-key" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = ""; let errors = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); }); child.stderr.on("data", chunk => { errors += chunk.toString(); });
    assert.equal((await once(child, "exit"))[0], 0, errors);
    assert.deepEqual(JSON.parse(output), { job_id: IDENTITY.job_id, phase: "awaiting_backend_verification", acknowledged_paths: 1, runs: 2 });
    assert.equal(output.includes(IDENTITY.lease_token), false);
    assert.equal((output + errors).includes("synthetic-private-storage-key"), false);
    assert.equal(f.requests.some(row => row.path.includes("finalize")), false);
  } finally { await f.close(); }
});

test("the actual isolated command fails closed without printing configuration or private response text", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", new URL("../src/projectDeletionMain.ts", import.meta.url).pathname, "--job", IDENTITY.job_id], {
    env: { PATH: process.env.PATH, SUPABASE_URL: "https://user:secret@fiction.supabase.co", SUPABASE_DELETION_SERVICE_KEY: "synthetic-private-storage-key" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; let errors = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); }); child.stderr.on("data", chunk => { errors += chunk.toString(); });
  assert.equal((await once(child, "exit"))[0], 1);
  assert.equal(output, ""); assert.ok(errors.includes('{"event":"project_deletion_incomplete"}'));
  assert.equal(errors.includes("secret"), false); assert.equal(errors.includes("fiction.supabase.co"), false);
});

test("canonical SQL UUIDs beyond RFC versions 1–5 are accepted, while lease durations align with SQL", async () => {
  const f = await fixture();
  try {
    const unsupported = new SupabaseProjectDeletionJobStore({ supabaseUrl: f.baseUrl, serviceKey: "synthetic-private-storage-key", leaseSeconds: 15 });
    await assert.rejects(unsupported.claim("30000000-0000-7000-8000-000000000001"));
    assert.ok(f.requests.some(row => row.body.p_job_id === "30000000-0000-7000-8000-000000000001"));
    assert.throws(() => new SupabaseProjectDeletionJobStore({ supabaseUrl: f.baseUrl, serviceKey: "synthetic-private-storage-key", leaseSeconds: 14 }));
  } finally { await f.close(); }
});
