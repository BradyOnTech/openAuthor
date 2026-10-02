import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import test from "node:test";

import { ProjectDeletionWorker, SupabaseDeletionStorage, SupabaseProjectDeletionJobStore } from "../src/projectDeletion.ts";
import type { ProjectDeletionLease } from "../src/projectDeletion.ts";

const execute = promisify(execFile);
const socket = process.env.OPENAUTHOR_TEST_PG_SOCKET;
const binaries = process.env.OPENAUTHOR_TEST_PG_BIN;
const uuid = (kind: number, suffix = 1) => `a${kind}000000-0000-7000-8000-${String(suffix).padStart(12, "0")}`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

test("real leased deletion RPCs reconcile orphan Storage metadata and stop at the independent verifier boundary", { skip: !socket }, async () => {
  assert.ok(binaries);
  const sql = async (statement: string): Promise<string> => (await execute(`${binaries}/psql`, ["-h", socket!, "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement])).stdout.trim();
  const user = uuid(1), workspace = uuid(2), project = uuid(3), staleProject = uuid(3, 2), adjacent = uuid(3, 3), device = uuid(4), deviceKey = uuid(5), session = uuid(9);
  const publicKeyHex = createHash("sha256").update(deviceKey).digest("hex");
  const claims = { sub: user, session_id: session, device_id: device };
  await sql(`insert into auth.users(id) values (${literal(user)});
    insert into auth.sessions(id,user_id) values (${literal(session)},${literal(user)});
    insert into public.workspaces(id,name,slug) values (${literal(workspace)},'Deletion fixture','deletion-fixture');
    insert into public.workspace_members(workspace_id,user_id,role) values (${literal(workspace)},${literal(user)},'owner');
    insert into public.projects(id,workspace_id,name,slug,created_by) values
      (${literal(project)},${literal(workspace)},'Drain','drain',${literal(user)}),
      (${literal(staleProject)},${literal(workspace)},'Replace lease','replace-lease',${literal(user)}),
      (${literal(adjacent)},${literal(workspace)},'Untouched','untouched',${literal(user)});
    set role authenticated;
    select set_config('request.jwt.claims',${literal(JSON.stringify(claims))},false);
    select public.mobile_register_device(${literal(device)},${literal(deviceKey)},'desktop','Deletion fixture','x25519-v1',decode(${literal(publicKeyHex)},'hex'));
    select public.mobile_enroll_project_device(${literal(device)},${literal(project)},${literal(device)});
    select public.mobile_enroll_project_device(${literal(device)},${literal(staleProject)},${literal(device)});
    reset role;`);
  const objects = [
    ...Array.from({ length: 7 }, (_, index) => `projects/${project}/snapshots/${uuid(6, index + 1)}.bin`),
    `projects/${project}/orphan copies/盒子/orphan.bin`,
    `projects/${staleProject}/snapshots/${uuid(6, 20)}.bin`,
    `projects/${adjacent}/snapshots/${uuid(6, 99)}.bin`,
  ];
  await sql(`insert into storage.objects(bucket_id,name) values ${objects.map(path => `('mobile-encrypted-sync',${literal(path)})`).join(",")};`);
  const begin = async (target: string) => JSON.parse((await sql(`begin; set local role authenticated;
    select set_config('request.jwt.claims',${literal(JSON.stringify(claims))},true);
    select public.mobile_begin_project_deletion(${literal(device)},${literal(target)}); commit;`)).split("\n").at(-1)!) as { job_id: string };
  const first = await begin(project), second = await begin(staleProject);
  // The durable owner-approved intent remains after the originating session is
  // gone. No author JWT is reused by the trusted Storage worker.
  await sql(`delete from auth.sessions where id=${literal(session)};`);
  let supersedeAfterDelete = false;
  let replacement: ProjectDeletionLease | undefined;
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let jobs: SupabaseProjectDeletionJobStore;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, "Bearer synthetic-deletion-service");
      assert.equal(request.headers.apikey, "synthetic-deletion-service");
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      const path = request.url!; requests.push({ path, method: request.method!, body });
      if (path.startsWith("/rest/v1/rpc/")) {
        const name = path.split("/").at(-1)!;
        const shapes: Record<string, string[]> = {
          mobile_claim_project_deletion: ["p_job_id", "p_lease_seconds"],
          mobile_renew_project_deletion_lease: ["p_job_id", "p_project_id", "p_lease_token", "p_lease_seconds"],
          mobile_prepare_project_deletion_batch: ["p_job_id", "p_project_id", "p_lease_token", "p_paths"],
          mobile_ack_project_deletion_batch: ["p_job_id", "p_project_id", "p_lease_token", "p_paths"],
          mobile_mark_project_deletion_storage_empty: ["p_job_id", "p_project_id", "p_lease_token"],
        };
        assert.ok(Object.hasOwn(shapes, name)); assert.deepEqual(Object.keys(body).sort(), [...shapes[name]!].sort());
        const values = shapes[name]!.map(key => {
          const value = body[key];
          if (key === "p_lease_seconds") { assert.ok(Number.isSafeInteger(value)); return String(value); }
          if (key === "p_paths") { assert.ok(Array.isArray(value) && value.every(path => typeof path === "string")); return `ARRAY[${value.map(path => literal(path)).join(",")}]::text[]`; }
          assert.equal(typeof value, "string"); assert.match(value as string, /^[0-9a-f-]{36}$/); return `${literal(value as string)}::uuid`;
        });
        const result = await sql(`begin; set local role service_role; select public.${name}(${values.join(",")}); commit;`);
        response.setHeader("content-type", "application/json"); response.end(result);
      } else if (path === "/storage/v1/object/list/mobile-encrypted-sync" && request.method === "POST") {
        assert.equal(typeof body.prefix, "string"); assert.ok(Number.isSafeInteger(body.limit) && Number.isSafeInteger(body.offset));
        assert.deepEqual(body.sortBy, { column: "name", order: "asc" });
        const all = JSON.parse(await sql("select coalesce(json_agg(name),'[]'::json) from storage.objects where bucket_id='mobile-encrypted-sync';")) as string[];
        const entries = new Map<string, { name: string; id: string | null; metadata: object | null }>();
        for (const name of all) {
          const prefix = `${body.prefix}/`; if (!name.startsWith(prefix)) continue;
          const [child, ...tail] = name.slice(prefix.length).split("/");
          entries.set(child!, { name: child!, id: tail.length ? null : uuid(8), metadata: tail.length ? null : { size: 32 } });
        }
        const rows = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(Number(body.offset), Number(body.offset) + Number(body.limit));
        response.setHeader("content-type", "application/json"); response.end(JSON.stringify(rows));
      } else if (path === "/storage/v1/object/mobile-encrypted-sync" && request.method === "DELETE") {
        assert.ok(Array.isArray(body.prefixes) && body.prefixes.length > 0 && body.prefixes.every(path => typeof path === "string" && [project, staleProject].some(target => path.startsWith(`projects/${target}/`))));
        // This deletion models the Storage API's successful metadata effect. It
        // does not contain a backing object store or failed-upload cleanup queue.
        const result = await sql(`with removed as (delete from storage.objects where bucket_id='mobile-encrypted-sync'
          and name=any(ARRAY[${body.prefixes.map(path => literal(String(path))).join(",")}]::text[]) returning name)
          select coalesce(json_agg(json_build_object('name',name)),'[]'::json) from removed;`);
        if (supersedeAfterDelete) {
          supersedeAfterDelete = false;
          await sql(`update public.mobile_project_deletion_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where project_id=${literal(staleProject)};`);
          replacement = await jobs.claim(second.job_id);
        }
        response.setHeader("content-type", "application/json"); response.end(result);
      } else throw new Error("Unsupported fixture request.");
    } catch { response.writeHead(409); response.end("private synthetic database detail"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const options = { supabaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, serviceKey: "synthetic-deletion-service" };
  jobs = new SupabaseProjectDeletionJobStore(options);
  const worker = new ProjectDeletionWorker({ jobs, storage: new SupabaseDeletionStorage(options), pageSize: 2, batchSize: 3 });
  try {
    let lease = await jobs.claim(first.job_id);
    let count = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await worker.runOnce(lease); count += result.acknowledged_paths;
      lease = await jobs.assertLease(lease); if (result.phase === "awaiting_backend_verification") break;
    }
    assert.equal(count, 8); assert.equal(lease.phase, "awaiting_backend_verification");
    assert.ok(requests.some(row => row.body.offset === 2));
    assert.equal(await sql(`select count(*) from storage.objects where starts_with(name,'projects/${project}/');`), "0");
    const oldLease = await jobs.claim(second.job_id); supersedeAfterDelete = true;
    await assert.rejects(worker.runOnce(oldLease)); assert.ok(replacement);
    assert.equal((await jobs.assertLease(replacement)).pending_paths.length, 1);
    const previousDeletes = requests.filter(row => row.method === "DELETE").length;
    assert.equal((await worker.runOnce(replacement)).acknowledged_paths, 1);
    assert.equal(requests.filter(row => row.method === "DELETE").length, previousDeletes);
    assert.equal((await worker.runOnce(replacement)).phase, "awaiting_backend_verification");
    assert.equal(await sql("select has_function_privilege('service_role','public.mobile_finalize_project_deletion(uuid,uuid,uuid,text)','EXECUTE');"), "f");
    await assert.rejects(sql(`set role service_role; select public.mobile_finalize_project_deletion(${literal(lease.job_id)},${literal(project)},${literal(lease.lease_token)},repeat('ab',32));`));
    assert.equal(await sql(`select count(*) from public.projects where id in (${literal(project)},${literal(staleProject)},${literal(adjacent)});`), "3");
    assert.equal(await sql(`select count(*) from storage.objects where name=${literal(objects.at(-1)!)};`), "1");
    assert.equal(requests.some(row => row.path.includes("finalize")), false);
  } finally { server.close(); await once(server, "close"); }
});
