import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SupabaseControllerVoiceControl, SupabaseGatewayVoiceControl, VoiceRpc, sameVoiceScope, trustedVoiceToken, voiceCredentialBinding, voiceRecord } from "../src/sharedVoiceControl.ts";
import type { ControllerVoiceControl, VoiceControlRecord } from "../src/sharedVoiceControl.ts";
import { ControllerJournal, VoiceControllerWorker } from "../src/voiceControllerWorker.ts";
import { parseGatewayConfig } from "../src/config.ts";
import { parseVoiceControllerConfig } from "../src/voiceControllerMain.ts";

const token = (role: string, exp = 4102444800) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role, exp })).toString('base64url')}.synthetic`;
const binding = voiceCredentialBinding('sk-synthetic','proj_synthetic');
function record(): VoiceControlRecord {
  return { lease_id: randomUUID(), user_id: randomUUID(), tenant_id: 'synthetic-issuer', project_id: randomUUID(), device_id: randomUUID(), session_id: randomUUID(),
    identity_redacted: false, binding_sha256: binding, call_id: 'rtc_negative_controls', phase: 'registering', revision: 1,
    hard_expires_at: new Date(Date.now()+60000).toISOString(), lease_expires_at: new Date(Date.now()+30000).toISOString(), jwt_expires_at: new Date(Date.now()+60000).toISOString(),
    controller_observed: false, controller_id: randomUUID(), claim_token: randomUUID(), claim_expires_at: new Date(Date.now()+15000).toISOString() };
}
function options(role = 'mobile_voice_gateway') { return { supabaseUrl: 'https://synthetic.supabase.co', publishableKey: 'synthetic-public', token: token(role), binding, timeoutMs: 100 }; }
function directory() { return mkdtempSync(join(tmpdir(),'openauthor-control-negative-')); }

test('private control credentials reject broad/author/wrong/expired roles and key/project/origin rotation changes binding',()=>{
  for(const role of ['service_role','authenticated','anon','mobile_voice_controller'])assert.throws(()=>trustedVoiceToken(token(role),'mobile_voice_gateway'));
  assert.throws(()=>trustedVoiceToken(token('mobile_voice_gateway',1),'mobile_voice_gateway'));
  assert.throws(()=>trustedVoiceToken('private-opaque-service-key','mobile_voice_gateway'));
  assert.notEqual(binding,voiceCredentialBinding('sk-next','proj_synthetic'));
  assert.notEqual(binding,voiceCredentialBinding('sk-synthetic','proj_next'));
  assert.notEqual(binding,voiceCredentialBinding('sk-synthetic','proj_synthetic','org_next'));
  assert.notEqual(binding,voiceCredentialBinding('sk-synthetic','proj_synthetic','','http://127.0.0.1:1234'));
});

test('production independent control is mandatory and explicit recovery cannot silently omit its mode',()=>{
  const env={GATEWAY_CALL_JOURNAL_PATH:'/private/tmp/synthetic-calls.json',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',OPENAI_API_KEY:'synthetic-key',SAFETY_IDENTIFIER_SECRET:'synthetic-safety-secret-at-least-32-bytes'};
  assert.throws(()=>parseGatewayConfig(env),/OPENAI_PROJECT_ID/);
  assert.throws(()=>parseGatewayConfig({...env,OPENAI_PROJECT_ID:'proj_synthetic'}),/SUPABASE_VOICE_GATEWAY_TOKEN/);
  assert.throws(()=>parseGatewayConfig({...env,OPENAI_PROJECT_ID:'proj_synthetic',SUPABASE_VOICE_GATEWAY_TOKEN:token('service_role')}));
  assert.equal(parseGatewayConfig({...env,GATEWAY_VOICE_CONTROL_MODE:'legacy-recovery'}).voiceControl.mode,'legacy-recovery');
  assert.throws(()=>parseVoiceControllerConfig({...env,OPENAI_PROJECT_ID:'proj_synthetic',SUPABASE_VOICE_CONTROLLER_TOKEN:token('mobile_voice_gateway'),VOICE_CONTROLLER_JOURNAL_PATH:'/private/tmp/controller.json'}));
});

test('malformed, wrong-binding, unsafe-call and impossible-deadline records fail before call control',()=>{
  const row=record();assert.deepEqual(voiceRecord(row,binding),row);
  for(const change of [{binding_sha256:'b'.repeat(64)},{call_id:'../../foreign'},{phase:'other'},{controller_observed:'true'},{revision:-1},{claim_token:undefined},
    {claim_expires_at:'not-a-date'},{lease_expires_at:new Date(Date.now()+120000).toISOString()},{user_id:'not-a-uuid'},{tenant_id:''}])assert.throws(()=>voiceRecord({...row,...change},binding));
  assert.throws(()=>voiceRecord([row],binding));
});

test('actual HTTP RPC timeout, redirect and oversized body never expose credential or private failure body',async()=>{
  for(const mode of ['timeout','redirect','oversized'] as const){
    const server=createServer((request,response)=>{
      if(mode==='timeout'){response.writeHead(200);response.write('{');return;}
      if(mode==='redirect'){response.writeHead(302,{location:'https://untrusted.invalid'});response.end();return;}
      response.writeHead(200);response.end('x'.repeat(1048577));
    });server.listen(0,'127.0.0.1');await once(server,'listening');
    const rpc=new VoiceRpc({...options(),supabaseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`},'mobile_voice_gateway');
    try{const start=Date.now();await assert.rejects(rpc.call('mobile_voice_get',{}),error=>error instanceof Error&&!error.message.includes('synthetic')&&!error.message.includes('private'));assert.ok(Date.now()-start<1000);}
    finally{server.closeAllConnections();server.close();await once(server,'close');}
  }
});

test('only an exact positively closed redacted receipt can reconcile a scoped journal after Auth removal',async()=>{
  const original=record();
  const closed={...original,user_id:null,tenant_id:null,project_id:null,device_id:null,session_id:null,
    identity_redacted:true,phase:'closed' as const,revision:original.revision+1};
  assert.deepEqual(voiceRecord(closed,binding),closed);assert.equal(sameVoiceScope(original,closed),true);
  for(const change of [{phase:'active'},{user_id:original.user_id},{identity_redacted:false},
    {lease_id:randomUUID()},{call_id:'rtc_different'},{hard_expires_at:new Date(Date.now()+90000).toISOString()}]){
    const value={...closed,...change};
    if(['phase','user_id','identity_redacted'].some(key=>Object.hasOwn(change,key)))assert.throws(()=>voiceRecord(value,binding));
    else assert.equal(sameVoiceScope(original,voiceRecord(value,binding)),false);
  }
  const control=new SupabaseGatewayVoiceControl({...options(),leaseMs:30000,maxDurationMs:60000,fetchImpl:async()=>Response.json(closed)});
  await control.closed(original);await control.recover(original.lease_id,original.call_id!);
  await assert.rejects(control.ready(original));await assert.rejects(control.recover(original.lease_id,'rtc_different'));
});

test('a transport ignoring cancellation is bounded, and private credential expiry is not a stale generation refusal',async()=>{
  const rpc=new VoiceRpc({...options(),timeoutMs:10,fetchImpl:async()=>new Promise<Response>(()=>{})},'mobile_voice_gateway');
  const start=Date.now();await assert.rejects(rpc.call('mobile_voice_get',{}));assert.ok(Date.now()-start<500);
  const expired=new VoiceRpc({...options(),fetchImpl:async()=>new Response('',{status:401})},'mobile_voice_gateway');
  await assert.rejects(expired.call('mobile_voice_get',{}),error=>typeof error==='object'&&error!==null&&'refused' in error&&error.refused===false);
});

test('lost attach reply is reconciled only against the exact immutable current record without another attach',async()=>{
  const original={...record(),phase:'allocating' as const,call_id:null};const attached={...original,phase:'registering' as const,call_id:'rtc_attached',revision:1};
  const calls:string[]=[];
  const control=new SupabaseGatewayVoiceControl({...options(),leaseMs:30000,maxDurationMs:60000,fetchImpl:async input=>{
    const path=String(input).split('/').at(-1)!;calls.push(path);
    if(path==='mobile_voice_attach')throw new Error('private transport error');
    return Response.json(attached);
  }});
  assert.deepEqual(await control.attach(original,'rtc_attached'),attached);
  assert.deepEqual(calls,['mobile_voice_attach','mobile_voice_get']);
  await assert.rejects(control.attach(original,'rtc_other'));
});

test('unobserved, expired or foreign current record cannot release an answer',async()=>{
  const row=record();
  for(const response of [row,{...row,phase:'active',controller_observed:true,lease_expires_at:new Date(Date.now()-1).toISOString()},
    {...row,phase:'active',controller_observed:true,call_id:'rtc_foreign'}]){
    const control=new SupabaseGatewayVoiceControl({...options(),leaseMs:30000,maxDurationMs:60000,registrationTimeoutMs:20,fetchImpl:async()=>Response.json(response)});
    await assert.rejects(control.ready(row));
  }
});

test('duplicate and foreign claimed control packets cannot enter the worker cache',async()=>{
  const row=record();
  for(const rows of [[row,row],[{...row,binding_sha256:'b'.repeat(64)}],[{...row,controller_id:randomUUID()}]]){
    const store=new SupabaseControllerVoiceControl({...options('mobile_voice_controller'),controllerId:row.controller_id!,pollMs:1000,claimMs:15000,fetchImpl:async()=>Response.json(rows)});
    await assert.rejects(store.poll());
  }
});

test('private journal refuses mismatched identity and rotated credentials and accepted receipt survives reopening',()=>{
  const path=join(directory(),'calls.json'),row=record();const journal=new ControllerJournal(path,binding);
  try{
    journal.record(row);assert.throws(()=>journal.record({...row,call_id:'rtc_other'}));
    journal.markClosing(row.lease_id);journal.accept(row.lease_id);journal.close();
    assert.throws(()=>new ControllerJournal(path,voiceCredentialBinding('sk-next','proj_synthetic')));
    const reopened=new ControllerJournal(path,binding);assert.equal(reopened.accepted(row.lease_id),true);reopened.retire(row.lease_id);reopened.close();
    assert.equal(JSON.parse(readFileSync(path,'utf8')).calls.length,0);
  }finally{rmSync(join(path,'..'),{recursive:true,force:true});}
});

test('controller journal retains canonical version7 control IDs accepted by the SQL and RPC interfaces',()=>{
  const dir=directory(),journal=new ControllerJournal(join(dir,'calls.json'),binding);
  try{const row={...record(),lease_id:'f6000000-0000-7000-8000-000000000001'};journal.record(row);assert.equal(journal.calls.entries()[0]![0],row.lease_id);}
  finally{journal.close();rmSync(dir,{recursive:true,force:true});}
});

test('real durable journal write failure withholds SQL observation and never claims a receipt',async()=>{
  const dir=directory(),journal=new ControllerJournal(join(dir,'calls.json'),binding),row=record();let observed=0,hangups=0;
  const store:ControllerVoiceControl={poll:async()=>[row],claim:async()=>{throw new Error('unavailable');},observed:async value=>{observed++;return value;},complete:async value=>value};
  const worker=new VoiceControllerWorker({store,journal,upstream:{createCall:async()=>{throw new Error('not part of this check');},hangupCall:async()=>{hangups++;}}});
  try{chmodSync(dir,0o500);await assert.rejects(worker.runOnce());assert.equal(observed,0);assert.equal(hangups,0);}
  finally{chmodSync(dir,0o700);worker.close();rmSync(dir,{recursive:true,force:true});}
});
