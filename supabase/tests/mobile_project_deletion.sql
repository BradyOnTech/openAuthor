-- Real RLS, elevated metadata triggers, lease and finalization controls. The
-- fixture DELETEs below model Storage-API success; they do not prove blob purge.
begin;
create function pg_temp.assert_true(p_condition boolean,p_message text)
returns void language plpgsql as $$ begin
  if p_condition is not true then raise exception 'assertion failed: %',p_message; end if;
end $$;
create function pg_temp.assert_error(p_sql text,p_state text,p_message text)
returns void language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate = p_state then return; end if;
    raise exception 'wrong SQLSTATE %: % (%)',sqlstate,p_message,sqlerrm;
  end;
  raise exception 'assertion failed: %',p_message;
end $$;
create temporary table deletion_state(value jsonb);
grant all on deletion_state to authenticated,service_role,mobile_deletion_verifier;
insert into storage.objects(bucket_id,name) values
  ('mobile-encrypted-sync','projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin'),
  ('mobile-encrypted-sync','projects/30000000-0000-0000-0000-000000000001/orphans/60000000-0000-0000-0000-000000000099.bin'),
  ('mobile-encrypted-sync','projects/30000000-0000-0000-0000-000000000003/snapshots/60000000-0000-0000-0000-000000000003.bin');
-- Populate restrictive encrypted-child foreign keys so finalization exercises
-- their real dependency order, rather than succeeding on an unencryped book.
insert into public.mobile_project_key_versions(project_id,key_version,created_by_device_id,rotation_reason_code)
values ('30000000-0000-0000-0000-000000000001',1,'40000000-0000-0000-0000-000000000001','deletion-fixture');
insert into public.mobile_project_key_envelopes(id,project_id,key_version,recipient_device_id,recipient_key_id,sender_device_id,algorithm,sealed_project_key,sealed_project_key_sha256)
values ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','x25519-xsalsa20-poly1305-sealedbox-v1',decode(repeat('cd',80),'hex'),encode(digest(decode(repeat('cd',80),'hex'),'sha256'),'hex'));
insert into public.mobile_snapshot_manifests(snapshot_id,project_id,project_revision,key_version,schema_version,object_bucket,object_path,object_byte_length,object_sha256,manifest_algorithm,manifest_nonce,manifest_ciphertext,manifest_ciphertext_sha256,created_by_device_id)
values ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','deletion-fixture',1,1,'mobile-encrypted-sync','projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin',40,repeat('ab',32),'aes-256-gcm-v1',decode(repeat('01',12),'hex'),decode(repeat('02',17),'hex'),encode(digest(decode(repeat('02',17),'hex'),'sha256'),'hex'),'40000000-0000-0000-0000-000000000001');
insert into public.mobile_snapshot_acknowledgements(snapshot_id,project_id,device_id,acknowledgement)
values ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','verified');
insert into public.mobile_outbox_envelopes(operation_id,project_id,source_device_id,key_version,base_project_revision,operation_type,client_created_at,algorithm,nonce,ciphertext,ciphertext_sha256)
values ('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,'deletion-fixture','capture_note',clock_timestamp(),'aes-256-gcm-v1',decode(repeat('01',12),'hex'),decode(repeat('02',17),'hex'),encode(digest(decode(repeat('02',17),'hex'),'sha256'),'hex'));
insert into public.mobile_outbox_acknowledgements(operation_id,project_id,device_id,status)
values ('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','imported');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","session_id":"90000000-0000-0000-0000-000000000001","device_id":"40000000-0000-0000-0000-000000000001"}',true);
select pg_temp.assert_error($q$select public.mobile_begin_project_deletion('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003')$q$,'42501','foreign project cannot be frozen');
insert into deletion_state select public.mobile_begin_project_deletion('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(public.mobile_begin_project_deletion('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001') = (select value from deletion_state),'same owner begin is idempotent');
select pg_temp.assert_true(not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),'deletion closes ongoing voice authority');
select pg_temp.assert_true((select count(*) = 0 from storage.objects),'author RLS loses frozen object visibility');
select pg_temp.assert_error($q$select public.project_restore('30000000-0000-0000-0000-000000000001')$q$,'42501','restore cannot reopen deleting namespace');
select pg_temp.assert_error($q$select public.mobile_enroll_project_device('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002')$q$,'42501','new enrollment cannot reopen namespace');
select pg_temp.assert_error($q$select public.mobile_claim_project_deletion((select (value->>'job_id')::uuid from deletion_state),60)$q$,'42501','authenticated caller cannot claim worker lease');
select pg_temp.assert_error('select * from public.mobile_project_deletion_jobs','42501','direct job and lease records are private');
select pg_temp.assert_true(not (public.mobile_get_project_deletion('40000000-0000-0000-0000-000000000001',(select (value->>'job_id')::uuid from deletion_state)) ? 'lease_token'),'author status never exposes worker capability');
reset role;
select pg_temp.assert_error($q$insert into storage.objects(bucket_id,name) values ('mobile-encrypted-sync','projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000004.bin')$q$,'42501','elevated upload completion cannot insert after freeze');
select pg_temp.assert_error($q$update storage.objects set name='projects/30000000-0000-0000-0000-000000000002/snapshots/60000000-0000-0000-0000-000000000001.bin' where name='projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin'$q$,'42501','elevated move checks OLD frozen namespace');
select pg_temp.assert_error($q$update storage.objects set name='projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000003.bin' where name='projects/30000000-0000-0000-0000-000000000003/snapshots/60000000-0000-0000-0000-000000000003.bin'$q$,'42501','elevated move checks NEW frozen namespace');
select pg_temp.assert_error($q$delete from public.projects where id='30000000-0000-0000-0000-000000000001'$q$,'42501','metadata deletion cannot bypass worker');
delete from auth.sessions where id='90000000-0000-0000-0000-000000000001';
set local role service_role;
update deletion_state set value = public.mobile_claim_project_deletion((value->>'job_id')::uuid,60);
select pg_temp.assert_true((select value->>'phase'='deleting' from deletion_state),'durable worker proceeds after requester session deletion');
select pg_temp.assert_error($q$select public.mobile_claim_project_deletion((select (value->>'job_id')::uuid from deletion_state),60)$q$,'40001','active lease cannot be stolen');
select pg_temp.assert_error($q$select public.mobile_prepare_project_deletion_batch((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state),array['projects/30000000-0000-0000-0000-000000000003/other.bin'])$q$,'22023','foreign pending path rejected');
select pg_temp.assert_error($q$select public.mobile_prepare_project_deletion_batch((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state),array['projects/30000000-0000-0000-0000-000000000001/'])$q$,'22023','empty object suffix rejected');
update deletion_state set value=public.mobile_prepare_project_deletion_batch((value->>'job_id')::uuid,'30000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,array['projects/30000000-0000-0000-0000-000000000001/orphans/60000000-0000-0000-0000-000000000099.bin']);
select pg_temp.assert_error($q$select public.mobile_ack_project_deletion_batch((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state),array['projects/30000000-0000-0000-0000-000000000001/orphans/60000000-0000-0000-0000-000000000099.bin'])$q$,'55000','unfiltered exact remaining metadata denies false absence readback');
reset role;
-- Local metadata fixture only: actual HTTP worker tests cover API delete calls.
delete from storage.objects where name='projects/30000000-0000-0000-0000-000000000001/orphans/60000000-0000-0000-0000-000000000099.bin';
set local role service_role;
select pg_temp.assert_error($q$select public.mobile_ack_project_deletion_batch((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state),array['projects/30000000-0000-0000-0000-000000000001/other.bin'])$q$,'40001','ack requires exact durable pending batch');
update deletion_state set value=public.mobile_ack_project_deletion_batch((value->>'job_id')::uuid,'30000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,array['projects/30000000-0000-0000-0000-000000000001/orphans/60000000-0000-0000-0000-000000000099.bin']);
select pg_temp.assert_true((select value->'pending_paths'='[]'::jsonb from deletion_state),'confirmed orphan metadata clears exact prepared intent');
select pg_temp.assert_error($q$select public.mobile_mark_project_deletion_storage_empty((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state))$q$,'55000','filtered author list empty cannot satisfy unfiltered completion');
reset role;
update public.mobile_project_deletion_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where project_id='30000000-0000-0000-0000-000000000001';
set local role service_role;
select pg_temp.assert_error($q$select public.mobile_renew_project_deletion_lease((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state),60)$q$,'40001','expired token cannot renew');
update deletion_state set value=public.mobile_claim_project_deletion((value->>'job_id')::uuid,60);
reset role;
delete from storage.objects where starts_with(name,'projects/30000000-0000-0000-0000-000000000001/');
set local role service_role;
update deletion_state set value=public.mobile_mark_project_deletion_storage_empty((value->>'job_id')::uuid,'30000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid);
select pg_temp.assert_true((select value->>'phase'='awaiting_backend_verification' from deletion_state),'metadata-empty stops before backing certification');
select pg_temp.assert_error($q$select public.mobile_finalize_project_deletion((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state),repeat('ab',32))$q$,'42501','Storage worker cannot fabricate separate verifier attestation');
reset role;
set local role mobile_deletion_verifier;
select pg_temp.assert_error($q$select public.mobile_finalize_project_deletion((select (value->>'job_id')::uuid from deletion_state),'30000000-0000-0000-0000-000000000001',(select (value->>'lease_token')::uuid from deletion_state),null)$q$,'55000','verifier must supply external record digest');
update deletion_state set value=public.mobile_finalize_project_deletion((value->>'job_id')::uuid,'30000000-0000-0000-0000-000000000001',(value->>'lease_token')::uuid,repeat('ab',32));
select pg_temp.assert_true((select value->>'phase'='finalized' and value->'lease_token'='null'::jsonb from deletion_state),'attested metadata finalization retires lease');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.projects where id='30000000-0000-0000-0000-000000000001') and exists(select 1 from public.mobile_project_deletion_jobs where project_id='30000000-0000-0000-0000-000000000001'),'permanent tombstone survives project removal');
select pg_temp.assert_true(not exists(select 1 from public.mobile_snapshot_manifests where project_id='30000000-0000-0000-0000-000000000001') and not exists(select 1 from public.mobile_outbox_envelopes where project_id='30000000-0000-0000-0000-000000000001') and not exists(select 1 from public.mobile_project_key_versions where project_id='30000000-0000-0000-0000-000000000001'),'attested finalization removes encrypted metadata and restrictive child dependencies');
select pg_temp.assert_error($q$insert into storage.objects(bucket_id,name) values ('mobile-encrypted-sync','projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000004.bin')$q$,'42501','late elevated upload denied after metadata removal');
select pg_temp.assert_error($q$insert into public.projects(id,workspace_id,name,slug,created_by) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Reused','reused','10000000-0000-0000-0000-000000000001')$q$,'42501','deleted UUID cannot be reused under old in-flight work');
select pg_temp.assert_true((select count(*)=1 from storage.objects) and exists(select 1 from public.projects where id='30000000-0000-0000-0000-000000000003'),'adjacent project and ciphertext metadata retained');
rollback;
