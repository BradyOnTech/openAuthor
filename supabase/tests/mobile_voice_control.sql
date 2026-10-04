-- Run after190000 in an isolated disposable database; all identities synthetic.
begin;
create function pg_temp.voice_assert(p_value boolean,p_message text) returns void language plpgsql as $$
begin if p_value is not true then raise exception 'assertion failed: %',p_message; end if; end $$;
create function pg_temp.voice_denied(p_sql text,p_message text) returns void language plpgsql as $$
begin begin execute p_sql; exception when insufficient_privilege then return; end;
raise exception 'assertion failed: %',p_message; end $$;

insert into auth.users(id) values('e1000000-0000-7000-8000-000000000001');
insert into auth.sessions(id,user_id) values('e9000000-0000-7000-8000-000000000001','e1000000-0000-7000-8000-000000000001');
insert into public.workspaces(id,name,slug) values('e2000000-0000-7000-8000-000000000001','Voice control','voice-control');
insert into public.workspace_members(workspace_id,user_id,role) values('e2000000-0000-7000-8000-000000000001','e1000000-0000-7000-8000-000000000001','owner');
insert into public.projects(id,workspace_id,name,slug,created_by) values('e3000000-0000-7000-8000-000000000001','e2000000-0000-7000-8000-000000000001','Known calls','known-calls','e1000000-0000-7000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-7000-8000-000000000001","session_id":"e9000000-0000-7000-8000-000000000001","device_id":"e4000000-0000-7000-8000-000000000001"}',true);
select public.mobile_register_device('e4000000-0000-7000-8000-000000000001','e5000000-0000-7000-8000-000000000001','desktop','Voice control','x25519-v1',decode(repeat('e1',32),'hex'));
select public.mobile_enroll_project_device('e4000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001');
reset role;
create function pg_temp.voice_begin(p_suffix text) returns jsonb language sql as $$
select public.mobile_voice_begin(('e6000000-0000-7000-8000-'||p_suffix)::uuid,
 'e1000000-0000-7000-8000-000000000001','synthetic-issuer','e3000000-0000-7000-8000-000000000001',
 'e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001',repeat('ab',32),30000,60000,clock_timestamp()+interval '1 hour') $$;

select pg_temp.voice_assert(not has_table_privilege('mobile_voice_gateway','public.mobile_voice_calls','SELECT'),'gateway has no table access');
select pg_temp.voice_assert(not has_table_privilege('mobile_voice_controller','public.mobile_voice_calls','UPDATE'),'controller has no table access');
select pg_temp.voice_assert(not has_function_privilege('service_role','public.mobile_voice_controller_poll(uuid,text,integer,integer,integer)','EXECUTE'),'broad service role cannot control calls');
select pg_temp.voice_assert(not has_function_privilege('authenticated','public.mobile_voice_begin(uuid,uuid,text,uuid,uuid,uuid,text,integer,integer,timestamp with time zone)','EXECUTE'),'author cannot create trusted records');
select pg_temp.voice_assert(not has_function_privilege('mobile_voice_gateway','public.mobile_voice_controller_complete(uuid,uuid,text,uuid)','EXECUTE'),'gateway cannot fabricate controller acknowledgement');
set local role mobile_voice_gateway;
select pg_temp.voice_denied($$select pg_temp.voice_begin('000000000001')$$,'no live controller blocks allocation');
reset role;
set local role mobile_voice_controller;
select public.mobile_voice_controller_poll('e7000000-0000-7000-8000-000000000001',repeat('ab',32),1000,15000,100);
reset role;
set local role mobile_voice_gateway;
select pg_temp.voice_assert((pg_temp.voice_begin('000000000001')->>'phase')='allocating','controller heartbeat permits durable intent');
select pg_temp.voice_assert((public.mobile_voice_attach('e6000000-0000-7000-8000-000000000001',repeat('ab',32),'rtc_sql_known')->>'phase')='registering','known ID awaits durable observation');
reset role;
select public.mobile_voice_controller_poll('e7000000-0000-7000-8000-000000000999',repeat('ac',32),1000,15000,100);
set local role mobile_voice_gateway;
select pg_temp.voice_denied($$select public.mobile_voice_begin('e6000000-0000-7000-8000-000000000999','e1000000-0000-7000-8000-000000000001','synthetic-issuer','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001',repeat('ac',32),30000,60000,clock_timestamp()+interval '1 hour')$$,'fresh credential binding cannot bypass undrained old calls');
select pg_temp.voice_denied($$select public.mobile_voice_renew('e6000000-0000-7000-8000-000000000001',repeat('ab',32),1,'e1000000-0000-7000-8000-000000000001','synthetic-issuer','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001',clock_timestamp()+interval '1 hour')$$,'unobserved call cannot renew');
reset role;
set local role mobile_voice_controller;
select pg_temp.voice_assert(jsonb_array_length(public.mobile_voice_controller_poll('e7000000-0000-7000-8000-000000000001',repeat('ab',32),1000,15000,100))=1,'controller claims exact known call');
reset role;
select public.mobile_voice_controller_observed('e7000000-0000-7000-8000-000000000001','e6000000-0000-7000-8000-000000000001',repeat('ab',32),(select claim_token from public.mobile_voice_calls where call_id='rtc_sql_known'));
select pg_temp.voice_assert((select phase='active' and controller_observed from public.mobile_voice_calls where call_id='rtc_sql_known'),'observed call becomes active');
set local role mobile_voice_gateway;
select pg_temp.voice_denied($$select public.mobile_voice_renew('e6000000-0000-7000-8000-000000000001',repeat('ab',32),0,'e1000000-0000-7000-8000-000000000001','synthetic-issuer','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001',clock_timestamp()+interval '1 hour')$$,'stale renewal revision refused');
select pg_temp.voice_denied($$select public.mobile_voice_renew('e6000000-0000-7000-8000-000000000001',repeat('ab',32),1,'e1000000-0000-7000-8000-000000000001','other-tenant','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001',clock_timestamp()+interval '1 hour')$$,'original tenant cannot change');
select pg_temp.voice_assert((public.mobile_voice_renew('e6000000-0000-7000-8000-000000000001',repeat('ab',32),1,'e1000000-0000-7000-8000-000000000001','synthetic-issuer','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001',clock_timestamp()+interval '1 hour')->>'revision')::int=2,'same signed session refresh advances only short deadline');
reset role;
select pg_temp.voice_assert((select hard_expires_at-created_at<interval '60.1 seconds' from public.mobile_voice_calls where call_id='rtc_sql_known'),'hard duration did not extend');
-- Current database authority is independent of a retained author bearer.
delete from auth.sessions where id='e9000000-0000-7000-8000-000000000001';
select pg_temp.voice_assert(not public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'deleted Auth session denies ongoing authority');
insert into auth.sessions(id,user_id,not_after) values('e9000000-0000-7000-8000-000000000001','e1000000-0000-7000-8000-000000000001',clock_timestamp()-interval '1 second');
select pg_temp.voice_assert(not public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'expired Auth session denies authority');
update auth.sessions set not_after=null where id='e9000000-0000-7000-8000-000000000001';
update public.workspace_members set role='viewer' where user_id='e1000000-0000-7000-8000-000000000001';
select pg_temp.voice_assert(public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'viewer remains allowed');
delete from public.workspace_members where user_id='e1000000-0000-7000-8000-000000000001';
select pg_temp.voice_assert(not public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'removed member denies authority');
insert into public.workspace_members values('e2000000-0000-7000-8000-000000000001','e1000000-0000-7000-8000-000000000001','owner',now());
update public.projects set status='archived' where id='e3000000-0000-7000-8000-000000000001';
select pg_temp.voice_assert(not public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'archived project denies authority');
update public.projects set status='active' where id='e3000000-0000-7000-8000-000000000001';
update public.mobile_device_keys set revoked_at=clock_timestamp(),retired_at=clock_timestamp() where id='e5000000-0000-7000-8000-000000000001';
select pg_temp.voice_assert(not public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'revoked current key denies authority');
update public.mobile_voice_calls set next_check_at=clock_timestamp() where call_id='rtc_sql_known';
set local role mobile_voice_controller;
select pg_temp.voice_assert((public.mobile_voice_controller_poll('e7000000-0000-7000-8000-000000000001',repeat('ab',32),1000,15000,100)->0->>'phase')='closing','revocation durably closes before HTTP teardown');
reset role;
select pg_temp.voice_denied($$select public.mobile_voice_controller_complete('e7000000-0000-7000-8000-000000000002','e6000000-0000-7000-8000-000000000001',repeat('ab',32),'e8000000-0000-7000-8000-000000000001')$$,'wrong controller cannot acknowledge closure');
select pg_temp.voice_assert((public.mobile_voice_controller_complete('e7000000-0000-7000-8000-000000000001','e6000000-0000-7000-8000-000000000001',repeat('ab',32),(select claim_token from public.mobile_voice_calls where call_id='rtc_sql_known'))->>'phase')='closed','current generation can acknowledge accepted hangup');
select pg_temp.voice_assert((select call_id='rtc_sql_known' and closed_at is not null from public.mobile_voice_calls where lease_id='e6000000-0000-7000-8000-000000000001'),'closure keeps content-free provenance');
update public.mobile_device_keys set revoked_at=null,retired_at=null where id='e5000000-0000-7000-8000-000000000001';
insert into public.mobile_project_deletion_jobs(project_id) values('e3000000-0000-7000-8000-000000000001');
select pg_temp.voice_assert(not public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'permanent project freeze denies ongoing authority');
delete from public.mobile_project_deletion_jobs where project_id='e3000000-0000-7000-8000-000000000001';
insert into public.mobile_account_deletion_jobs(user_id,inventory,inventory_sha256,dispositions,retained_history_acknowledged)
values('e1000000-0000-7000-8000-000000000001','{}',repeat('cd',32),'{}',true);
select pg_temp.voice_assert(not public.mobile_voice_authorized('e1000000-0000-7000-8000-000000000001','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001'),'account tombstone denies ongoing authority');
delete from public.mobile_account_deletion_jobs where user_id='e1000000-0000-7000-8000-000000000001';
select public.mobile_voice_controller_poll('e7000000-0000-7000-8000-000000000001',repeat('ab',32),1000,15000,100);
select pg_temp.voice_begin('000000000002');
select public.mobile_voice_attach('e6000000-0000-7000-8000-000000000002',repeat('ab',32),'rtc_sql_generation');
select public.mobile_voice_controller_poll('e7000000-0000-7000-8000-000000000001',repeat('ab',32),1000,15000,100);
do $$ declare v_old uuid;v_new jsonb; begin
  select claim_token into v_old from public.mobile_voice_calls where call_id='rtc_sql_generation';
  perform pg_temp.voice_denied($q$select public.mobile_voice_controller_claim('e7000000-0000-7000-8000-000000000002','e6000000-0000-7000-8000-000000000002',repeat('ab',32),15000,true)$q$,'fresh foreign claim cannot be stolen');
  update public.mobile_voice_calls set claim_expires_at=clock_timestamp()-interval '1 second' where call_id='rtc_sql_generation';
  v_new:=public.mobile_voice_controller_claim('e7000000-0000-7000-8000-000000000002','e6000000-0000-7000-8000-000000000002',repeat('ab',32),15000,true);
  perform pg_temp.voice_assert(v_new->>'phase'='closing','replacement generation persists closing before hangup');
  perform pg_temp.voice_denied(format('select public.mobile_voice_controller_complete(%L,%L,repeat(''ab'',32),%L)',
    'e7000000-0000-7000-8000-000000000001','e6000000-0000-7000-8000-000000000002',v_old),'stale generation cannot complete');
  perform pg_temp.voice_denied($q$select public.mobile_voice_renew('e6000000-0000-7000-8000-000000000002',repeat('ab',32),2,'e1000000-0000-7000-8000-000000000001','synthetic-issuer','e3000000-0000-7000-8000-000000000001','e4000000-0000-7000-8000-000000000001','e9000000-0000-7000-8000-000000000001',clock_timestamp()+interval '1 hour')$q$,'closing is irreversible through renewal');
  perform public.mobile_voice_controller_complete('e7000000-0000-7000-8000-000000000002','e6000000-0000-7000-8000-000000000002',repeat('ab',32),(v_new->>'claim_token')::uuid);
end $$;
select pg_temp.voice_begin('000000000003');
update public.mobile_voice_calls set lease_expires_at=clock_timestamp()-interval '1 second',next_check_at=clock_timestamp() where lease_id='e6000000-0000-7000-8000-000000000003';
select pg_temp.voice_assert((public.mobile_voice_controller_poll('e7000000-0000-7000-8000-000000000001',repeat('ab',32),1000,15000,100)->0->>'phase')='unknown','unmapped allocation remains unknown');
select pg_temp.voice_denied($$select pg_temp.voice_begin('000000000004')$$,'unknown allocation blocks fresh provider attempts');

-- Separate account without manuscript data tests the finalization seam. Direct
-- fixture inserts model an already allocated intent, not an author capability.
insert into auth.users(id) values('e1000000-0000-7000-8000-000000000099');
insert into public.mobile_account_deletion_jobs(job_id,user_id,inventory,inventory_sha256,dispositions,retained_history_acknowledged)
values('ea000000-0000-7000-8000-000000000099','e1000000-0000-7000-8000-000000000099','{}',repeat('ef',32),'{}',true);
insert into public.mobile_voice_calls(lease_id,user_id,tenant_id,project_id,device_id,session_id,binding_sha256,phase,lease_ms,hard_expires_at,lease_expires_at,jwt_expires_at)
values('e6000000-0000-7000-8000-000000000099','e1000000-0000-7000-8000-000000000099','synthetic-issuer',
 'e3000000-0000-7000-8000-000000000099','e4000000-0000-7000-8000-000000000099','e9000000-0000-7000-8000-000000000099',repeat('ef',32),'allocating',30000,clock_timestamp()+interval '1 minute',clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '1 hour');
create function pg_temp.voice_cleanup_blocked(p_sql text,p_message text) returns void language plpgsql as $$
begin begin execute p_sql; exception when object_not_in_prerequisite_state then return; end;
raise exception 'assertion failed: %',p_message; end $$;
do $$ declare v_phase text; begin
  foreach v_phase in array array['allocating','registering','active','closing','unknown'] loop
    update public.mobile_voice_calls set phase=v_phase,call_id=case when v_phase in ('registering','active','closing') then 'rtc_account_guard' else null end
      where lease_id='e6000000-0000-7000-8000-000000000099';
    perform pg_temp.voice_cleanup_blocked($q$select public.mobile_prepare_account_auth_finalization('ea000000-0000-7000-8000-000000000099',repeat('ef',32),repeat('ee',32))$q$,v_phase||' blocks verified preparation');
    perform pg_temp.voice_cleanup_blocked($q$update public.mobile_account_deletion_jobs set phase='auth_ready',cleanup_verification_sha256=repeat('ee',32) where job_id='ea000000-0000-7000-8000-000000000099'$q$,v_phase||' blocks direct auth_ready transition');
    perform pg_temp.voice_cleanup_blocked($q$update public.mobile_account_deletion_jobs set phase='finalized',finalized_at=clock_timestamp(),cleanup_verification_sha256=repeat('ee',32) where job_id='ea000000-0000-7000-8000-000000000099'$q$,v_phase||' blocks direct finalized transition');
    perform pg_temp.voice_cleanup_blocked($q$delete from auth.users where id='e1000000-0000-7000-8000-000000000099'$q$,v_phase||' blocks Auth delete');
  end loop;
end $$;
select pg_temp.voice_assert((public.mobile_account_deletion_result('ea000000-0000-7000-8000-000000000099')->>'provider_cleanup_pending')::boolean,'owned account status reports pending provider cleanup');
select pg_temp.voice_assert(public.mobile_account_deletion_result('ea000000-0000-7000-8000-000000000099')->'blockers' @> '["Provider cleanup pending: unresolved voice call or allocation"]','owned status exposes actionable blocker');
select pg_temp.voice_assert(not has_function_privilege('mobile_deletion_verifier','public.mobile_prepare_account_auth_finalization_without_voice_control(uuid,text,text)','EXECUTE'),'verifier cannot bypass guarded wrapper');
select pg_temp.voice_assert(not has_function_privilege('authenticated','public.mobile_voice_assert_account_quiescent(uuid)','EXECUTE'),'author has no private quiescence capability');
-- Administrative fixture supplies a known accepted receipt; the worker has no
-- API to fabricate this for an unknown allocation.
update public.mobile_voice_calls set phase='closed',call_id='rtc_account_guard',closed_at=clock_timestamp()
where lease_id='e6000000-0000-7000-8000-000000000099';
set local role mobile_deletion_verifier;
select pg_temp.voice_assert(public.mobile_prepare_account_auth_finalization('ea000000-0000-7000-8000-000000000099',repeat('ef',32),repeat('ee',32))->>'phase'='auth_ready','closed receipts permit verified Auth preparation');
reset role;
delete from auth.users where id='e1000000-0000-7000-8000-000000000099';
select pg_temp.voice_assert((select phase='finalized' from public.mobile_account_deletion_jobs where job_id='ea000000-0000-7000-8000-000000000099'),'closed account finalizes');
select pg_temp.voice_assert((select identity_redacted and user_id is null and tenant_id is null and project_id is null and device_id is null and session_id is null and call_id='rtc_account_guard'
  from public.mobile_voice_calls where lease_id='e6000000-0000-7000-8000-000000000099'),'Auth deletion redacts all personal voice scope, retaining exact closed receipt');
set local role mobile_voice_gateway;
select pg_temp.voice_assert(public.mobile_voice_get('e6000000-0000-7000-8000-000000000099',repeat('ef',32))->>'phase'='closed','redacted positive receipt remains readable for restart recovery');
reset role;
rollback;
