-- Real SQL authorization, receipt, atomicity and lifecycle controls. The
-- verifier bytes below are metadata fixtures; client suites prove real AEAD.
begin;
create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_condition is not true then raise exception 'assertion failed: %', p_message; end if;
  raise notice 'PASS %', p_message;
end $$;
create function pg_temp.assert_error(p_sql text, p_state text, p_message text)
returns void language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice 'PASS % (SQLSTATE %)', p_message, p_state; return; end if;
    raise exception 'wrong SQLSTATE %: % (%)', sqlstate, p_message, sqlerrm;
  end;
  raise exception 'assertion failed: %', p_message;
end $$;
create function pg_temp.verifier(p_project uuid, p_version integer)
returns jsonb language sql as $$ select jsonb_build_object(
  'schema','openauthor.mobile.project-key-verifier','schema_version',1,
  'project_id',p_project,'key_version',p_version,'algorithm','aes-256-gcm-v1','aad_version',1,
  'nonce_hex',repeat('01',12),'ciphertext_hex',repeat('cd',57),
  'ciphertext_sha256',encode(digest(decode(repeat('cd',57),'hex'),'sha256'),'hex')) $$;
create function pg_temp.envelopes()
returns jsonb language sql as $$ select jsonb_build_array(
  jsonb_build_object('algorithm','x25519-xsalsa20-poly1305-sealedbox-v1','envelope_id',gen_random_uuid(),
    'recipient_device_id','e4000000-0000-4000-8000-000000000001','recipient_key_id','e5000000-0000-4000-8000-000000000001',
    'sealed_project_key_hex',repeat('cd',80),'sealed_project_key_sha256',encode(digest(decode(repeat('cd',80),'hex'),'sha256'),'hex')),
  jsonb_build_object('algorithm','x25519-xsalsa20-poly1305-sealedbox-v1','envelope_id',gen_random_uuid(),
    'recipient_device_id','e4000000-0000-4000-8000-000000000002','recipient_key_id','e5000000-0000-4000-8000-000000000002',
    'sealed_project_key_hex',repeat('ef',80),'sealed_project_key_sha256',encode(digest(decode(repeat('ef',80),'hex'),'sha256'),'hex'))) $$;
create function pg_temp.rotate(p_proof jsonb, p_previous integer default 1, p_envelopes jsonb default null)
returns jsonb language sql as $$ select public.mobile_rotate_project_key_with_verifier(
  'e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',p_previous,'verifier-control',
  coalesce(p_envelopes,pg_temp.envelopes()),p_proof) $$;
create temporary table verifier_state(id integer primary key, value jsonb);
grant all on verifier_state to authenticated, service_role, mobile_deletion_verifier;

insert into auth.users(id) values
  ('e1000000-0000-4000-8000-000000000001'),('e1000000-0000-4000-8000-000000000002'),('e1000000-0000-4000-8000-000000000003');
insert into auth.sessions(id,user_id) values
  ('e6000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001'),
  ('e6000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002'),
  ('e6000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003');
insert into public.workspaces(id,name,slug) values
  ('e2000000-0000-4000-8000-000000000001','Synthetic verifier book','verifier-owner'),
  ('e2000000-0000-4000-8000-000000000002','Synthetic adjacent book','verifier-adjacent');
insert into public.workspace_members(workspace_id,user_id,role) values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','owner'),
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','viewer'),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','owner');
insert into public.projects(id,workspace_id,name,slug,created_by) values
  ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Synthetic verifier book','verifier-book','e1000000-0000-4000-8000-000000000001'),
  ('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002','Synthetic adjacent book','adjacent-book','e1000000-0000-4000-8000-000000000003');
insert into public.mobile_devices(id,user_id,auth_session_id,platform,device_label) values
  ('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','desktop','Synthetic desktop'),
  ('e4000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','e6000000-0000-4000-8000-000000000002','ios','Synthetic phone'),
  ('e4000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003','e6000000-0000-4000-8000-000000000003','desktop','Synthetic adjacent desktop');
insert into public.mobile_device_keys(id,device_id,key_version,algorithm,public_key,public_key_sha256)
  select ('e5000000-0000-4000-8000-00000000000'||i)::uuid,('e4000000-0000-4000-8000-00000000000'||i)::uuid,1,'x25519-v1',
    digest(i::text,'sha256'),encode(digest(digest(i::text,'sha256'),'sha256'),'hex') from generate_series(1,3) i;
update public.mobile_devices set current_key_id=('e5000000-0000-4000-8000-00000000000'||right(id::text,1))::uuid
  where id::text like 'e4000000-%';
insert into public.mobile_project_devices(project_id,device_id,enrolled_by_device_id) values
  ('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001'),
  ('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000001'),
  ('e3000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000003','e4000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000001","session_id":"e6000000-0000-4000-8000-000000000001","device_id":"e4000000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert_true(not has_function_privilege('anon','public.mobile_get_project_key_verifier(uuid,uuid,integer)','EXECUTE'),'anonymous proof reads are denied');
select pg_temp.assert_true(not has_function_privilege('service_role','public.mobile_rotate_project_key_with_verifier(uuid,uuid,integer,text,jsonb,jsonb)','EXECUTE'),'Storage worker cannot provision a verifier');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.mobile_project_key_verifier_result(public.mobile_project_key_verifiers)','EXECUTE'),'private receipt helper is inaccessible');
select pg_temp.assert_error($q$select public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',null)$q$,'22023','null expected proof version is refused');
select pg_temp.assert_error($q$select public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',1)$q$,'40001','a book without a current key cannot provide a witness');

-- Existing clients are compatible but their versions have no invented proof.
insert into verifier_state values (1,to_jsonb(public.mobile_rotate_project_key_with_envelopes(
  'e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',0,'legacy-control',pg_temp.envelopes())));
select pg_temp.assert_true(public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',1) is null,'legacy active key returns null and never self-authenticates a candidate');
select pg_temp.assert_true(to_jsonb(public.mobile_get_recovery_snapshot('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',1)) is null,'legacy no-snapshot fixture has no ciphertext witness');
insert into verifier_state values (2,pg_temp.verifier('e3000000-0000-4000-8000-000000000001',2));
do $$
declare v_case record; v_proof jsonb := (select value from verifier_state where id=2);
begin
  for v_case in select * from (values
    ('null proof',null::jsonb,'22023'),
    ('array proof','[]'::jsonb,'22023'),
    ('extra field',v_proof||'{"raw_key":"forbidden"}'::jsonb,'22023'),
    ('missing field',v_proof-'nonce_hex','22023'),
    ('schema drift',jsonb_set(v_proof,'{schema}','"other"'),'22023'),
    ('string schema version',jsonb_set(v_proof,'{schema_version}','"1"'),'22023'),
    ('uppercase project',jsonb_set(v_proof,'{project_id}','"E3000000-0000-4000-8000-000000000001"'),'22023'),
    ('wrong project',jsonb_set(v_proof,'{project_id}','"e3000000-0000-4000-8000-000000000002"'),'22023'),
    ('wrong key version',jsonb_set(v_proof,'{key_version}','3'),'22023'),
    ('string key version',jsonb_set(v_proof,'{key_version}','"2"'),'22023'),
    ('unsupported algorithm',jsonb_set(v_proof,'{algorithm}','"aes-128-gcm-v1"'),'22023'),
    ('wrong AAD version',jsonb_set(v_proof,'{aad_version}','2'),'22023'),
    ('short nonce',jsonb_set(v_proof,'{nonce_hex}','"01"'),'22023'),
    ('uppercase nonce',jsonb_set(v_proof,'{nonce_hex}',to_jsonb(repeat('AB',12))),'22023'),
    ('short ciphertext',jsonb_set(v_proof,'{ciphertext_hex}','"cd"'),'22023'),
    ('uppercase ciphertext',jsonb_set(v_proof,'{ciphertext_hex}',to_jsonb(repeat('CD',57))),'22023'),
    ('wrong ciphertext digest',jsonb_set(v_proof,'{ciphertext_sha256}',to_jsonb(repeat('ab',32))),'22000')
  ) cases(label,proof,state) loop
    perform pg_temp.assert_error(format('select pg_temp.rotate(%L::jsonb)',v_case.proof),v_case.state,'invalid '||v_case.label||' leaves the original key active');
  end loop;
end $$;
select pg_temp.assert_error($q$select pg_temp.rotate((select value from verifier_state where id=2),1,jsonb_build_array(pg_temp.envelopes()->0))$q$,'42501','missing recipient cannot partially rotate or register a witness');
select pg_temp.assert_error($q$select pg_temp.rotate(pg_temp.verifier('e3000000-0000-4000-8000-000000000001',1),0)$q$,'40001','stale previous-version CAS cannot register a new witness');
reset role;
select pg_temp.assert_true((select count(*)=1 and max(key_version)=1 and bool_and(retired_at is null) from public.mobile_project_key_versions where project_id='e3000000-0000-4000-8000-000000000001') and not exists(select 1 from public.mobile_project_key_verifiers where project_id='e3000000-0000-4000-8000-000000000001'),'all early refusals leave one active legacy key and no verifier');
insert into verifier_state values (3,(select jsonb_set(pg_temp.envelopes(),'{0,envelope_id}',to_jsonb(id::text)) from public.mobile_project_key_envelopes where project_id='e3000000-0000-4000-8000-000000000001' order by id limit 1));
set local role authenticated;
select pg_temp.assert_error($q$select pg_temp.rotate((select value from verifier_state where id=2),1,(select value from verifier_state where id=3))$q$,'22000','late immutable envelope conflict rolls back key retirement and verifier registration');
reset role;
select pg_temp.assert_true((select count(*)=1 and bool_and(retired_at is null) from public.mobile_project_key_versions where project_id='e3000000-0000-4000-8000-000000000001') and (select count(*)=2 from public.mobile_project_key_envelopes where project_id='e3000000-0000-4000-8000-000000000001') and not exists(select 1 from public.mobile_project_key_verifiers),'late failure restores every preexisting key and envelope');
set local role authenticated;
insert into verifier_state values (4,pg_temp.rotate((select value from verifier_state where id=2)));
select pg_temp.assert_true((select value=jsonb_build_object('project_id','e3000000-0000-4000-8000-000000000001','key_version',2,'recovery_verifier',(select value from verifier_state where id=2)) from verifier_state where id=4),'atomic rotation returns the complete exact immutable verifier receipt');
select pg_temp.assert_true(public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',2)=(select value from verifier_state where id=2),'exact current witness is readable with no published snapshot');
select pg_temp.assert_error($q$select pg_temp.rotate((select value from verifier_state where id=2))$q$,'40001','replaying an accepted rotation cannot advance or overwrite the key');
select pg_temp.assert_error($q$select * from public.mobile_project_key_verifiers$q$,'42501','authenticated direct verifier reads remain private');
reset role;
delete from public.mobile_project_key_envelopes where project_id='e3000000-0000-4000-8000-000000000001' and key_version=2 and recipient_device_id='e4000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(not exists(select 1 from public.mobile_project_key_envelopes where project_id='e3000000-0000-4000-8000-000000000001' and key_version=2 and recipient_device_id='e4000000-0000-4000-8000-000000000002'),'viewer fixture has no current recipient envelope before witness read');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000002","session_id":"e6000000-0000-4000-8000-000000000002","device_id":"e4000000-0000-4000-8000-000000000002"}',true);
select pg_temp.assert_true(public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001',2)=(select value from verifier_state where id=2),'enrolled viewer without an envelope can read the exact current non-prose witness');
select pg_temp.assert_error($q$select public.mobile_rotate_project_key_with_verifier('e4000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001',2,'viewer',pg_temp.envelopes(),pg_temp.verifier('e3000000-0000-4000-8000-000000000001',3))$q$,'42501','viewer cannot provision or rotate');
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000003","session_id":"e6000000-0000-4000-8000-000000000003","device_id":"e4000000-0000-4000-8000-000000000003"}',true);
select pg_temp.assert_error($q$select public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001',2)$q$,'42501','foreign account cannot obtain a current verifier');
reset role;
select pg_temp.assert_error($q$update public.mobile_project_key_verifiers set nonce=decode(repeat('02',12),'hex') where project_id='e3000000-0000-4000-8000-000000000001'$q$,'42501','privileged updates cannot replace immutable witness bytes');
select pg_temp.assert_error($q$delete from public.mobile_project_key_verifiers where project_id='e3000000-0000-4000-8000-000000000001'$q$,'42501','privileged direct witness deletion cannot preserve its parent version');
set local role service_role;
select pg_temp.assert_error($q$select * from public.mobile_project_key_verifiers$q$,'42501','Storage worker cannot read the private table');
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='e6000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000001","session_id":"e6000000-0000-4000-8000-000000000001","device_id":"e4000000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert_error($q$select public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',2)$q$,'42501','expired GoTrue session cannot read a retained witness');
reset role;
update auth.sessions set not_after=null where id='e6000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into verifier_state values (5,pg_temp.rotate(pg_temp.verifier('e3000000-0000-4000-8000-000000000001',3),2));
select pg_temp.assert_error($q$select public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',2)$q$,'40001','retired witness cannot revive publishing authority');
reset role;
select pg_temp.assert_true((select count(*)=2 from public.mobile_project_key_verifiers where project_id='e3000000-0000-4000-8000-000000000001') and (select count(*)=5 from public.mobile_project_key_envelopes where project_id='e3000000-0000-4000-8000-000000000001'),'rotation retains historical witnesses and remaining envelopes until verified purge');
select pg_temp.assert_true((select count(*)=0 from public.mobile_snapshot_manifests where project_id='e3000000-0000-4000-8000-000000000001'),'successful no-snapshot witness registration did not invent snapshot content');
set local role authenticated;
insert into verifier_state values (6,public.mobile_begin_project_deletion('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001'));
select pg_temp.assert_error($q$select public.mobile_get_project_key_verifier('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',3)$q$,'42501','project deletion closes verifier reads');
select pg_temp.assert_error($q$select pg_temp.rotate(pg_temp.verifier('e3000000-0000-4000-8000-000000000001',4),3)$q$,'42501','project deletion closes new verifier rotations');
reset role;
select pg_temp.assert_error($q$insert into public.mobile_project_key_verifiers(project_id,key_version,algorithm,aad_version,nonce,ciphertext,ciphertext_sha256,created_by_device_id) values ('e3000000-0000-4000-8000-000000000001',1,'aes-256-gcm-v1',1,decode(repeat('01',12),'hex'),decode(repeat('cd',57),'hex'),encode(digest(decode(repeat('cd',57),'hex'),'sha256'),'hex'),'e4000000-0000-4000-8000-000000000001')$q$,'42501','elevated witness insertion cannot reopen a frozen project');
set local role service_role;
update verifier_state set value=public.mobile_claim_project_deletion((value->>'job_id')::uuid,60) where id=6;
update verifier_state set value=public.mobile_mark_project_deletion_storage_empty((value->>'job_id')::uuid,'e3000000-0000-4000-8000-000000000001',(value->>'lease_token')::uuid) where id=6;
reset role;
set local role mobile_deletion_verifier;
update verifier_state set value=public.mobile_finalize_project_deletion((value->>'job_id')::uuid,'e3000000-0000-4000-8000-000000000001',(value->>'lease_token')::uuid,repeat('ab',32)) where id=6;
reset role;
select pg_temp.assert_true(not exists(select 1 from public.mobile_project_key_verifiers where project_id='e3000000-0000-4000-8000-000000000001') and not exists(select 1 from public.mobile_project_key_versions where project_id='e3000000-0000-4000-8000-000000000001') and not exists(select 1 from public.projects where id='e3000000-0000-4000-8000-000000000001'),'attested metadata finalization cascades verifier purge without blocking dependency order');
select pg_temp.assert_true(exists(select 1 from public.mobile_project_deletion_jobs where project_id='e3000000-0000-4000-8000-000000000001' and phase='finalized') and exists(select 1 from public.projects where id='e3000000-0000-4000-8000-000000000002'),'permanent tombstone and adjacent book survive witness purge');
rollback;
