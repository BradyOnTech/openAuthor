-- Server authorization/version and actual composite-wire checks. Ciphertext
-- authentication is covered by desktop tests using real encryption primitives.
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

insert into public.mobile_project_key_versions(project_id,key_version,created_by_device_id,rotation_reason_code)
values ('30000000-0000-0000-0000-000000000001',1,'40000000-0000-0000-0000-000000000001','recovery-fixture');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","session_id":"90000000-0000-0000-0000-000000000001","device_id":"40000000-0000-0000-0000-000000000001"}',true);
select pg_temp.assert_true(to_jsonb(public.mobile_get_recovery_snapshot('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1)) is null,'no committed snapshot returns JSON null');
reset role;
insert into public.mobile_snapshot_manifests (
  snapshot_id,project_id,project_revision,key_version,schema_version,object_bucket,object_path,object_byte_length,object_sha256,
  manifest_algorithm,manifest_nonce,manifest_ciphertext,manifest_ciphertext_sha256,created_by_device_id
) values (
  '60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','recovery-test',1,1,'mobile-encrypted-sync',
  'projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin',40,repeat('ab',32),
  'aes-256-gcm-v1',decode(repeat('01',12),'hex'),decode(repeat('02',17),'hex'),
  encode(digest(decode(repeat('02',17),'hex'),'sha256'),'hex'),'40000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.mobile_list_snapshot_manifests('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1)),'ordinary list still requires a recipient envelope');
select pg_temp.assert_true((public.mobile_get_recovery_snapshot('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1)).snapshot_id = '60000000-0000-0000-0000-000000000001','enrolled editor can read exact current ciphertext without envelope');
select pg_temp.assert_error($q$select public.mobile_get_recovery_snapshot('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',2)$q$,'40001','wrong version refuses read');
select pg_temp.assert_error($q$select public.mobile_get_recovery_snapshot('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',1)$q$,'42501','foreign book refuses recovery read');
select pg_temp.assert_true((to_jsonb(public.mobile_recover_project_key_envelope('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'41000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000011',repeat('cd',80))) ->> 'id') = '50000000-0000-0000-0000-000000000011','actual committed envelope emits id, not envelope_id');
select pg_temp.assert_true((public.mobile_recover_project_key_envelope('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'41000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000011',repeat('cd',80))).sealed_project_key = decode(repeat('cd',80),'hex'),'exact repeated envelope receipt is idempotent');
select pg_temp.assert_error($q$select public.mobile_recover_project_key_envelope('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'41000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000011',repeat('ef',80))$q$,'22000','different ciphertext cannot replace immutable id');
select pg_temp.assert_error($q$select public.mobile_recover_project_key_envelope('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'41000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000012',repeat('ef',80))$q$,'40001','another device key cannot become self recipient');
reset role;
update public.workspace_members set role = 'viewer' where workspace_id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_error($q$select public.mobile_get_recovery_snapshot('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1)$q$,'42501','viewer cannot recovery-read');
reset role;
update public.workspace_members set role = 'owner' where workspace_id = '20000000-0000-0000-0000-000000000001';
update public.mobile_project_key_versions set retired_at = clock_timestamp() where project_id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_error($q$select public.mobile_recover_project_key_envelope('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'41000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000012',repeat('ef',80))$q$,'40001','retired project version cannot install');
select pg_temp.assert_true(not has_function_privilege('anon','public.mobile_get_recovery_snapshot(uuid,uuid,integer)','EXECUTE'),'recovery RPC remains private to authenticated editors');
reset role;
select pg_temp.assert_true((select count(*) = 1 from public.mobile_project_key_envelopes where project_id = '30000000-0000-0000-0000-000000000001'),'every refusal retains original envelope only');
rollback;
