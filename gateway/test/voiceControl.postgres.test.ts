import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { SupabaseControllerVoiceControl, SupabaseGatewayVoiceControl, voiceCredentialBinding, voiceRecord } from "../src/sharedVoiceControl.ts";
import { CallJournal } from "../src/callJournal.ts";
import { OpenAIRealtimeUpstream } from "../src/openAIRealtimeUpstream.ts";
import { SessionLeases } from "../src/sessionLeases.ts";
import { ControllerJournal, VoiceControllerWorker } from "../src/voiceControllerWorker.ts";

const execute = promisify(execFile), socket = process.env.OPENAUTHOR_TEST_PG_SOCKET, binaries = process.env.OPENAUTHOR_TEST_PG_BIN, data = process.env.OPENAUTHOR_TEST_PG_DATA;
const literal = (value: string) => `'${value.replace(/'/g,"''")}'`;
const token = (role: string) => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({role,exp:4102444800})).toString("base64url")}.synthetic`;
const CALL = { requestId: "synthetic-shared-control", sdp: "v=0\r\ns=private-offer\r\n", session: {
  type: "realtime" as const, model: "gpt-realtime", instructions: "private-context-not-persisted", output_modalities: ["audio"] as ["audio"],
  audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad" as const, eagerness: "low" as const, create_response: true as const, interrupt_response: true as const } }, output: { voice: "marin" } },
  tools: [], tool_choice: "none" as const, safety_identifier: "synthetic",
} };
async function eventually(predicate: () => boolean | Promise<boolean>, timeout = 7000) {
  const until = Date.now()+timeout;
  while (!await predicate()) { if (Date.now()>until) assert.fail("Bounded independent call-control transition missing."); await new Promise(resolve=>setTimeout(resolve,20)); }
}

async function fixture() {
  assert.ok(socket && binaries);
  const sql = async (statement: string) => (await execute(`${binaries}/psql`,["-h",socket!,"-d","postgres","-X","-qAt","-v","ON_ERROR_STOP=1","-c",statement])).stdout.trim();
  const user=randomUUID(), project=randomUUID(), workspace=randomUUID(), device=randomUUID(), key=randomUUID(), session=randomUUID();
  const claims={sub:user,device_id:device,session_id:session};
  await sql(`insert into auth.users(id) values(${literal(user)});insert into auth.sessions(id,user_id) values(${literal(session)},${literal(user)});
    insert into public.workspaces(id,name,slug) values(${literal(workspace)},'Shared voice',${literal(workspace)});
    insert into public.workspace_members(workspace_id,user_id,role) values(${literal(workspace)},${literal(user)},'owner');
    insert into public.projects(id,workspace_id,name,slug,created_by) values(${literal(project)},${literal(workspace)},'Shared voice','shared-voice',${literal(user)});
    set role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify(claims))},false);
    select public.mobile_register_device(${literal(device)},${literal(key)},'desktop','Shared voice','x25519-v1',decode(${literal(createHash('sha256').update(key).digest('hex'))},'hex'));
    select public.mobile_enroll_project_device(${literal(device)},${literal(project)},${literal(device)});reset role;`);
  const request={principal:{subject:user,tenantId:"synthetic-issuer",deviceId:device,sessionId:session,expiresAt:Date.now()+60000,bearerToken:"private-author-bearer"},projectId:project,deviceId:device};
  const directory=mkdtempSync(join(tmpdir(),"openauthor-shared-control-"));
  const gatewayToken=token("mobile_voice_gateway"), controllerToken=token("mobile_voice_controller");
  let count=0, controllerUnavailable=false, lostHangup=false;
  const calls=new Set<string>(), hangups:string[]=[], rpcRequests:Record<string,unknown>[]=[];
  const types:Record<string,Record<string,string>>={
    mobile_voice_begin:{p_lease_id:"uuid",p_user_id:"uuid",p_tenant_id:"text",p_project_id:"uuid",p_device_id:"uuid",p_session_id:"uuid",p_binding:"text",p_lease_ms:"integer",p_max_duration_ms:"integer",p_jwt_expires_at:"timestamptz"},
    mobile_voice_get:{p_lease_id:"uuid",p_binding:"text"},mobile_voice_attach:{p_lease_id:"uuid",p_binding:"text",p_call_id:"text"},
    mobile_voice_close:{p_lease_id:"uuid",p_binding:"text"},
    mobile_voice_renew:{p_lease_id:"uuid",p_binding:"text",p_revision:"bigint",p_user_id:"uuid",p_tenant_id:"text",p_project_id:"uuid",p_device_id:"uuid",p_session_id:"uuid",p_jwt_expires_at:"timestamptz"},
    mobile_voice_controller_poll:{p_controller_id:"uuid",p_binding:"text",p_poll_ms:"integer",p_claim_ms:"integer",p_limit:"integer"},
    mobile_voice_controller_claim:{p_controller_id:"uuid",p_lease_id:"uuid",p_binding:"text",p_claim_ms:"integer",p_force_close:"boolean"},
    mobile_voice_controller_observed:{p_controller_id:"uuid",p_lease_id:"uuid",p_binding:"text",p_claim_token:"uuid"},
    mobile_voice_controller_complete:{p_controller_id:"uuid",p_lease_id:"uuid",p_binding:"text",p_claim_token:"uuid"},
  };
  const server=createServer(async(incoming,response)=>{
    try {
      const chunks:Buffer[]=[];for await(const chunk of incoming)chunks.push(Buffer.from(chunk));
      if(incoming.url?.startsWith('/rest/v1/rpc/')){
        assert.equal(incoming.headers.apikey,"synthetic-publishable");
        const controller=incoming.headers.authorization===`Bearer ${controllerToken}`;
        assert.ok(controller||incoming.headers.authorization===`Bearer ${gatewayToken}`);
        if(controller&&controllerUnavailable){response.writeHead(503);response.end("private SQL failure");return;}
        const name=incoming.url.split('/').at(-1)!;assert.ok(Object.hasOwn(types,name));
        const body=JSON.parse(Buffer.concat(chunks).toString()) as Record<string,unknown>;rpcRequests.push(body);
        assert.deepEqual(Object.keys(body).sort(),Object.keys(types[name]!).sort());
        const params=Object.entries(types[name]!).map(([key,type])=>{
          const value=body[key];
          if(type==='boolean'){assert.equal(typeof value,'boolean');return `${key}=>${value}`;}
          if(type==='integer'||type==='bigint'){assert.ok(Number.isSafeInteger(value));return `${key}=>${value}`;}
          assert.equal(typeof value,'string');return `${key}=>${literal(value as string)}::${type}`;
        });
        const result=await sql(`begin;set local role ${controller?'mobile_voice_controller':'mobile_voice_gateway'};select public.${name}(${params.join(',')});commit;`);
        response.setHeader('content-type','application/json');response.end(result);return;
      }
      assert.equal(incoming.headers.authorization,'Bearer sk-synthetic-shared');assert.equal(incoming.headers['openai-project'],'proj_synthetic_shared');
      if(incoming.url==='/v1/realtime/calls'){
        const id=`rtc_shared_${++count}`;calls.add(id);response.writeHead(201,{location:`/v1/realtime/calls/${id}`});response.end('v=0\r\ns=answer\r\n');
      }else if(incoming.url?.endsWith('/hangup')){
        const id=incoming.url.split('/')[4]!;hangups.push(id);
        if(!calls.has(id)){response.writeHead(404);response.end();return;}
        calls.delete(id);
        if(lostHangup){incoming.socket.destroy();return;}
        response.writeHead(200);response.end();
      }else{response.writeHead(404);response.end();}
    }catch(error){
      const detail=error instanceof Error?error.message:'';
      response.writeHead(/connection to server|server closed the connection|could not connect/i.test(detail)?503:403);
      response.end('private fixture database details');
    }
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const binding=voiceCredentialBinding('sk-synthetic-shared','proj_synthetic_shared','',origin);
  const common={supabaseUrl:origin,publishableKey:'synthetic-publishable',binding,timeoutMs:500};
  const gatewayOptions={...common,token:gatewayToken,leaseMs:1200,maxDurationMs:3000,registrationTimeoutMs:900};
  const controllerOptions={...common,token:controllerToken,controllerId:randomUUID(),pollMs:100,claimMs:1500};
  const upstreamOptions={apiKey:'sk-synthetic-shared',projectId:'proj_synthetic_shared',baseUrl:origin,timeoutMs:1000};
  const children:ReturnType<typeof spawn>[]=[];
  function child(source:string){
    const process=spawn(globalThis.process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});
    children.push(process);let output='',errors='';process.stdout!.on('data',chunk=>{output+=chunk;});process.stderr!.on('data',chunk=>{errors+=chunk;});
    return{process,output:()=>output,errors:()=>errors};
  }
  const moduleUrl=(name:string)=>JSON.stringify(new URL(`../src/${name}.ts`,import.meta.url).href);
  function controller(path=join(directory,'controller.json')){
    return child(`import{SupabaseControllerVoiceControl}from ${moduleUrl('sharedVoiceControl')};import{ControllerJournal,VoiceControllerWorker}from ${moduleUrl('voiceControllerWorker')};import{OpenAIRealtimeUpstream}from ${moduleUrl('openAIRealtimeUpstream')};
      const worker=new VoiceControllerWorker({store:new SupabaseControllerVoiceControl(${JSON.stringify({...controllerOptions,controllerId:randomUUID()})}),journal:new ControllerJournal(${JSON.stringify(path)},${JSON.stringify(binding)}),upstream:new OpenAIRealtimeUpstream(${JSON.stringify(upstreamOptions)})});
      while(true){try{await worker.runOnce();process.stdout.write('TICK\\n');}catch{process.stdout.write('UNCONFIRMED\\n');}await new Promise(resolve=>setTimeout(resolve,100));}`);
  }
  function gateway(path=join(directory,`gateway-${randomUUID()}.json`)){
    return child(`import{SupabaseGatewayVoiceControl}from ${moduleUrl('sharedVoiceControl')};import{CallJournal}from ${moduleUrl('callJournal')};import{SessionLeases}from ${moduleUrl('sessionLeases')};import{OpenAIRealtimeUpstream}from ${moduleUrl('openAIRealtimeUpstream')};
      const request=${JSON.stringify(request)};const manager=new SessionLeases({journal:new CallJournal(${JSON.stringify(path)}),control:new SupabaseGatewayVoiceControl(${JSON.stringify(gatewayOptions)}),upstream:new OpenAIRealtimeUpstream(${JSON.stringify(upstreamOptions)}),principalVerifier:{verify:async()=>request.principal},authorizer:{authorize:async()=>true},clock:{now:()=>new Date()},leaseTtlMs:1200,maxDurationMs:3000,pollIntervalMs:100,authorizationTimeoutMs:1500,maxCalls:10});
      await manager.initialize();try{const answer=await manager.issue(request,${JSON.stringify(CALL)});process.stdout.write('READY '+JSON.stringify(answer.receipt)+'\\n');}catch{process.stdout.write('REFUSED\\n');}setInterval(()=>{},1000);`);
  }
  async function kill(child:ReturnType<typeof spawn>){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');assert.equal((await done)[1],'SIGKILL');}}
  return{sql,request,directory,calls,hangups,rpcRequests,binding,common,gatewayOptions,controllerOptions,upstreamOptions,controller,gateway,kill,
    controllerUnavailable:(value:boolean)=>{controllerUnavailable=value;},lostHangup:(value:boolean)=>{lostHangup=value;},
    async stopDatabase(){assert.ok(data);await execute(`${binaries}/pg_ctl`,['-D',data,'-m','immediate','-w','stop']);},
    async startDatabase(){assert.ok(data);await execute(`${binaries}/pg_ctl`,['-D',data,'-l',join(data,'server.log'),'-w','start']);},
    async closed(id:string){return await sql(`select phase from public.mobile_voice_calls where lease_id=${literal(id)};`)==='closed';},
    async cleanup(){
      for(const child of children)await kill(child);server.close();await once(server,'close');
      // Privileged disposal of this test's own synthetic records isolates the
      // next provider binding. Production has no worker bypass for unknowns.
      await sql(`delete from public.mobile_voice_calls where project_id=${literal(project)};delete from public.mobile_voice_controllers where binding_sha256=${literal(binding)};`);
      rmSync(directory,{recursive:true,force:true});
    }
  };
}

test('independent real-PG controller survives gateway SIGKILL and fsynced-journal worker failover',{skip:!socket},async()=>{
  const f=await fixture();
  try{
    const worker=f.controller();await eventually(()=>worker.output().includes('TICK'));
    const gateway=f.gateway();await eventually(()=>gateway.output().includes('READY'),7000);
    const receipt=JSON.parse(gateway.output().split('READY ')[1]!.split('\n')[0]!);
    const cached=readFileSync(join(f.directory,'controller.json'),'utf8');assert.ok(cached.includes('rtc_shared_1'));
    for(const content of ['private-author-bearer','private-offer','private-context-not-persisted'])assert.equal(cached.includes(content),false);
    await f.kill(gateway.process);assert.equal(worker.process.exitCode,null);
    await eventually(()=>f.closed(receipt.lease_id));assert.equal(f.calls.size,0);assert.equal(f.hangups.length,1);
    const next=f.gateway();await eventually(()=>next.output().includes('READY'));
    const second=JSON.parse(next.output().split('READY ')[1]!.split('\n')[0]!);
    await f.kill(worker.process);assert.equal(f.calls.size,1);
    const successor=f.controller();await eventually(()=>f.closed(second.lease_id));assert.equal(f.calls.size,0);
    await eventually(()=>successor.output().includes('TICK'));
    assert.equal(JSON.parse(readFileSync(join(f.directory,'controller.json'),'utf8')).calls.length,0);
  }finally{await f.cleanup();}
});

test('observed controller cache hangs up during DB outage; lost provider reply cannot acknowledge closure',{skip:!socket},async()=>{
  const f=await fixture();
  try{
    const worker=f.controller();await eventually(()=>worker.output().includes('TICK'));
    const gateway=f.gateway();await eventually(()=>gateway.output().includes('READY'));
    const receipt=JSON.parse(gateway.output().split('READY ')[1]!.split('\n')[0]!);
    await f.stopDatabase();
    await eventually(()=>f.calls.size===0);
    assert.ok(readFileSync(join(f.directory,'controller.json'),'utf8').includes('rtc_shared_1'));
    await eventually(()=>JSON.parse(readFileSync(join(f.directory,'controller.json.control'),'utf8')).accepted.length===1);
    await f.kill(worker.process);
    const successor=f.controller();await eventually(()=>successor.output().includes('UNCONFIRMED'));
    await f.startDatabase();await eventually(()=>f.closed(receipt.lease_id));
    assert.equal(f.hangups.length,1,'Durable accepted receipt survives worker restart without an undocumented 404 assumption.');
    const next=f.gateway();await eventually(()=>next.output().includes('READY'));
    const second=JSON.parse(next.output().split('READY ')[1]!.split('\n')[0]!);
    f.lostHangup(true);await f.sql(`update public.mobile_devices set revoked_at=clock_timestamp(),revocation_reason_code='author-revoked' where id=${literal(f.request.deviceId)};`);
    await eventually(()=>f.calls.size===0&&f.hangups.length>=2);
    await eventually(async()=>await f.sql(`select phase from public.mobile_voice_calls where lease_id=${literal(second.lease_id)};`)==='closing');
    assert.equal(await f.closed(second.lease_id),false);assert.ok(readFileSync(join(f.directory,'controller.json'),'utf8').includes('rtc_shared_2'));
    const control=new SupabaseGatewayVoiceControl(f.gatewayOptions);await assert.rejects(control.begin(randomUUID(),f.request));
  }finally{if(data)await f.startDatabase().catch(()=>undefined);await f.cleanup();}
});

test('real SQL renewal CAS preserves scope/hard duration and no-observation gateway withholds answer',{skip:!socket},async()=>{
  const f=await fixture();
  try{
    const worker=f.controller();await eventually(()=>worker.output().includes('TICK'));
    const control=new SupabaseGatewayVoiceControl(f.gatewayOptions);
    const row=await control.begin(randomUUID(),f.request);
    const upstream=new OpenAIRealtimeUpstream(f.upstreamOptions);
    let active= row;
    await upstream.createCall({...CALL,onCallCreated:async call=>{active=await control.ready(await control.attach(row,call));}});
    const results=await Promise.allSettled([control.renew(active,f.request),control.renew(active,f.request)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    const renewed=(results.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<typeof active>).value;
    assert.equal(renewed.hard_expires_at,active.hard_expires_at);
    await assert.rejects(control.renew(renewed,{...f.request,principal:{...f.request.principal,sessionId:randomUUID()}}));
    await control.close(renewed);await eventually(()=>f.closed(active.lease_id));await f.kill(worker.process);
    // A fresh empty poll supplies heartbeat only. It supplies no durable
    // known-call observation or permission to deliver an SDP answer.
    const heartbeat=new SupabaseControllerVoiceControl({...f.controllerOptions,controllerId:randomUUID()});await heartbeat.poll();
    const neverAcknowledged=f.gateway();await eventually(()=>neverAcknowledged.output().includes('REFUSED'));
    assert.equal(neverAcknowledged.output().includes('READY'),false);
    const rows=await f.sql(`select coalesce(json_agg(phase),'[]') from public.mobile_voice_calls where project_id=${literal(f.request.projectId)} and phase<>'closed';`);
    assert.ok(JSON.parse(rows).includes('closing'));
  }finally{await f.cleanup();}
});

test('actual migration preflight refuses incoming role contamination and makes safe authenticator grants SET-only',{skip:!socket},async()=>{
  const migration=readFileSync(new URL('../../supabase/migrations/20261002190000_mobile_voice_control.sql',import.meta.url),'utf8');
  const preflight=migration.slice(0,migration.indexOf('end $$;')+'end $$;'.length);
  const sql=async(statement:string)=>(await execute(`${binaries}/psql`,['-h',socket!,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-c',statement])).stdout.trim();
  for(const member of ['authenticated','anon','service_role']){
    await assert.rejects(sql(`begin;grant mobile_voice_gateway to ${member};${preflight.replace('begin;','')}rollback;`),
      error=>error instanceof Error&&error.message.includes('untrusted incoming membership'));
    assert.equal(await sql(`select pg_has_role('${member}','mobile_voice_gateway','MEMBER');`),'f');
  }
  const authenticator=`do $$begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator nologin noinherit;end if;end $$;`;
  await assert.rejects(sql(`begin;${authenticator}alter role authenticator inherit;${preflight.replace('begin;','')}rollback;`),
    error=>error instanceof Error&&error.message.includes('unprivileged NOINHERIT'));
  const grants=await sql(`begin;${authenticator}alter role authenticator noinherit;${preflight.replace('begin;','')}
    select count(*)=2 and bool_and(not m.inherit_option and m.set_option and not m.admin_option)
      from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles a on a.oid=m.member
      where a.rolname='authenticator' and r.rolname in ('mobile_voice_gateway','mobile_voice_controller');rollback;`);
  assert.equal(grants,'t');
});

test('account fence refuses Auth deletion racing an actual uncommitted allocation and keeps unresolved intent owned',{skip:!socket},async()=>{
  const f=await fixture();let allocating:ReturnType<typeof spawn>|undefined;
  try{
    await new SupabaseControllerVoiceControl({...f.controllerOptions,controllerId:randomUUID()}).poll();
    allocating=spawn(`${binaries}/psql`,['-h',socket!,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
    let output='';allocating.stdout!.on('data',chunk=>{output+=chunk;});
    allocating.stdin!.write(`begin;set local role mobile_voice_gateway;select public.mobile_voice_begin(${literal(randomUUID())},${literal(f.request.principal.subject)},'synthetic-issuer',${literal(f.request.projectId)},${literal(f.request.deviceId)},${literal(f.request.principal.sessionId)},${literal(f.binding)},30000,60000,clock_timestamp()+interval '1 hour');select 'ALLOCATED';\n`);
    await eventually(()=>output.includes('ALLOCATED'));
    await assert.rejects(f.sql(`delete from auth.users where id=${literal(f.request.principal.subject)};`),
      error=>error instanceof Error&&error.message.includes('Account lifecycle changed; retry a fresh transaction'));
    const finished=once(allocating,'exit');allocating.stdin!.end('commit;\n');assert.equal((await finished)[0],0);allocating=undefined;
    await assert.rejects(f.sql(`delete from auth.users where id=${literal(f.request.principal.subject)};`),
      error=>error instanceof Error&&error.message.includes('Provider cleanup pending'));
    assert.equal(await f.sql(`select count(*) from public.mobile_voice_calls where user_id=${literal(f.request.principal.subject)} and phase='allocating';`),'1');
    assert.equal(await f.sql(`select count(*) from auth.users where id=${literal(f.request.principal.subject)};`),'1');
  }finally{if(allocating){const done=once(allocating,'exit');allocating.kill('SIGKILL');await done;}await f.cleanup();}
});

test('Auth deletion redacts closed scope while exact SQL receipts retire gateway and controller crash journals',{skip:!socket},async()=>{
  const f=await fixture();const user=randomUUID(),job=randomUUID(),lease=randomUUID(),call='rtc_redacted_receipt';
  try{
    await f.sql(`insert into auth.users(id) values(${literal(user)});
      insert into public.mobile_account_deletion_jobs(job_id,user_id,inventory,inventory_sha256,dispositions,retained_history_acknowledged) values(${literal(job)},${literal(user)},'{}',repeat('dc',32),'{}',true);
      insert into public.mobile_voice_calls(lease_id,user_id,tenant_id,project_id,device_id,session_id,binding_sha256,call_id,phase,lease_ms,hard_expires_at,lease_expires_at,jwt_expires_at,closed_at,controller_id,claim_token,claim_expires_at)
      values(${literal(lease)},${literal(user)},'synthetic-issuer',${literal(randomUUID())},${literal(randomUUID())},${literal(randomUUID())},${literal(f.binding)},${literal(call)},'closed',30000,clock_timestamp()+interval '1 minute',clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '1 hour',clock_timestamp(),${literal(randomUUID())},${literal(randomUUID())},clock_timestamp()+interval '1 minute');`);
    const original=voiceRecord(JSON.parse(await f.sql(`select public.mobile_voice_json(v) from public.mobile_voice_calls v where lease_id=${literal(lease)};`)),f.binding);
    const gatewayJournal=new CallJournal(join(f.directory,'redacted-gateway.json'));gatewayJournal.record(lease,call);
    const controllerJournal=new ControllerJournal(join(f.directory,'redacted-controller.json'),f.binding);controllerJournal.record(original);
    await f.sql(`begin;set local role mobile_deletion_verifier;select public.mobile_prepare_account_auth_finalization(${literal(job)},repeat('dc',32),repeat('dd',32));commit;delete from auth.users where id=${literal(user)};`);
    const redacted=voiceRecord(JSON.parse(await f.sql(`select public.mobile_voice_json(v) from public.mobile_voice_calls v where lease_id=${literal(lease)};`)),f.binding);
    assert.equal(redacted.identity_redacted,true);for(const key of ['user_id','tenant_id','project_id','device_id','session_id'] as const)assert.equal(redacted[key],null);
    const manager=new SessionLeases({journal:gatewayJournal,control:new SupabaseGatewayVoiceControl(f.gatewayOptions),upstream:new OpenAIRealtimeUpstream(f.upstreamOptions),
      principalVerifier:{verify:async()=>f.request.principal},authorizer:{authorize:async()=>true},clock:{now:()=>new Date()},leaseTtlMs:1200,maxDurationMs:3000,pollIntervalMs:100,authorizationTimeoutMs:1500,maxCalls:10});
    await manager.initialize();assert.equal(gatewayJournal.entries().length,0);await manager.shutdown();
    const worker=new VoiceControllerWorker({store:new SupabaseControllerVoiceControl(f.controllerOptions),journal:controllerJournal,upstream:new OpenAIRealtimeUpstream(f.upstreamOptions)});
    await worker.runOnce();assert.equal(controllerJournal.calls.entries().length,0);worker.close();assert.equal(f.hangups.length,0);
  }finally{
    // This exact redacted receipt is synthetic and no longer has a project ID.
    await f.sql(`delete from public.mobile_voice_calls where lease_id=${literal(lease)};`);await f.cleanup();
  }
});
