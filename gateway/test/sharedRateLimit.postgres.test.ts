import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import test from "node:test";

import { SupabaseRpcSessionRateLimiter } from "../src/supabaseRateLimiter.ts";
import { createSessionGateway } from "../src/sessionGateway.ts";
import { FakeRealtimeUpstream } from "../src/fakeRealtimeUpstream.ts";
import type { GatewayPolicy } from "../src/types.ts";

const run = promisify(execFile);
const pgSocket = process.env.OPENAUTHOR_TEST_PG_SOCKET;
const pgBin = process.env.OPENAUTHOR_TEST_PG_BIN;
const pgData = process.env.OPENAUTHOR_TEST_PG_DATA;
const id = (prefix: number, suffix: number) => `${prefix}0000000-0000-0000-0000-${String(suffix).padStart(12, "0")}`;
const claims = (device: number) => ({ sub: id(1, device === 3 ? 2 : 1), device_id: id(4, device), session_id: id(9, device) });

test("real SQL quota is shared atomically across gateway replicas/devices/books and survives database restart", { skip: !pgSocket }, async () => {
  assert.ok(pgBin && pgData);
  async function sql(statement: string): Promise<string> {
    return (await run(`${pgBin}/psql`, ["-h", pgSocket!, "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement])).stdout.trim();
  }
  let lostResponse = false;
  // The real HTTP adapter uses PostgreSQL RPC execution through a loopback REST
  // fixture. JWT signature verification is separately covered by JWKS tests.
  const rest = createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/rest/v1/rpc/mobile_consume_realtime_rate_limit");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.apikey, "fiction-publishable");
      const device = Number(/^Bearer fixture-device-([123])$/.exec(request.headers.authorization ?? "")?.[1]);
      assert.ok([1, 2, 3].includes(device));
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      for (const key of ["p_project_id", "p_device_id"]) assert.match(body[key], /^[0-9a-f-]{36}$/);
      for (const key of ["p_expected_limit", "p_expected_window_ms"]) assert.ok(Number.isSafeInteger(body[key]));
      const value = await sql(`begin; set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify(claims(device))}', true);
        select public.mobile_consume_realtime_rate_limit('${body.p_project_id}', '${body.p_device_id}', ${body.p_expected_limit}, ${body.p_expected_window_ms}); commit;`);
      if (lostResponse) { lostResponse = false; response.destroy(); return; }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(value.split("\n").at(-1));
    } catch {
      response.writeHead(403);
      response.end("private fixture database details");
    }
  });
  rest.listen(0, "127.0.0.1");
  await once(rest, "listening");
  const port = (rest.address() as AddressInfo).port;
  function replica(limit = 5, windowMs = 60_000) {
    return new SupabaseRpcSessionRateLimiter({
      supabaseUrl: "https://fiction.supabase.co", publishableKey: "fiction-publishable", limit, windowMs,
      fetchImpl: (url, init) => fetch(`http://127.0.0.1:${port}${new URL(String(url)).pathname}`, init),
    });
  }
  function request(device = 1, project = 1) {
    return { principal: { subject: claims(device).sub, tenantId: "tenant-fiction", deviceId: id(4, device), bearerToken: `fixture-device-${device}` }, projectId: id(3, project), deviceId: id(4, device) };
  }
  try {
    assert.equal(await sql("select has_table_privilege('authenticated', 'public.mobile_realtime_rate_windows', 'SELECT') or has_table_privilege('authenticated', 'public.mobile_realtime_rate_policy', 'UPDATE') or has_function_privilege('anon', 'public.mobile_consume_realtime_rate_limit(uuid,uuid,integer,integer)', 'EXECUTE');"), "f");
    await assert.rejects(sql("set role authenticated; update public.mobile_realtime_rate_policy set issuance_limit = 1000;"));
    const replicas = [replica(), replica()];
    const decisions = await Promise.all(Array.from({ length: 24 }, (_, i) => replicas[i % 2]!.consume(`client-changed-${i}`, i % 2 ? 0 : 9e12, request(i % 2 + 1, i % 2 + 1))));
    assert.equal(decisions.filter(v => v.allowed).length, 5);
    assert.equal(decisions.filter(v => !v.allowed).length, 19);
    assert.equal(await sql(`select issuance_count from public.mobile_realtime_rate_windows where user_id = '${id(1, 1)}'`), "5");
    assert.equal((await replica().consume("new-gateway-key", 9e12, request())).allowed, false);
    assert.equal((await replica().consume("other-user", 0, request(3, 3))).allowed, true);
    await assert.rejects(replica(1000).consume("policy-change", 0, request()));
    await assert.rejects(replica().consume("wrong-project", 0, request(1, 3)));
    await sql(`update public.mobile_devices set revoked_at = now(), revocation_reason_code = 'fixture-revoked' where id = '${id(4, 2)}';`);
    await assert.rejects(replica().consume("revoked", 0, request(2)));
    await sql(`update public.mobile_devices set revoked_at = null, revocation_reason_code = null where id = '${id(4, 2)}';`);
    await assert.rejects(sql(`begin; set local role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ ...claims(1), session_id: id(9, 99) })}', true); select public.mobile_consume_realtime_rate_limit('${id(3, 1)}', '${id(4, 1)}', 5, 60000); commit;`));
    await run(`${pgBin}/pg_ctl`, ["-D", pgData, "-l", `${pgData}/server.log`, "-m", "fast", "-w", "restart"]);
    assert.equal((await replica().consume("after-database-restart", 0, request())).allowed, false);
    await sql(`update public.mobile_realtime_rate_windows set started_at = clock_timestamp() - interval '61 seconds' where user_id = '${id(1, 1)}';`);
    assert.equal((await replica().consume("next-window", 0, request())).allowed, true);
    assert.equal(await sql(`select issuance_count from public.mobile_realtime_rate_windows where user_id = '${id(1, 1)}'`), "1");
    lostResponse = true;
    await assert.rejects(replica().consume("lost-committed-response", 0, request()));
    assert.equal(await sql(`select issuance_count from public.mobile_realtime_rate_windows where user_id = '${id(1, 1)}'`), "2", "the lost response consumed once and the adapter did not retry");
    assert.equal((await replica().consume("deliberate-next-request", 0, request())).allowed, true);

    await sql("truncate public.mobile_realtime_rate_windows;");
    const policy: GatewayPolicy = {
      allowedOrigins: [], maxRequestBytes: 16384, maxSdpBytes: 12288, requestBodyTimeoutMs: 1000,
      model: "gpt-realtime", voice: "marin", transcriptionModel: "gpt-4o-mini-transcribe", semanticVadEagerness: "low",
      instructions: "Synthetic local quota test.", tools: [], allowedToolNames: [], issuanceTtlSeconds: 60,
      safetyIdentifierSecret: "fiction-safety-secret-at-least-32-bytes",
    };
    const upstreams = [new FakeRealtimeUpstream({ sdp: "v=0\r\ns=answer\r\n" }), new FakeRealtimeUpstream({ sdp: "v=0\r\ns=answer\r\n" })];
    const gateways = upstreams.map(upstream => createSessionGateway({ policy, dependencies: {
      principalVerifier: { verify: async header => {
        const device = Number(/^Bearer fixture-device-([12])$/.exec(header ?? "")?.[1]);
        return [1, 2].includes(device) ? request(device).principal : null;
      } },
      authorizer: { authorize: async () => true }, rateLimiter: replica(), upstream,
      auditSink: { write: async () => {} }, clock: { now: () => new Date(0) },
    } }));
    try {
      for (const gateway of gateways) { gateway.listen(0, "127.0.0.1"); await once(gateway, "listening"); }
      const responses = await Promise.all(Array.from({ length: 24 }, (_, i) => {
        const gateway = gateways[i % 2]!;
        const address = gateway.address() as AddressInfo;
        return fetch(`http://127.0.0.1:${address.port}/v1/realtime/sessions`, {
          method: "POST", headers: { authorization: `Bearer fixture-device-${i % 2 + 1}`, "content-type": "application/json" },
          body: JSON.stringify({ project_id: id(3, i % 2 + 1), device_id: id(4, i % 2 + 1), sdp: "v=0\r\ns=offer\r\n" }),
        });
      }));
      assert.equal(responses.filter(response => response.status === 201).length, 5);
      assert.equal(responses.filter(response => response.status === 429).length, 19);
      assert.equal(upstreams.reduce((count, upstream) => count + upstream.calls.length, 0), 5);
      for (const response of responses) {
        if (response.status === 429) assert.ok(Number(response.headers.get("retry-after")) >= 1);
        await response.body?.cancel();
      }
      for (const revoke of ["device", "membership"]) {
        await sql(`update public.mobile_realtime_rate_windows set started_at = clock_timestamp(), issuance_count = 0 where user_id = '${id(1, 1)}';`);
        const holder = spawn(`${pgBin}/psql`, ["-h", pgSocket!, "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]);
        const exited = once(holder, "exit");
        const held = new Promise<void>((resolve, reject) => {
          let output = "";
          const deadline = setTimeout(() => reject(new Error("Quota-lock fixture did not start.")), 3_000);
          holder.stdout.on("data", chunk => {
            output += String(chunk);
            if (output.includes("QUOTA_HELD")) { clearTimeout(deadline); resolve(); }
          });
          holder.once("error", error => { clearTimeout(deadline); reject(error); });
        });
        holder.stdin.write(`begin; select user_id from public.mobile_realtime_rate_windows where user_id = '${id(1, 1)}' for update;\n\\echo QUOTA_HELD\n`);
        let pending: Promise<Response> | undefined;
        let upstreamCount = 0;
        try {
          await held;
          upstreamCount = upstreams.reduce((count, upstream) => count + upstream.calls.length, 0);
          const address = gateways[1]!.address() as AddressInfo;
          pending = fetch(`http://127.0.0.1:${address.port}/v1/realtime/sessions`, {
            method: "POST", headers: { authorization: "Bearer fixture-device-2", "content-type": "application/json" },
            body: JSON.stringify({ project_id: id(3, 2), device_id: id(4, 2), sdp: "v=0\r\ns=queued-offer\r\n" }),
          });
          let waiting = false;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            waiting = await sql("select exists(select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%mobile_consume_realtime_rate_limit%');") === "t";
            if (waiting) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(waiting, true, "the authorized request must really wait on another transaction's quota row");
          if (revoke === "device") await sql(`update public.mobile_devices set revoked_at = now(), revocation_reason_code = 'fixture-revoked' where id = '${id(4, 2)}';`);
          else await sql(`delete from public.workspace_members where workspace_id = '${id(2, 1)}' and user_id = '${id(1, 1)}';`);
        } finally {
          holder.stdin.end("commit;\n");
          await exited;
        }
        try {
          assert.ok(pending);
          const response = await pending;
          assert.equal(response.status, 500, `a queued ${revoke} revocation must refuse issuance`);
          await response.body?.cancel();
          assert.equal(await sql(`select issuance_count from public.mobile_realtime_rate_windows where user_id = '${id(1, 1)}'`), "0");
          assert.equal(upstreams.reduce((count, upstream) => count + upstream.calls.length, 0), upstreamCount);
        } finally {
          if (revoke === "device") await sql(`update public.mobile_devices set revoked_at = null, revocation_reason_code = null where id = '${id(4, 2)}';`);
          else await sql(`insert into public.workspace_members (workspace_id, user_id, role) values ('${id(2, 1)}', '${id(1, 1)}', 'owner');`);
        }
      }
    } finally {
      for (const gateway of gateways) { const closed = once(gateway, "close"); gateway.close(); await closed; }
    }
  } finally {
    rest.close();
    await once(rest, "close");
  }
});
