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
set local role mobile_deletion_verifier;
select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'original_review'->>'inventory_sha256',repeat('ab',32)) from amendment_state where id=1;
reset role;
update public.projects set workspace_id=(select (value->>'destination')::uuid from amendment_state where id=1) where id=(select (value->>'project')::uuid from amendment_state where id=1);
select pg_temp.assert_error($q$delete from auth.users where id=(select (value->>'user')::uuid from amendment_state where id=1)$q$,'55000','baseline retained move blocks Auth deletion');
set local role mobile_deletion_verifier;
select public.mobile_prepare_account_auth_finalization((value->'job'->>'job_id')::uuid,value->'original_review'->>'inventory_sha256',repeat('cd',32)) from amendment_state where id=1;
reset role;
select pg_temp.assert_true((select phase='auth_ready' and cleanup_verification_sha256=repeat('ab',32) from public.mobile_account_deletion_jobs where job_id=(select (value->'job'->>'job_id')::uuid from amendment_state where id=1)),'baseline cannot invalidate old prepared scope');
select pg_temp.assert_true(to_regprocedure('public.mobile_account_deletion_amendment_preflight(uuid)') is null,'baseline has no reviewed recovery interface');
do $$ begin raise notice 'BASELINE RED: moved retained book permanently blocks Auth (55000); cleanup stays auth_ready and no reviewed amendment exists'; end $$;
rollback;
