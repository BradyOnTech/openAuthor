-- Synthetic local accounts only. Metadata absence is not physical backing proof.
begin;
create function pg_temp.assert_true(p_condition boolean,p_message text)
returns void language plpgsql as $$ begin
  if p_condition is not true then raise exception 'assertion failed: %',p_message; end if;
end $$;
create function pg_temp.assert_error(p_sql text,p_state text,p_message text)
returns void language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate=p_state then return; end if;
    raise exception 'wrong SQLSTATE %: % (%)',sqlstate,p_message,sqlerrm;
  end;
  raise exception 'assertion failed: %',p_message;
end $$;
create function pg_temp.account_fixture(p_number integer)
returns jsonb language plpgsql as $$
declare v_user uuid:=('b1000000-0000-7000-8000-'||lpad(p_number::text,12,'0'))::uuid;
  v_ws uuid:=('b2000000-0000-7000-8000-'||lpad(p_number::text,12,'0'))::uuid;
  v_project uuid:=('b3000000-0000-7000-8000-'||lpad(p_number::text,12,'0'))::uuid;
  v_device uuid:=('b4000000-0000-7000-8000-'||lpad(p_number::text,12,'0'))::uuid;
  v_key uuid:=('b5000000-0000-7000-8000-'||lpad(p_number::text,12,'0'))::uuid;
  v_session uuid:=('b9000000-0000-7000-8000-'||lpad(p_number::text,12,'0'))::uuid;
  v_claims jsonb;
begin
  insert into auth.users(id) values(v_user);
  insert into auth.sessions(id,user_id) values(v_session,v_user);
  insert into public.workspaces(id,name,slug) values(v_ws,'Synthetic author workspace','account-'||p_number);
  insert into public.workspace_members(workspace_id,user_id,role) values(v_ws,v_user,'owner');
  insert into public.projects(id,workspace_id,name,slug,created_by) values(v_project,v_ws,'Synthetic book','book',v_user);
  v_claims:=jsonb_build_object('sub',v_user,'session_id',v_session,'device_id',v_device);
  perform set_config('request.jwt.claims',v_claims::text,true);
  perform public.mobile_register_device(v_device,v_key,'desktop','Synthetic account device','x25519-v1',digest(v_key::text,'sha256'));
  return jsonb_build_object('user',v_user,'workspace',v_ws,'project',v_project,'device',v_device,'key',v_key,'session',v_session,'claims',v_claims);
end $$;
create temporary table account_state(id integer primary key,value jsonb);
grant all on account_state to authenticated,service_role,mobile_deletion_verifier;
insert into account_state values(1,pg_temp.account_fixture(1));
set local role authenticated;
update account_state set value=value||jsonb_build_object('preflight',public.mobile_account_deletion_preflight((value->>'device')::uuid));
select pg_temp.assert_true((select jsonb_array_length(value->'preflight'->'inventory'->'projects')=1 from account_state),'plain project is in exact account scope without device enrollment');
select pg_temp.assert_true(public.mobile_get_account_deletion() is null,'pure preflight creates no durable deletion');
select pg_temp.assert_error($q$select public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',null,false) from account_state$q$,'22023','null dispositions refuse before mutation');
update account_state set value=value||jsonb_build_object('choices',jsonb_build_object('workspaces',jsonb_build_array(jsonb_build_object('workspace_id',value->>'workspace','action','delete')),'projects',jsonb_build_array(jsonb_build_object('project_id',value->>'project','action','delete','outbox','remove'))));
select pg_temp.assert_error($q$select public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',jsonb_set(value->'choices','{projects}',jsonb_build_array(value->'choices'->'projects'->0,value->'choices'->'projects'->0)),false) from account_state$q$,'22023','duplicate reviewed routes refuse');
reset role;
update public.projects set name='Changed before approval' where id=(select (value->>'project')::uuid from account_state);
set local role authenticated;
select pg_temp.assert_error($q$select public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',value->'choices',false) from account_state$q$,'40001','stale exact inventory refuses');
update account_state set value=value||jsonb_build_object('preflight',public.mobile_account_deletion_preflight((value->>'device')::uuid));
update account_state set value=value||jsonb_build_object('job',public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',value->'choices',false));
select pg_temp.assert_true((select value->'job'->>'phase'='deleting' from account_state),'explicit solo approval persists durable job');
select pg_temp.assert_true((select public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',value->'choices',false)->>'job_id'=value->'job'->>'job_id' from account_state),'lost begin reply reconciles exact immutable request after revocation');
select pg_temp.assert_true((select public.mobile_get_account_deletion((value->'job'->>'job_id')::uuid)->>'job_id'=value->'job'->>'job_id' from account_state),'owned live Auth progress survives device revocation');
select pg_temp.assert_true((select not public.authorize_realtime_session((value->>'project')::uuid,(value->>'device')::uuid) from account_state),'ordinary account authority is closed');
select pg_temp.assert_error($q$select public.workspace_bootstrap('Cannot reopen','new-name')$q$,'42501','bootstrap cannot reopen frozen account');
select pg_temp.assert_error($q$select public.project_restore((value->>'project')::uuid) from account_state$q$,'42501','registry mutations cannot reopen frozen account');
select pg_temp.assert_error('select * from public.mobile_account_deletion_jobs','42501','author cannot read private intent or worker state directly');
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'preflight'->>'inventory_sha256',repeat('ab',32)) from account_state$q$,'42501','author cannot fabricate cleanup receipt');
reset role;
select pg_temp.assert_error($q$delete from auth.users where id=(select (value->>'user')::uuid from account_state)$q$,'55000','Auth deletion cannot precede lifecycle completion');
select pg_temp.assert_error($q$insert into public.projects(workspace_id,name,slug,created_by) select (value->>'workspace')::uuid,'Late book','late',(value->>'user')::uuid from account_state$q$,'42501','late elevated project creation refuses closed account');
select pg_temp.assert_error($q$insert into storage.objects(bucket_id,name) select 'mobile-encrypted-sync','projects/'||(value->>'project')||'/orphans/late.bin' from account_state$q$,'42501','frozen solo project also closes orphan upload completion');
set local role service_role;
update account_state set value=value||jsonb_build_object('lease',public.mobile_claim_project_deletion((value->'job'->'projects'->0->>'project_job_id')::uuid,60));
update account_state set value=jsonb_set(value,'{lease}',public.mobile_mark_project_deletion_storage_empty((value->'lease'->>'job_id')::uuid,(value->>'project')::uuid,(value->'lease'->>'lease_token')::uuid));
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'preflight'->>'inventory_sha256',repeat('ab',32)) from account_state$q$,'42501','Storage worker cannot attest account cleanup');
reset role;
set local role mobile_deletion_verifier;
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'preflight'->>'inventory_sha256',repeat('ab',32)) from account_state$q$,'55000','metadata empty child is not independently finalized');
update account_state set value=jsonb_set(value,'{lease}',public.mobile_finalize_project_deletion((value->'lease'->>'job_id')::uuid,(value->>'project')::uuid,(value->'lease'->>'lease_token')::uuid,repeat('ab',32)));
update account_state set value=jsonb_set(value,'{job}',public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'preflight'->>'inventory_sha256',repeat('cd',32)));
select pg_temp.assert_true((select value->'job'->>'phase'='auth_ready' from account_state),'solo lifecycle reaches guarded Auth boundary after separate attestation');
reset role;
delete from auth.users where id=(select (value->>'user')::uuid from account_state);
select pg_temp.assert_true((select phase='finalized' and finalized_at is not null from public.mobile_account_deletion_jobs where user_id=(select (value->>'user')::uuid from account_state)),'Auth transaction finalizes durable receipt');
select pg_temp.assert_true(not exists(select 1 from public.workspaces where id=(select (value->>'workspace')::uuid from account_state)),'solo workspace metadata removed after child finalization');
select pg_temp.assert_true(not exists(select 1 from public.mobile_device_keys where device_id=(select (value->>'device')::uuid from account_state)),'account public key records removed');
select pg_temp.assert_true((select inventory=jsonb_build_object('reviewed_inventory_sha256',inventory_sha256) from public.mobile_account_deletion_jobs where user_id=(select (value->>'user')::uuid from account_state)),'final receipt drops reviewed names and device labels');
select pg_temp.assert_error($q$insert into auth.users(id) select (value->>'user')::uuid from account_state$q$,'42501','closed account UUID cannot be recreated');

-- Shared retention uses a second real synthetic author; no other ciphertext is
-- removed to satisfy account provenance foreign keys.
insert into account_state values(2,pg_temp.account_fixture(2));
insert into account_state values(3,pg_temp.account_fixture(3));
insert into public.workspace_members(workspace_id,user_id,role) select (a.value->>'workspace')::uuid,(b.value->>'user')::uuid,'editor' from account_state a,account_state b where a.id=2 and b.id=3;
select set_config('request.jwt.claims',(select value->'claims' from account_state where id=2)::text,true);
select public.mobile_enroll_project_device((value->>'device')::uuid,(value->>'project')::uuid,(value->>'device')::uuid) from account_state where id=2;
select public.mobile_enroll_project_device((a.value->>'device')::uuid,(a.value->>'project')::uuid,(b.value->>'device')::uuid) from account_state a,account_state b where a.id=2 and b.id=3;
insert into public.mobile_project_key_versions(project_id,key_version,created_by_device_id,rotation_reason_code) select (value->>'project')::uuid,1,(value->>'device')::uuid,'account-fixture' from account_state where id=2;
insert into public.mobile_project_key_envelopes(id,project_id,key_version,recipient_device_id,recipient_key_id,sender_device_id,algorithm,sealed_project_key,sealed_project_key_sha256)
select ('b6000000-0000-7000-8000-'||lpad(b.id::text,12,'0'))::uuid,(a.value->>'project')::uuid,1,(b.value->>'device')::uuid,(b.value->>'key')::uuid,(a.value->>'device')::uuid,'x25519-xsalsa20-poly1305-sealedbox-v1',decode(repeat('ab',80),'hex'),encode(digest(decode(repeat('ab',80),'hex'),'sha256'),'hex') from account_state a,account_state b where a.id=2 and b.id in(2,3);
insert into public.mobile_snapshot_manifests(snapshot_id,project_id,project_revision,key_version,schema_version,object_bucket,object_path,object_byte_length,object_sha256,manifest_algorithm,manifest_nonce,manifest_ciphertext,manifest_ciphertext_sha256,created_by_device_id)
select 'b7000000-0000-7000-8000-000000000002',(value->>'project')::uuid,'shared-original',1,1,'mobile-encrypted-sync','projects/'||(value->>'project')||'/snapshots/b7000000-0000-7000-8000-000000000002.bin',40,repeat('ab',32),'aes-256-gcm-v1',decode(repeat('01',12),'hex'),decode(repeat('02',17),'hex'),encode(digest(decode(repeat('02',17),'hex'),'sha256'),'hex'),(value->>'device')::uuid from account_state where id=2;
insert into storage.objects(bucket_id,name) select 'mobile-encrypted-sync','projects/'||(value->>'project')||'/snapshots/b7000000-0000-7000-8000-000000000002.bin' from account_state where id=2;
update account_state set value=value||jsonb_build_object('original_snapshot',(select to_jsonb(s) from public.mobile_snapshot_manifests s where snapshot_id='b7000000-0000-7000-8000-000000000002')) where id=2;
-- Two pending-outbox dispositions in one shared account are reviewed separately.
insert into public.projects(id,workspace_id,name,slug,created_by) select 'b3000000-0000-7000-8000-000000000022',(value->>'workspace')::uuid,'Shared second book','second', (value->>'user')::uuid from account_state where id=2;
select public.mobile_enroll_project_device((a.value->>'device')::uuid,'b3000000-0000-7000-8000-000000000022',(b.value->>'device')::uuid) from account_state a,account_state b where a.id=2 and b.id in(2,3);
insert into public.mobile_project_key_versions(project_id,key_version,created_by_device_id,rotation_reason_code) select 'b3000000-0000-7000-8000-000000000022',1,(value->>'device')::uuid,'account-fixture' from account_state where id=2;
insert into public.mobile_outbox_envelopes(operation_id,project_id,source_device_id,key_version,base_project_revision,operation_type,client_created_at,algorithm,nonce,ciphertext,ciphertext_sha256)
select ('b8000000-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n=2 then (a.value->>'project')::uuid else 'b3000000-0000-7000-8000-000000000022'::uuid end,
  (b.value->>'device')::uuid,1,'pending-original','capture_note',now(),'aes-256-gcm-v1',decode(repeat('01',12),'hex'),decode(repeat('02',17),'hex'),encode(digest(decode(repeat('02',17),'hex'),'sha256'),'hex')
from account_state a,account_state b,unnest(array[2,22,23]) n where a.id=2 and b.id=case when n=23 then 3 else 2 end;
update account_state set value=value||jsonb_build_object('original_outbox',(select to_jsonb(o) from public.mobile_outbox_envelopes o where operation_id='b8000000-0000-7000-8000-000000000002')) where id=2;
update account_state set value=value||jsonb_build_object('preflight',public.mobile_account_deletion_preflight((value->>'device')::uuid)) where id=2;
update account_state set value=value||jsonb_build_object('choices',jsonb_build_object('workspaces',jsonb_build_array(jsonb_build_object('workspace_id',value->>'workspace','action','leave')),'projects',jsonb_build_array(jsonb_build_object('project_id',value->>'project','action','retain','outbox','preserve'),jsonb_build_object('project_id','b3000000-0000-7000-8000-000000000022','action','retain','outbox','remove')))) where id=2;
set local role authenticated;
select pg_temp.assert_error($q$select public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',value->'choices',true) from account_state where id=2$q$,'55000','last shared owner must review handoff first');
reset role;
update public.workspace_members set role='owner' where workspace_id=(select (value->>'workspace')::uuid from account_state where id=2) and user_id=(select (value->>'user')::uuid from account_state where id=3);
update account_state set value=value||jsonb_build_object('preflight',public.mobile_account_deletion_preflight((value->>'device')::uuid)) where id=2;
set local role authenticated;
select pg_temp.assert_error($q$select public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',value->'choices',false) from account_state where id=2$q$,'22023','shared retention needs deliberate acknowledgment');
update account_state set value=value||jsonb_build_object('job',public.mobile_begin_account_deletion((value->>'device')::uuid,value->'preflight'->>'inventory_sha256',value->'choices',true)) where id=2;
select pg_temp.assert_true((select value->'job'->'projects'->0->'blockers' ? 'Remaining author must rotate the shared project key' from account_state where id=2),'rotation remains visible blocker');
reset role;
set local role mobile_deletion_verifier;
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'preflight'->>'inventory_sha256',repeat('cd',32)) from account_state where id=2$q$,'55000','shared key retirement alone does not satisfy rotation');
reset role;
select set_config('request.jwt.claims',(select value->'claims' from account_state where id=3)::text,true);
set local role authenticated;
select public.mobile_rotate_project_key_with_envelopes((b.value->>'device')::uuid,(a.value->>'project')::uuid,1,'account-deletion',jsonb_build_array(jsonb_build_object('algorithm','x25519-xsalsa20-poly1305-sealedbox-v1','envelope_id','b6000000-0000-7000-8000-000000000004','recipient_device_id',b.value->>'device','recipient_key_id',b.value->>'key','sealed_project_key_hex',repeat('cd',80),'sealed_project_key_sha256',encode(digest(decode(repeat('cd',80),'hex'),'sha256'),'hex')))) from account_state a,account_state b where a.id=2 and b.id=3;
select public.mobile_rotate_project_key_with_envelopes((b.value->>'device')::uuid,'b3000000-0000-7000-8000-000000000022',1,'account-deletion',jsonb_build_array(jsonb_build_object('algorithm','x25519-xsalsa20-poly1305-sealedbox-v1','envelope_id','b6000000-0000-7000-8000-000000000005','recipient_device_id',b.value->>'device','recipient_key_id',b.value->>'key','sealed_project_key_hex',repeat('cd',80),'sealed_project_key_sha256',encode(digest(decode(repeat('cd',80),'hex'),'sha256'),'hex')))) from account_state b where b.id=3;
select pg_temp.assert_error($q$select public.mobile_get_account_deletion((value->'job'->>'job_id')::uuid) from account_state where id=2$q$,'42501','another live author cannot inspect the account deletion intent');
reset role;
set local role mobile_deletion_verifier;
update account_state set value=jsonb_set(value,'{job}',public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'preflight'->>'inventory_sha256',repeat('cd',32))) where id=2;
reset role;
update public.mobile_project_key_versions set retired_at=clock_timestamp() where project_id=(select (value->>'project')::uuid from account_state where id=2) and key_version=2;
select pg_temp.assert_error($q$delete from auth.users where id=(select (value->>'user')::uuid from account_state where id=2)$q$,'55000','Auth transaction rechecks shared rotation even after account preparation');
update public.mobile_project_key_versions set retired_at=null where project_id=(select (value->>'project')::uuid from account_state where id=2) and key_version=2;
delete from auth.users where id=(select (value->>'user')::uuid from account_state where id=2);
select pg_temp.assert_true((select to_jsonb(s)=a.value->'original_snapshot' from public.mobile_snapshot_manifests s,account_state a where a.id=2 and s.snapshot_id='b7000000-0000-7000-8000-000000000002'),'shared snapshot and original source UUID remain byte-for-byte metadata identical');
select pg_temp.assert_true(exists(select 1 from storage.objects where name like '%b7000000-0000-7000-8000-000000000002.bin'),'other author shared ciphertext remains');
select pg_temp.assert_true(exists(select 1 from public.mobile_project_key_envelopes where id='b6000000-0000-7000-8000-000000000003') and not exists(select 1 from public.mobile_project_key_envelopes where id='b6000000-0000-7000-8000-000000000002'),'remaining recipient keeps old key; removed author recipient envelope is deleted');
select pg_temp.assert_true((select user_id is null and current_key_id is null and device_label='Deleted author' and revoked_at is not null from public.mobile_devices where id=(select (value->>'device')::uuid from account_state where id=2)),'historical device is authorless and contains no active credentials');
select pg_temp.assert_true((select created_by is null from public.projects where id=(select (value->>'project')::uuid from account_state where id=2)),'shared creator attribution no longer points to deleted Auth identity');
select pg_temp.assert_true(exists(select 1 from public.workspace_members where workspace_id=(select (value->>'workspace')::uuid from account_state where id=2) and user_id=(select (value->>'user')::uuid from account_state where id=3)),'remaining owner membership persists');
select pg_temp.assert_true((select to_jsonb(o)=a.value->'original_outbox' from public.mobile_outbox_envelopes o,account_state a where a.id=2 and o.operation_id='b8000000-0000-7000-8000-000000000002'),'reviewed preserve keeps original pending encrypted operation and AAD provenance');
select pg_temp.assert_true(not exists(select 1 from public.mobile_outbox_envelopes where operation_id='b8000000-0000-7000-8000-000000000022') and exists(select 1 from public.mobile_outbox_envelopes where operation_id='b8000000-0000-7000-8000-000000000023'),'reviewed remove deletes only departing author pending operation and keeps remaining author operation');
select pg_temp.assert_error($q$select public.mobile_register_device((a.value->>'device')::uuid,(a.value->>'key')::uuid,'desktop','Synthetic account device','x25519-v1',digest(a.value->>'key','sha256')) from account_state a where a.id=2$q$,'42501','another account cannot reclaim historical device UUID');
rollback;
