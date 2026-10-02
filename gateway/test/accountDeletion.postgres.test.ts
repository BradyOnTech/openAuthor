import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import test from "node:test";
import { createAccountDeletionWorker, finalizeAccountAuth, SupabaseAccountDeletionAuthAdmin, SupabaseAccountDeletionJobStore } from "../src/accountDeletion.ts";

const execute = promisify(execFile);
const socket = process.env.OPENAUTHOR_TEST_PG_SOCKET;
const binaries = process.env.OPENAUTHOR_TEST_PG_BIN;
const uuid = (kind: number, suffix = 1) => `c${kind}000000-0000-7000-8000-${String(suffix).padStart(12, "0")}`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

test("reviewed account intent drains multiple actual SQL children through production HTTP adapters, then requires verifier and guarded Auth", { skip: !socket }, async () => {
  assert.ok(binaries);
  const sql = async (statement: string) => (await execute(`${binaries}/psql`, ["-h", socket!, "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement])).stdout.trim();
  const user = uuid(1), otherUser = uuid(1, 2), workspace = uuid(2), otherWorkspace = uuid(2, 2), projects = [uuid(3), uuid(3, 2)], adjacent = uuid(3, 3), device = uuid(4), key = uuid(5), session = uuid(9);
  const claims = JSON.stringify({ sub: user, session_id: session, device_id: device });
  const choices = JSON.stringify({ workspaces: [{ workspace_id: workspace, action: "delete" }], projects: projects.map(project_id => ({ project_id, action: "delete", outbox: "preserve" })) });
  await sql(`insert into auth.users(id) values (${literal(user)}),(${literal(otherUser)});
    insert into auth.sessions(id,user_id) values (${literal(session)},${literal(user)});
    insert into public.workspaces(id,name,slug) values (${literal(workspace)},'Account fixture','account-http'),(${literal(otherWorkspace)},'Other author','other-http');
    insert into public.workspace_members(workspace_id,user_id,role) values (${literal(workspace)},${literal(user)},'owner'),(${literal(otherWorkspace)},${literal(otherUser)},'owner');
    insert into public.projects(id,workspace_id,name,slug,created_by) values
      (${literal(projects[0]!)},${literal(workspace)},'First','first',${literal(user)}),
      (${literal(projects[1]!)},${literal(workspace)},'Second','second',${literal(user)}),
      (${literal(adjacent)},${literal(otherWorkspace)},'Adjacent','adjacent',${literal(otherUser)});
    set role authenticated; select set_config('request.jwt.claims',${literal(claims)},false);
    select public.mobile_register_device(${literal(device)},${literal(key)},'desktop','Synthetic account','x25519-v1',decode(${literal(createHash("sha256").update(key).digest("hex"))},'hex')); reset role;`);
  const paths = [
    ...Array.from({ length: 140 }, (_, index) => `projects/${projects[0]}/snapshots/${uuid(6, index + 1)}.bin`),
    `projects/${projects[0]}/orphans/盒子/book.bin`, `projects/${projects[1]}/orphan.bin`, `projects/${adjacent}/untouched.bin`,
  ];
  await sql(`insert into storage.objects(bucket_id,name) values ${paths.map(path => `('mobile-encrypted-sync',${literal(path)})`).join(",")};`);
  const preflight = JSON.parse((await sql(`begin; set local role authenticated; select set_config('request.jwt.claims',${literal(claims)},true);
    select public.mobile_account_deletion_preflight(${literal(device)}); commit;`)).split("\n").at(-1)!) as { inventory_sha256: string };
  const job = JSON.parse((await sql(`begin; set local role authenticated; select set_config('request.jwt.claims',${literal(claims)},true);
    select public.mobile_begin_account_deletion(${literal(device)},${literal(preflight.inventory_sha256)},${literal(choices)}::jsonb,false); commit;`)).split("\n").at(-1)!) as { job_id: string };
  await sql(`delete from auth.sessions where id=${literal(session)};`);
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let authDeletes = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      const path = request.url!; requests.push({ path, method: request.method!, body });
      if (path === `/auth/v1/admin/users/${user}`) {
        assert.equal(request.method, "DELETE"); assert.equal(request.headers.authorization, "Bearer synthetic-auth-administrator");
        assert.equal(request.headers.apikey, "synthetic-auth-administrator"); assert.deepEqual(body, { should_soft_delete: false });
        authDeletes++; await sql(`delete from auth.users where id=${literal(user)};`);
        // Auth committed, but its administrative reply is lost. The adapter
        // must reconcile the positive SQL receipt without repeating DELETE.
        response.destroy(); return;
      }
      assert.equal(request.headers.authorization, "Bearer synthetic-account-storage"); assert.equal(request.headers.apikey, "synthetic-account-storage");
      if (path.startsWith("/rest/v1/rpc/")) {
        assert.equal(request.method, "POST"); const name = path.split("/").at(-1)!;
        const shapes: Record<string, string[]> = {
          mobile_get_account_deletion_worker: ["p_job_id"], mobile_list_account_deletion_work: ["p_after_job_id", "p_limit"],
          mobile_claim_project_deletion: ["p_job_id", "p_lease_seconds"],
          mobile_renew_project_deletion_lease: ["p_job_id", "p_project_id", "p_lease_token", "p_lease_seconds"],
          mobile_prepare_project_deletion_batch: ["p_job_id", "p_project_id", "p_lease_token", "p_paths"],
          mobile_ack_project_deletion_batch: ["p_job_id", "p_project_id", "p_lease_token", "p_paths"],
          mobile_mark_project_deletion_storage_empty: ["p_job_id", "p_project_id", "p_lease_token"],
        };
        assert.ok(Object.hasOwn(shapes, name)); assert.deepEqual(Object.keys(body).sort(), [...shapes[name]!].sort());
        const values = shapes[name]!.map(field => {
          const value = body[field];
          if (["p_lease_seconds", "p_limit"].includes(field)) { assert.ok(Number.isSafeInteger(value)); return String(value); }
          if (field === "p_paths") { assert.ok(Array.isArray(value) && value.every(path => typeof path === "string")); return `ARRAY[${value.map(path => literal(String(path))).join(",")}]::text[]`; }
          if (field === "p_after_job_id" && value === null) return "null::uuid";
          assert.equal(typeof value, "string"); assert.match(value as string, /^[0-9a-f-]{36}$/); return `${literal(String(value))}::uuid`;
        });
        const result = await sql(`begin; set local role service_role; select public.${name}(${values.join(",")}); commit;`);
        response.setHeader("content-type", "application/json"); response.end(result);
      } else if (path === "/storage/v1/object/list/mobile-encrypted-sync" && request.method === "POST") {
        assert.equal(typeof body.prefix, "string"); assert.ok(Number.isSafeInteger(body.limit) && Number.isSafeInteger(body.offset));
        assert.deepEqual(body.sortBy, { column: "name", order: "asc" });
        const all = JSON.parse(await sql("select coalesce(json_agg(name),'[]'::json) from storage.objects where bucket_id='mobile-encrypted-sync';")) as string[];
        const entries = new Map<string, { name: string; id: string | null; metadata: object | null }>();
        for (const path of all) {
          const prefix = `${body.prefix}/`; if (!path.startsWith(prefix)) continue;
          const [child, ...tail] = path.slice(prefix.length).split("/");
          entries.set(child!, { name: child!, id: tail.length ? null : uuid(8), metadata: tail.length ? null : { size: 32 } });
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify([...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(Number(body.offset), Number(body.offset) + Number(body.limit))));
      } else if (path === "/storage/v1/object/mobile-encrypted-sync" && request.method === "DELETE") {
        assert.ok(Array.isArray(body.prefixes) && body.prefixes.length > 0 && body.prefixes.every(path => typeof path === "string" && projects.some(project => path.startsWith(`projects/${project}/`))));
        const removed = await sql(`with removed as (delete from storage.objects where bucket_id='mobile-encrypted-sync' and name=any(ARRAY[${body.prefixes.map(path => literal(String(path))).join(",")}]::text[]) returning name) select coalesce(json_agg(json_build_object('name',name)),'[]'::json) from removed;`);
        response.setHeader("content-type", "application/json"); response.end(removed);
      } else throw new Error("Unsupported fixture route");
    } catch { response.writeHead(409); response.end("private synthetic author/backend detail"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const options = { supabaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, serviceKey: "synthetic-account-storage" };
  const jobs = new SupabaseAccountDeletionJobStore(options), worker = createAccountDeletionWorker(options);
  const auth = new SupabaseAccountDeletionAuthAdmin({ ...options, serviceKey: "synthetic-auth-administrator" });
  try {
    assert.ok((await jobs.list(null, 100)).some(item => item.job_id === job.job_id));
    assert.equal((await worker.runOnce(job.job_id)).children_pending, 1);
    const drained = await worker.runOnce(job.job_id);
    assert.equal(drained.children_pending, 0); assert.equal(drained.awaiting_backend_verification, 2);
    const before = requests.length; await worker.runOnce(job.job_id);
    assert.equal(requests.slice(before).some(item => item.method === "DELETE" || item.path.includes("claim")), false);
    assert.equal(requests.filter(item => item.path === "/storage/v1/object/mobile-encrypted-sync").length, 3);
    assert.ok(requests.some(item => item.body.offset === 100));
    await assert.rejects(finalizeAccountAuth(jobs, auth, job.job_id, preflight.inventory_sha256)); assert.equal(authDeletes, 0);
    assert.equal(await sql(`select count(*) from storage.objects where starts_with(name,'projects/${projects[0]}/') or starts_with(name,'projects/${projects[1]}/');`), "0");
    assert.equal(await sql(`select count(*) from public.projects where id=any(ARRAY[${projects.map(literal).join(",")}]::uuid[]);`), "2");
    assert.equal(requests.some(item => item.path.includes("finalize") || item.path.includes("prepare_account")), false);
    // Deliberately simulated independent receipts. This fixture has no physical
    // blob store or failed-upload queue, so it cannot establish backing purge.
    const children = JSON.parse(await sql(`select json_agg(json_build_object('job',job_id,'project',project_id,'token',lease_token)) from public.mobile_project_deletion_jobs where requested_by=${literal(user)};`)) as Array<{ job: string; project: string; token: string }>;
    for (const child of children) await sql(`begin; set local role mobile_deletion_verifier; select public.mobile_finalize_project_deletion(${literal(child.job)},${literal(child.project)},${literal(child.token)},repeat('ab',32)); commit;`);
    await sql(`begin; set local role mobile_deletion_verifier; select public.mobile_prepare_account_auth_finalization(${literal(job.job_id)},${literal(preflight.inventory_sha256)},repeat('cd',32)); commit;`);
    assert.equal((await finalizeAccountAuth(jobs, auth, job.job_id, preflight.inventory_sha256)).phase, "finalized");
    await finalizeAccountAuth(jobs, auth, job.job_id, preflight.inventory_sha256); assert.equal(authDeletes, 1);
    assert.equal(await sql(`select count(*) from auth.users where id=${literal(user)};`), "0");
    assert.equal(await sql(`select count(*) from public.projects where id=${literal(adjacent)};`), "1");
    assert.equal(await sql(`select count(*) from storage.objects where name=${literal(paths.at(-1)!)};`), "1");
    assert.equal((await jobs.list(null, 100)).some(item => item.job_id === job.job_id), false);
  } finally { server.close(); await once(server, "close"); }
});
