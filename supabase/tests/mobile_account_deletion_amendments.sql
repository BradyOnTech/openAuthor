-- Disposable synthetic accounts. Digests simulate independent operator proof;
-- this SQL has no backing store, external Auth service or provider traffic.
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
create function pg_temp.amendment_fixture(p_number integer,p_encrypted boolean default false)
returns jsonb language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_owner uuid:=gen_random_uuid(); v_session uuid:=gen_random_uuid(); v_owner_session uuid:=gen_random_uuid();
  v_workspace uuid:=gen_random_uuid(); v_destination uuid:=gen_random_uuid(); v_project uuid:=gen_random_uuid();
  v_device uuid:=gen_random_uuid(); v_key uuid:=gen_random_uuid(); v_owner_device uuid:=gen_random_uuid(); v_owner_key uuid:=gen_random_uuid();
  v_claims jsonb; v_owner_claims jsonb; v_review jsonb; v_choices jsonb; v_job jsonb; begin
  insert into auth.users(id) values(v_user),(v_owner);
  insert into auth.sessions(id,user_id) values(v_session,v_user),(v_owner_session,v_owner);
  insert into public.workspaces(id,name,slug) values(v_workspace,'Original shared workspace','amendment-original-'||p_number),(v_destination,'Foreign private destination name','amendment-destination-'||p_number);
  insert into public.workspace_members(workspace_id,user_id,role) values(v_workspace,v_user,'owner'),(v_workspace,v_owner,'owner'),(v_destination,v_owner,'owner');
  insert into public.projects(id,workspace_id,name,slug,created_by) values(v_project,v_workspace,'Historical reviewed book','book',v_user);
  v_claims:=jsonb_build_object('sub',v_user,'session_id',v_session,'device_id',v_device);
  v_owner_claims:=jsonb_build_object('sub',v_owner,'session_id',v_owner_session,'device_id',v_owner_device);
  perform set_config('request.jwt.claims',v_claims::text,true);
  perform public.mobile_register_device(v_device,v_key,'desktop','Departing synthetic author','x25519-v1',digest(v_key::text,'sha256'));
  perform set_config('request.jwt.claims',v_owner_claims::text,true);
  perform public.mobile_register_device(v_owner_device,v_owner_key,'desktop','Remaining synthetic author','x25519-v1',digest(v_owner_key::text,'sha256'));
  perform public.mobile_enroll_project_device(v_owner_device,v_project,v_owner_device);
  insert into public.mobile_project_key_versions(project_id,key_version,created_by_device_id,rotation_reason_code) values(v_project,1,v_owner_device,'amendment-fixture');
  if p_encrypted then
    perform public.mobile_enroll_project_device(v_owner_device,v_project,v_device);
  end if;
  perform set_config('request.jwt.claims',v_claims::text,true);
  v_review:=public.mobile_account_deletion_preflight(v_device);
  v_choices:=jsonb_build_object('workspaces',jsonb_build_array(jsonb_build_object('workspace_id',v_workspace,'action','leave')),
    'projects',jsonb_build_array(jsonb_build_object('project_id',v_project,'action','retain','outbox','preserve')));
  v_job:=public.mobile_begin_account_deletion(v_device,v_review->>'inventory_sha256',v_choices,true);
  return jsonb_build_object('user',v_user,'owner',v_owner,'session',v_session,'owner_session',v_owner_session,'workspace',v_workspace,'destination',v_destination,
    'project',v_project,'device',v_device,'key',v_key,'owner_device',v_owner_device,'owner_key',v_owner_key,'claims',v_claims,'owner_claims',v_owner_claims,
    'original_review',v_review,'choices',v_choices,'job',v_job);
end $$;
create temporary table amendment_state(id integer primary key,value jsonb);
grant all on amendment_state to authenticated,service_role,mobile_deletion_verifier;
insert into amendment_state values(1,pg_temp.amendment_fixture(1));
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('review0',public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)) where id=1;
select pg_temp.assert_true((select value->'review0'->'projects'->0->'allowed_resolution'='null'::jsonb from amendment_state where id=1),'unchanged retained scope offers no amendment');
select pg_temp.assert_error($q$select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,gen_random_uuid(),0,value->'review0'->>'review_sha256',jsonb_build_array(jsonb_build_object('project_id',value->>'project','resolution','retain_current_scope','workspace_id',value->>'workspace'))) from amendment_state where id=1$q$,'22023','no-effect resolution refuses');
select pg_temp.assert_true((select public.mobile_get_account_deletion_amendment((value->'job'->>'job_id')::uuid,gen_random_uuid()) is null from amendment_state where id=1),'unknown amendment lookup is null and creates nothing');
reset role;
set local role mobile_deletion_verifier;
select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'original_review'->>'inventory_sha256',repeat('ab',32)) from amendment_state where id=1;
reset role;
update public.projects set workspace_id=(select (value->>'destination')::uuid from amendment_state where id=1) where id=(select (value->>'project')::uuid from amendment_state where id=1);
select pg_temp.assert_error($q$delete from auth.users where id=(select (value->>'user')::uuid from amendment_state where id=1)$q$,'55000','move after auth_ready cannot bypass effective retention scope');
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('review1',public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid),'amendment1',gen_random_uuid()) where id=1;
select pg_temp.assert_true((select value->'review1'->>'phase'='auth_ready' and value->'review1'->'projects'->0->>'allowed_resolution'='retain_current_scope' from amendment_state where id=1),'auth_ready move has explicitly reviewable repair');
select pg_temp.assert_true((select value->'review1'->'projects'->0->>'name'='Historical reviewed book' and position('Foreign private destination name' in (value->'review1')::text)=0 and position(value->>'owner' in (value->'review1')::text)=0 from amendment_state where id=1),'review exposes historical name and IDs but no foreign workspace or member details');
update amendment_state set value=value||jsonb_build_object('resolution1',jsonb_build_array(jsonb_build_object('project_id',value->>'project','resolution','retain_current_scope','workspace_id',value->>'destination'))) where id=1;
select pg_temp.assert_error($q$select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'amendment1')::uuid,0,value->'review1'->>'review_sha256',value->'resolution1'||jsonb_build_array(jsonb_build_object('project_id',gen_random_uuid(),'resolution','retain_current_scope','workspace_id',value->>'destination'))) from amendment_state where id=1$q$,'22023','mixed valid and foreign project resolutions roll back atomically');
select pg_temp.assert_error($q$select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'amendment1')::uuid,0,value->'review1'->>'review_sha256',jsonb_set(value->'resolution1','{0,action}','"delete"')) from amendment_state where id=1$q$,'22023','unknown destructive field cannot broaden intent');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.mobile_account_deletion_amendments where job_id=(select (value->'job'->>'job_id')::uuid from amendment_state where id=1)), 'refused batches create no partial audit or effective scope');
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('receipt1',public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'amendment1')::uuid,0,value->'review1'->>'review_sha256',value->'resolution1')) where id=1;
select pg_temp.assert_true((select value->'receipt1'->>'revision'='1' and value->'receipt1'->>'intent_sha256'<>value->'original_review'->>'inventory_sha256' from amendment_state where id=1),'accepted resolution produces versioned effective intent');
select pg_temp.assert_true((select public.mobile_get_account_deletion_amendment((value->'job'->>'job_id')::uuid,(value->>'amendment1')::uuid)=value->'receipt1' from amendment_state where id=1),'lost reply can reconcile exact receipt read-only');
select pg_temp.assert_true((select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'amendment1')::uuid,0,value->'review1'->>'review_sha256',value->'resolution1')=value->'receipt1' from amendment_state where id=1),'deliberate exact replay returns original receipt');
select pg_temp.assert_error($q$select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'amendment1')::uuid,0,value->'review1'->>'review_sha256',jsonb_set(value->'resolution1','{0,workspace_id}',value->'workspace')) from amendment_state where id=1$q$,'22023','UUID cannot be rebound to conflicting scope');
select pg_temp.assert_error($q$select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,gen_random_uuid(),0,value->'review1'->>'review_sha256',value->'resolution1') from amendment_state where id=1$q$,'40001','new stale amendment refuses');
select pg_temp.assert_error('select * from public.mobile_account_deletion_amendments','42501','private amendment audit has no author table access');
select pg_temp.assert_error($q$select public.mobile_account_amendment_snapshot((value->'job'->>'job_id')::uuid) from amendment_state where id=1$q$,'42501','canonical foreign membership fingerprint stays private');
reset role;
select pg_temp.assert_true((select a.phase='deleting' and a.cleanup_verification_sha256 is null and a.cleanup_intent_sha256 is null and public.mobile_account_is_frozen(a.user_id)
  from public.mobile_account_deletion_jobs a,amendment_state s where s.id=1 and a.job_id=(s.value->'job'->>'job_id')::uuid),'amendment invalidates auth_ready proof while keeping account frozen');
select pg_temp.assert_true((select a.inventory=s.value->'original_review'->'inventory' and a.inventory_sha256=s.value->'original_review'->>'inventory_sha256' and a.dispositions=s.value->'choices'
  from public.mobile_account_deletion_jobs a,amendment_state s where s.id=1 and a.job_id=(s.value->'job'->>'job_id')::uuid),'original inventory and destructive choices remain immutable');
select pg_temp.assert_true((select p.action='retain' and p.outbox='preserve' and p.project_job_id is null and p.workspace_id=(s.value->>'workspace')::uuid
  from public.mobile_account_deletion_projects p,amendment_state s where s.id=1 and p.job_id=(s.value->'job'->>'job_id')::uuid),'original retained route and outbox choice remain unchanged');
set local role mobile_deletion_verifier;
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'original_review'->>'inventory_sha256',repeat('cd',32)) from amendment_state where id=1$q$,'55000','old original digest cannot attest amended scope');
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'receipt1'->>'intent_sha256',repeat('ab',32)) from amendment_state where id=1$q$,'55000','invalidated cleanup digest cannot be reused');
select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'receipt1'->>'intent_sha256',repeat('cd',32)) from amendment_state where id=1;
reset role;
update public.projects set workspace_id=(select (value->>'workspace')::uuid from amendment_state where id=1) where id=(select (value->>'project')::uuid from amendment_state where id=1);
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('review2',public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid),'amendment2',gen_random_uuid()) where id=1;
update amendment_state set value=value||jsonb_build_object('receipt2',public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'amendment2')::uuid,1,value->'review2'->>'review_sha256',jsonb_build_array(jsonb_build_object('project_id',value->>'project','resolution','retain_current_scope','workspace_id',value->>'workspace')))) where id=1;
select pg_temp.assert_true((select public.mobile_get_account_deletion_amendment((value->'job'->>'job_id')::uuid,(value->>'amendment1')::uuid)=value->'receipt1' from amendment_state where id=1),'exact prior receipt survives superseding amendment');
select pg_temp.assert_true((select public.mobile_get_account_deletion((value->'job'->>'job_id')::uuid)->'amendment_receipt'=value->'receipt2' and public.mobile_get_account_deletion((value->'job'->>'job_id')::uuid)->>'amendment_revision'='2' from amendment_state where id=1),'current status exposes current revision independently of old receipt lookup');
reset role;
set local role mobile_deletion_verifier;
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'receipt2'->>'intent_sha256',repeat('cd',32)) from amendment_state where id=1$q$,'55000','every invalidated cleanup digest remains forbidden');
select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'receipt2'->>'intent_sha256',repeat('ef',32)) from amendment_state where id=1;
reset role;
delete from auth.users where id=(select (value->>'user')::uuid from amendment_state where id=1);
select pg_temp.assert_true((select phase='finalized' and amendment_revision=2 from public.mobile_account_deletion_jobs where job_id=(select (value->'job'->>'job_id')::uuid from amendment_state where id=1)),'amended current scope reaches guarded Auth finalization');
select pg_temp.assert_true(exists(select 1 from public.projects where id=(select (value->>'project')::uuid from amendment_state where id=1)),'scope repair retains shared project');

-- A separately approved project deletion is attached only after its verifier.
insert into amendment_state values(2,pg_temp.amendment_fixture(2));
select set_config('request.jwt.claims',(select value->'owner_claims' from amendment_state where id=2)::text,true);
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('independent_job',public.mobile_begin_project_deletion((value->>'owner_device')::uuid,(value->>'project')::uuid)) where id=2;
reset role;
select set_config('request.jwt.claims',(select value->'claims' from amendment_state where id=2)::text,true);
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('pending_review',public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)) where id=2;
select pg_temp.assert_true((select value->'pending_review'->'projects'->0->'allowed_resolution'='null'::jsonb from amendment_state where id=2),'pending independent deletion cannot substitute for proof');
reset role;
set local role service_role;
update amendment_state set value=value||jsonb_build_object('lease',public.mobile_claim_project_deletion((value->'independent_job'->>'job_id')::uuid,60)) where id=2;
update amendment_state set value=jsonb_set(value,'{lease}',public.mobile_mark_project_deletion_storage_empty((value->'lease'->>'job_id')::uuid,(value->>'project')::uuid,(value->'lease'->>'lease_token')::uuid)) where id=2;
reset role;
set local role authenticated;
select pg_temp.assert_true((select public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)->'projects'->0->'allowed_resolution'='null'::jsonb from amendment_state where id=2),'Storage metadata emptiness alone offers no attachment');
reset role;
set local role mobile_deletion_verifier;
select public.mobile_finalize_project_deletion((value->'lease'->>'job_id')::uuid,(value->>'project')::uuid,(value->'lease'->>'lease_token')::uuid,repeat('12',32)) from amendment_state where id=2;
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'original_review'->>'inventory_sha256',repeat('23',32)) from amendment_state where id=2$q$,'55000','absent retained project needs reviewed receipt attachment');
reset role;
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('deleted_review',public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid),'deleted_amendment',gen_random_uuid()) where id=2;
reset role;
-- Simulate corrupt operator metadata outside the closed write APIs. A receipt
-- still cannot make that surviving row invisible to a retention amendment.
alter table storage.objects disable trigger user;
insert into storage.objects(bucket_id,name) select 'mobile-encrypted-sync','projects/'||(value->>'project')||'/operator-corruption.bin' from amendment_state where id=2;
alter table storage.objects enable trigger user;
set local role authenticated;
select pg_temp.assert_true((select public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)->'projects'->0->'allowed_resolution'='null'::jsonb from amendment_state where id=2),'finalized receipt does not conceal surviving corrupt Storage metadata');
reset role;
delete from storage.objects where name=(select 'projects/'||(value->>'project')||'/operator-corruption.bin' from amendment_state where id=2);
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('deleted_resolution',jsonb_build_array(jsonb_build_object('project_id',value->>'project','resolution','attach_finalized_deletion','project_job_id',value->'independent_job'->>'job_id','backend_verification_sha256',repeat('12',32)))) where id=2;
select pg_temp.assert_error($q$select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'deleted_amendment')::uuid,0,value->'deleted_review'->>'review_sha256',jsonb_set(value->'deleted_resolution','{0,backend_verification_sha256}',to_jsonb(repeat('99',32)))) from amendment_state where id=2$q$,'22023','a different attestation cannot be attached');
update amendment_state set value=value||jsonb_build_object('deleted_receipt',public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,(value->>'deleted_amendment')::uuid,0,value->'deleted_review'->>'review_sha256',value->'deleted_resolution')) where id=2;
select pg_temp.assert_true((select public.mobile_get_account_deletion((value->'job'->>'job_id')::uuid)->'projects'->0->>'action'='retain'
  and public.mobile_get_account_deletion((value->'job'->>'job_id')::uuid)->'projects'->0->>'resolution'='independently_deleted'
  and public.mobile_get_account_deletion((value->'job'->>'job_id')::uuid)->'projects'->0->'project_job_id'='null'::jsonb from amendment_state where id=2),'attached receipt is explicitly independent and creates no destructive child');
select pg_temp.assert_true((select public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)->'projects'->0->'allowed_resolution'='null'::jsonb from amendment_state where id=2),'already attached receipt offers no redundant amendment');
reset role;
set local role mobile_deletion_verifier;
select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'deleted_receipt'->>'intent_sha256',repeat('23',32)) from amendment_state where id=2;
reset role;
delete from auth.users where id=(select (value->>'user')::uuid from amendment_state where id=2);
select pg_temp.assert_true((select phase='finalized' from public.mobile_account_deletion_jobs where job_id=(select (value->'job'->>'job_id')::uuid from amendment_state where id=2)),'exact independently attested receipt permits account completion');

-- Scope repair does not waive the original encryption-key threshold.
insert into amendment_state values(3,pg_temp.amendment_fixture(3,true));
update public.projects set workspace_id=(select (value->>'destination')::uuid from amendment_state where id=3) where id=(select (value->>'project')::uuid from amendment_state where id=3);
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('rotation_review',public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)) where id=3;
update amendment_state set value=value||jsonb_build_object('rotation_receipt',public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,gen_random_uuid(),0,value->'rotation_review'->>'review_sha256',jsonb_build_array(jsonb_build_object('project_id',value->>'project','resolution','retain_current_scope','workspace_id',value->>'destination')))) where id=3;
reset role;
set local role mobile_deletion_verifier;
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'rotation_receipt'->>'intent_sha256',repeat('34',32)) from amendment_state where id=3$q$,'55000','retention amendment never waives original key rotation');
reset role;
select pg_temp.assert_true((select r.needs_rotation and r.previous_key_version=1 from public.mobile_account_effective_retention((select (value->'job'->>'job_id')::uuid from amendment_state where id=3)) r),'original rotation threshold survives effective scope update');

-- Elevated removal of metadata without a permanent verified receipt cannot be
-- reinterpreted as backing purge or destructive authorization.
insert into amendment_state values(4,pg_temp.amendment_fixture(4));
delete from public.mobile_project_key_versions where project_id=(select (value->>'project')::uuid from amendment_state where id=4);
delete from public.mobile_project_devices where project_id=(select (value->>'project')::uuid from amendment_state where id=4);
delete from public.projects where id=(select (value->>'project')::uuid from amendment_state where id=4);
set local role authenticated;
update amendment_state set value=value||jsonb_build_object('absent_review',public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)) where id=4;
select pg_temp.assert_true((select value->'absent_review'->'projects'->0->'allowed_resolution'='null'::jsonb and value->'absent_review'->'projects'->0->'independent_deletion'='null'::jsonb from amendment_state where id=4),'unknown absence remains an explicit unresolved blocker');
select pg_temp.assert_error($q$select public.mobile_amend_account_deletion((value->'job'->>'job_id')::uuid,gen_random_uuid(),0,value->'absent_review'->>'review_sha256',jsonb_build_array(jsonb_build_object('project_id',value->>'project','resolution','attach_finalized_deletion','project_job_id',gen_random_uuid(),'backend_verification_sha256',repeat('45',32)))) from amendment_state where id=4$q$,'22023','unknown absent project cannot accept invented receipt');
reset role;
set local role mobile_deletion_verifier;
select pg_temp.assert_error($q$select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'original_review'->>'inventory_sha256',repeat('45',32)) from amendment_state where id=4$q$,'55000','unknown absent project remains outside proof of account completion');
reset role;

-- The frozen account session is the authority; a revoked/missing device claim
-- is neither reopened nor required for content-free review and receipt lookup.
select set_config('request.jwt.claims',((select value->'claims' from amendment_state where id=4)-'device_id')::text,true);
set local role authenticated;
select pg_temp.assert_true((select public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid)->>'job_id'=value->'job'->>'job_id' from amendment_state where id=4),'owned live Auth permits amendment review with no device');
reset role;

-- Foreign, expired, missing and elevated actors do not gain frozen authority.
select set_config('request.jwt.claims',(select value->'owner_claims' from amendment_state where id=3)::text,true);
set local role authenticated;
select pg_temp.assert_error($q$select public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid) from amendment_state where id=3$q$,'42501','remaining author cannot amend departing author intent');
select pg_temp.assert_error($q$select public.mobile_get_account_deletion_amendment((value->'job'->>'job_id')::uuid,gen_random_uuid()) from amendment_state where id=3$q$,'42501','foreign author cannot inspect receipt');
reset role;
select set_config('request.jwt.claims',(select value->'claims' from amendment_state where id=3)::text,true);
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=(select (value->>'session')::uuid from amendment_state where id=3);
set local role authenticated;
select pg_temp.assert_error($q$select public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid) from amendment_state where id=3$q$,'42501','expired Auth session cannot review amendment');
reset role;
set local role service_role;
select pg_temp.assert_error($q$select public.mobile_account_deletion_amendment_preflight((value->'job'->>'job_id')::uuid) from amendment_state where id=3$q$,'42501','Storage service cannot approve amendment');
reset role;
select pg_temp.assert_true(not has_function_privilege('authenticated','public.mobile_prepare_account_auth_finalization(uuid,text,text)','execute')
  and not has_function_privilege('service_role','public.mobile_account_amendment_snapshot(uuid)','execute')
  and not has_function_privilege('anon','public.mobile_amend_account_deletion(uuid,uuid,integer,text,jsonb)','execute'),'private verifier and canonical snapshot grants remain narrow');
rollback;
