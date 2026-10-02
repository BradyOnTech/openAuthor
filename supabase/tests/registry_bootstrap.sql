-- Authenticated bootstrap must never turn another author's slug into membership.
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
insert into auth.users(id) values
  ('d1000000-0000-7000-8000-000000000001'),
  ('d1000000-0000-7000-8000-000000000002'),
  ('d1000000-0000-7000-8000-000000000003');
insert into auth.sessions(id,user_id) values
  ('d9000000-0000-7000-8000-000000000001','d1000000-0000-7000-8000-000000000001'),
  ('d9000000-0000-7000-8000-000000000002','d1000000-0000-7000-8000-000000000002'),
  ('d9000000-0000-7000-8000-000000000003','d1000000-0000-7000-8000-000000000003');
create temporary table bootstrap_results(label text primary key, id uuid, slug text);
grant all on bootstrap_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-7000-8000-000000000001","session_id":"d9000000-0000-7000-8000-000000000001"}',true);
insert into bootstrap_results select 'first',id,slug from public.workspace_bootstrap('First author','shared-request');
select set_config('request.jwt.claims','{"sub":"d1000000-0000-7000-8000-000000000002","session_id":"d9000000-0000-7000-8000-000000000002"}',true);
insert into bootstrap_results select 'second',id,slug from public.workspace_bootstrap('Second author','shared-request');
select pg_temp.assert_true((select count(distinct id)=2 from bootstrap_results),'same requested slug must not grant another author ownership');
select pg_temp.assert_true((public.workspace_bootstrap('Changed input','shared-request')).id=(select id from bootstrap_results where label='second'),'same account bootstrap remains idempotent');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.workspace_members where workspace_id=(select id from bootstrap_results where label='first')),'first author membership is unchanged');
select pg_temp.assert_true((select name='First author' from public.workspaces where id=(select id from bootstrap_results where label='first')),'other author bootstrap cannot rename first workspace');
-- Explicitly requesting a foreign generated slug also creates only a caller-owned workspace.
set local role authenticated;
insert into bootstrap_results select 'foreign-exact',id,slug from public.workspace_bootstrap('Third request',(select slug from bootstrap_results where label='first'));
select pg_temp.assert_true((select id from bootstrap_results where label='foreign-exact')<>(select id from bootstrap_results where label='first'),'exact foreign slug does not bypass isolation');
reset role;
-- Legacy owned workspaces stay reachable; existing editors/viewers are never promoted.
insert into public.workspaces(id,name,slug) values ('d2000000-0000-7000-8000-000000000001','Existing shared','legacy-bootstrap');
insert into public.workspace_members(workspace_id,user_id,role) values
  ('d2000000-0000-7000-8000-000000000001','d1000000-0000-7000-8000-000000000001','owner'),
  ('d2000000-0000-7000-8000-000000000001','d1000000-0000-7000-8000-000000000002','editor'),
  ('d2000000-0000-7000-8000-000000000001','d1000000-0000-7000-8000-000000000003','viewer');
set local role authenticated;
select pg_temp.assert_true((public.workspace_bootstrap('Changed legacy','legacy-bootstrap')).id='d2000000-0000-7000-8000-000000000001','existing editor keeps existing workspace identity');
reset role;
select pg_temp.assert_true((select role='editor' from public.workspace_members where workspace_id='d2000000-0000-7000-8000-000000000001' and user_id='d1000000-0000-7000-8000-000000000002'),'bootstrap must not promote an existing editor');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-7000-8000-000000000003","session_id":"d9000000-0000-7000-8000-000000000003"}',true);
select public.workspace_bootstrap('Viewer repeat','legacy-bootstrap');
reset role;
select pg_temp.assert_true((select role='viewer' from public.workspace_members where workspace_id='d2000000-0000-7000-8000-000000000001' and user_id='d1000000-0000-7000-8000-000000000003'),'bootstrap must not promote an existing viewer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-7000-8000-000000000001","session_id":"d9000000-0000-7000-8000-000000000001"}',true);
select pg_temp.assert_true((public.workspace_bootstrap('Owner repeat','legacy-bootstrap')).id='d2000000-0000-7000-8000-000000000001','legacy owner identity remains idempotent');
select set_config('request.jwt.claims','{"sub":"d1000000-0000-7000-8000-000000000003","session_id":"d9000000-0000-7000-8000-000000000099"}',true);
select pg_temp.assert_error($q$select public.workspace_bootstrap('No session','no-session')$q$,'42501','deleted or nonexistent Auth session cannot create workspace');
reset role;
-- A pre-existing privileged slug collision may never be claimed implicitly.
insert into public.workspaces(id,name,slug) values ('d2000000-0000-7000-8000-000000000002','Admin collision','collision-d1000000-0000-7000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role) values ('d2000000-0000-7000-8000-000000000002','d1000000-0000-7000-8000-000000000001','owner');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-7000-8000-000000000002","session_id":"d9000000-0000-7000-8000-000000000002"}',true);
select pg_temp.assert_error($q$select public.workspace_bootstrap('Do not claim','collision')$q$,'42501','pre-existing scoped collision is refused');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.workspace_members where workspace_id='d2000000-0000-7000-8000-000000000002' and user_id='d1000000-0000-7000-8000-000000000002'),'collision cannot create owner membership');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select pg_temp.assert_error($q$select public.workspace_bootstrap()$q$,'42501','anonymous role has no bootstrap grant');
rollback;
