-- Baseline behavior through migration21: atomic legacy provision publishes
-- envelopes without any independently registered no-snapshot key witness.
begin;
create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_condition is not true then raise exception 'assertion failed: %', p_message; end if;
  raise notice 'BASELINE %', p_message;
end $$;
create temporary table verifier_baseline(value jsonb);
grant all on verifier_baseline to authenticated;
insert into verifier_baseline select jsonb_build_object(
  'user',gen_random_uuid(),'workspace',gen_random_uuid(),'project',gen_random_uuid(),
  'session',gen_random_uuid(),'device',gen_random_uuid(),'key',gen_random_uuid());
insert into auth.users(id) select (value->>'user')::uuid from verifier_baseline;
insert into auth.sessions(id,user_id) select (value->>'session')::uuid,(value->>'user')::uuid from verifier_baseline;
insert into public.workspaces(id,name,slug) select (value->>'workspace')::uuid,'Synthetic baseline','baseline-'||(value->>'workspace') from verifier_baseline;
insert into public.workspace_members(workspace_id,user_id,role) select (value->>'workspace')::uuid,(value->>'user')::uuid,'owner' from verifier_baseline;
insert into public.projects(id,workspace_id,name,slug,created_by) select (value->>'project')::uuid,(value->>'workspace')::uuid,'Synthetic baseline','baseline-'||(value->>'project'),(value->>'user')::uuid from verifier_baseline;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',value->>'user','session_id',value->>'session','device_id',value->>'device')::text,true) from verifier_baseline;
select public.mobile_register_device((value->>'device')::uuid,(value->>'key')::uuid,'desktop','Synthetic baseline','x25519-v1',digest(value->>'key','sha256')) from verifier_baseline;
select public.mobile_enroll_project_device((value->>'device')::uuid,(value->>'project')::uuid,(value->>'device')::uuid) from verifier_baseline;
select pg_temp.assert_true(not (to_jsonb(public.mobile_rotate_project_key_with_envelopes(
  (value->>'device')::uuid,(value->>'project')::uuid,0,'baseline-control',jsonb_build_array(jsonb_build_object(
    'algorithm','x25519-xsalsa20-poly1305-sealedbox-v1','envelope_id',gen_random_uuid(),
    'recipient_device_id',value->>'device','recipient_key_id',value->>'key',
    'sealed_project_key_hex',repeat('cd',80),'sealed_project_key_sha256',encode(digest(decode(repeat('cd',80),'hex'),'sha256'),'hex'))))) ? 'recovery_verifier'),
  'legacy atomic provision has no project-bound key witness') from verifier_baseline;
select pg_temp.assert_true(to_jsonb(public.mobile_get_recovery_snapshot((value->>'device')::uuid,(value->>'project')::uuid,1)) is null,
  'new legacy key without snapshot cannot independently authenticate an OA1 candidate') from verifier_baseline;
select pg_temp.assert_true(to_regprocedure('public.mobile_get_project_key_verifier(uuid,uuid,integer)') is null,
  'baseline has no registered non-prose witness reader');
rollback;
