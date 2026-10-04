-- Actual authenticated table reads and own-state writes. Fixture grants model
-- configured Supabase table privileges and are rolled back with all test data.
begin;
create temporary table registry_controls(message text);
grant insert,select on registry_controls to authenticated,anon;
create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_condition is not true then raise exception 'assertion failed: %', p_message; end if;
  insert into pg_temp.registry_controls values(p_message);
end $$;
create function pg_temp.assert_error(p_sql text, p_state text, p_message text)
returns void language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate = p_state then
      insert into pg_temp.registry_controls values(p_message);
      return;
    end if;
    raise exception 'wrong SQLSTATE %: % (%)', sqlstate, p_message, sqlerrm;
  end;
  raise exception 'assertion failed: %', p_message;
end $$;
create temporary table registry_authors(n integer primary key, user_id uuid, session_id uuid, device_id uuid);
insert into registry_authors select n,
  ('f1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  ('f9000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  ('f4000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
from generate_series(1,5) n;
insert into auth.users(id) select user_id from registry_authors;
insert into auth.sessions(id,user_id) select session_id,user_id from registry_authors;
insert into public.workspaces(id,name,slug) values
  ('f2000000-0000-4000-8000-000000000001','Shared registry','registry-read-shared'),
  ('f2000000-0000-4000-8000-000000000002','Foreign registry','registry-read-foreign');
insert into public.workspace_members(workspace_id,user_id,role) select
  ('f2000000-0000-4000-8000-' || case when n=4 then '000000000002' else '000000000001' end)::uuid,
  user_id, (case when n in (1,4,5) then 'owner' when n=2 then 'editor' else 'viewer' end)::public.workspace_role
from registry_authors;
insert into public.projects(id,workspace_id,name,slug,created_by) values
  ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Shared book','shared','f1000000-0000-4000-8000-000000000001'),
  ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000002','Foreign book','foreign','f1000000-0000-4000-8000-000000000004');
insert into public.project_activity(project_id,actor_user_id,event_type) values
  ('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','registry_read_fixture'),
  ('f3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000004','registry_read_fixture');
insert into public.workspace_user_state(workspace_id,user_id,active_project_id)
select 'f2000000-0000-4000-8000-000000000001',user_id,'f3000000-0000-4000-8000-000000000001'
from registry_authors where n in (1,2,3);
grant select on registry_authors to authenticated,anon;
grant select on public.workspaces,public.workspace_members,public.projects,public.project_activity,public.workspace_user_state to authenticated,anon;
grant insert,update,delete on public.workspace_user_state to authenticated,anon;
create function pg_temp.author(p_number integer)
returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'device_id',device_id)::text,true)
  from registry_authors where n=p_number
$$;
create function pg_temp.assert_shared_read(p_role text)
returns void language plpgsql as $$ begin
  perform pg_temp.assert_true((select count(*)=1 from public.workspaces),p_role || ' reads only its workspace');
  perform pg_temp.assert_true((select count(*)=4 from public.workspace_members),p_role || ' reads shared membership without recursion');
  perform pg_temp.assert_true((select count(*)=1 from public.projects),p_role || ' reads only its book');
  perform pg_temp.assert_true((select count(*)=1 from public.project_activity),p_role || ' reads only its activity');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_user_state),p_role || ' reads only its own state');
end $$;
create function pg_temp.assert_no_read(p_reason text)
returns void language plpgsql as $$ begin
  perform pg_temp.assert_true((select count(*)=0 from public.workspaces),p_reason || ' hides workspaces');
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_members),p_reason || ' hides memberships');
  perform pg_temp.assert_true((select count(*)=0 from public.projects),p_reason || ' hides books');
  perform pg_temp.assert_true((select count(*)=0 from public.project_activity),p_reason || ' hides activity');
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_user_state),p_reason || ' hides own state');
end $$;

-- Read checks start here.
set local role authenticated;
select pg_temp.author(1);
select pg_temp.assert_shared_read('owner');
select pg_temp.assert_true(public.registry_has_workspace_membership('f2000000-0000-4000-8000-000000000001'),'own live membership predicate');
select pg_temp.assert_true(not public.registry_has_workspace_membership('f2000000-0000-4000-8000-000000000002'),'foreign workspace predicate reveals no other-author membership');
select pg_temp.assert_error($q$select public.registry_has_workspace_membership('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002')$q$,'42883','no arbitrary-user predicate signature');
select pg_temp.author(2);
select pg_temp.assert_shared_read('editor');
select pg_temp.author(3);
select pg_temp.assert_shared_read('viewer');
update public.workspace_user_state set recent_project_ids=array['f3000000-0000-4000-8000-000000000001'::uuid] where user_id=auth.uid();
select pg_temp.assert_true((select recent_project_ids=array['f3000000-0000-4000-8000-000000000001'::uuid] from public.workspace_user_state),'viewer can modify own state');
with changed as (update public.workspace_user_state set recent_project_ids='{}' where user_id='f1000000-0000-4000-8000-000000000001' returning *)
select pg_temp.assert_true(count(*)=0,'viewer cannot modify another author state') from changed;
select pg_temp.assert_error($q$insert into public.workspace_user_state(workspace_id,user_id) values('f2000000-0000-4000-8000-000000000002',auth.uid())$q$,'42501','own user is insufficient to create foreign workspace state');
delete from public.workspace_user_state where user_id=auth.uid();
insert into public.workspace_user_state(workspace_id,user_id,active_project_id) values('f2000000-0000-4000-8000-000000000001',auth.uid(),'f3000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.workspace_user_state),'viewer can delete and recreate own state');
select pg_temp.assert_error($q$update public.workspace_user_state set user_id='f1000000-0000-4000-8000-000000000005' where user_id=auth.uid()$q$,'42501','state identity cannot be reassigned');
select pg_temp.assert_error($q$insert into public.workspace_members(workspace_id,user_id,role) values('f2000000-0000-4000-8000-000000000002',auth.uid(),'owner')$q$,'42501','read repair grants no membership writes');
select pg_temp.assert_error($q$select public.project_rename('f3000000-0000-4000-8000-000000000001','Forbidden viewer rename')$q$,'P0001','viewer read access never promotes write authority');
select pg_temp.assert_true((select role='viewer' from public.workspace_members where user_id=auth.uid()),'read repair preserves viewer role');

reset role;
delete from auth.sessions where user_id='f1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.author(2);
select pg_temp.assert_no_read('ended Auth session');
with changed as (update public.workspace_user_state set recent_project_ids='{}' returning *)
select pg_temp.assert_true(count(*)=0,'ended session cannot update own state') from changed;
with changed as (delete from public.workspace_user_state returning *)
select pg_temp.assert_true(count(*)=0,'ended session cannot delete own state') from changed;
select pg_temp.assert_error($q$insert into public.workspace_user_state(workspace_id,user_id) values('f2000000-0000-4000-8000-000000000001',auth.uid()) on conflict(workspace_id,user_id) do update set updated_at=now()$q$,'42501','ended session cannot insert or upsert own state');

select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","session_id":"f9000000-0000-4000-8000-000000000004"}',true);
select pg_temp.assert_no_read('another author Auth session');
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","session_id":"malformed"}',true);
select pg_temp.assert_no_read('malformed Auth session');
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id='f1000000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.author(5);
select pg_temp.assert_no_read('expired Auth session');
reset role;
update auth.sessions set not_after=null where user_id='f1000000-0000-4000-8000-000000000005';

-- The real reviewed account RPC freezes reads even though Auth is retained for
-- progress readback and a remaining shared owner still keeps the workspace.
set local role authenticated;
select pg_temp.author(1);
select public.mobile_register_device('f4000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','desktop','Registry authority device','x25519-v1',digest('registry-authority-key','sha256'));
select public.mobile_begin_account_deletion('f4000000-0000-4000-8000-000000000001',
  public.mobile_account_deletion_preflight('f4000000-0000-4000-8000-000000000001')->>'inventory_sha256',
  '{"workspaces":[{"workspace_id":"f2000000-0000-4000-8000-000000000001","action":"leave"}],"projects":[{"project_id":"f3000000-0000-4000-8000-000000000001","action":"retain","outbox":"preserve"}]}',true);
select pg_temp.assert_no_read('frozen account with live Auth session');
select pg_temp.assert_true(public.mobile_get_account_deletion() is not null,'owned deletion progress remains readable after registry access freezes');
with changed as (update public.workspace_user_state set recent_project_ids='{}' returning *)
select pg_temp.assert_true(count(*)=0,'frozen account cannot update own state') from changed;
with changed as (delete from public.workspace_user_state returning *)
select pg_temp.assert_true(count(*)=0,'frozen account cannot delete own state') from changed;
select pg_temp.assert_error($q$insert into public.workspace_user_state(workspace_id,user_id) values('f2000000-0000-4000-8000-000000000001',auth.uid()) on conflict(workspace_id,user_id) do update set updated_at=now()$q$,'42501','frozen account cannot upsert own state');
select pg_temp.author(3);
select pg_temp.assert_shared_read('remaining viewer after another account freezes');
reset role;
delete from public.workspace_members where user_id='f1000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.author(3);
select pg_temp.assert_no_read('removed workspace membership');
select pg_temp.assert_error($q$insert into public.workspace_user_state(workspace_id,user_id) values('f2000000-0000-4000-8000-000000000001',auth.uid()) on conflict(workspace_id,user_id) do update set updated_at=now()$q$,'42501','removed membership cannot upsert old own state');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.workspace_members where user_id='f1000000-0000-4000-8000-000000000003'),'removed membership stays removed');
select pg_temp.assert_true((select role='editor' from public.workspace_members where user_id='f1000000-0000-4000-8000-000000000002'),'read repair preserves editor role');
select pg_temp.assert_true((select role='owner' from public.workspace_members where user_id='f1000000-0000-4000-8000-000000000001'),'read repair preserves owner role');
select pg_temp.assert_true(not has_function_privilege('anon','public.registry_has_workspace_membership(uuid)','EXECUTE'),'anonymous role cannot execute predicate');
select pg_temp.assert_true(not has_function_privilege('service_role','public.registry_has_workspace_membership(uuid)','EXECUTE'),'service role receives no predicate grant');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select pg_temp.assert_no_read('anonymous role');
select pg_temp.assert_error($q$select public.registry_has_workspace_membership('f2000000-0000-4000-8000-000000000001')$q$,'42501','anonymous cannot call private membership predicate');
select pg_temp.author(5);
select pg_temp.assert_no_read('anonymous role with live-author claims');
select jsonb_build_object('assertions',count(*),'controls',jsonb_agg(message)) from registry_controls;
rollback;
