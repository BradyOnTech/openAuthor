-- Reviewed account intent composes the attested project lifecycle. Shared
-- ciphertext keeps its original historical identifiers; credentials do not.
begin;

create table public.mobile_account_deletion_jobs (
  job_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  requested_device_id uuid,
  inventory jsonb not null,
  inventory_sha256 text not null check (inventory_sha256 ~ '^[0-9a-f]{64}$'),
  dispositions jsonb not null,
  retained_history_acknowledged boolean not null,
  phase text not null default 'deleting' check (phase in ('deleting','auth_ready','finalized')),
  requested_at timestamptz not null default clock_timestamp(),
  cleanup_verification_sha256 text check (cleanup_verification_sha256 ~ '^[0-9a-f]{64}$'),
  finalized_at timestamptz,
  check ((phase = 'finalized') = (finalized_at is not null)),
  check (phase = 'deleting' or cleanup_verification_sha256 is not null)
);
create table public.mobile_account_deletion_workspaces (
  job_id uuid not null references public.mobile_account_deletion_jobs(job_id),
  workspace_id uuid not null,
  action text not null check (action in ('delete','leave')),
  primary key (job_id,workspace_id)
);
create table public.mobile_account_deletion_projects (
  job_id uuid not null references public.mobile_account_deletion_jobs(job_id),
  project_id uuid not null,
  workspace_id uuid,
  name text,
  action text not null check (action in ('delete','retain')),
  outbox text not null check (outbox in ('preserve','remove')),
  project_job_id uuid references public.mobile_project_deletion_jobs(job_id),
  needs_rotation boolean not null,
  previous_key_version integer not null,
  primary key (job_id,project_id),
  check ((action = 'delete') = (project_job_id is not null))
);
alter table public.mobile_account_deletion_jobs enable row level security;
alter table public.mobile_account_deletion_workspaces enable row level security;
alter table public.mobile_account_deletion_projects enable row level security;
revoke all on public.mobile_account_deletion_jobs, public.mobile_account_deletion_workspaces,
  public.mobile_account_deletion_projects from public,anon,authenticated,service_role;

create function public.mobile_account_is_frozen(p_user_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog,public
as $$ select exists(select 1 from public.mobile_account_deletion_jobs where user_id = p_user_id) $$;

create function public.mobile_lock_open_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog,public
as $$ begin
  if p_user_id is null then raise exception using errcode='42501',message='Active account required'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-account:' || p_user_id::text,0));
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='25000',message='Account writes require READ COMMITTED';
  end if;
  if not exists(select 1 from auth.users where id=p_user_id) or public.mobile_account_is_frozen(p_user_id) then
    raise exception using errcode='42501',message='Account is closed';
  end if;
end $$;

-- Row triggers may run after tuple/project locks. They never wait for an
-- account fence in reverse order; the caller must retry a fresh transaction.
create function public.mobile_try_lock_open_account(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  if p_user_id is null then raise exception using errcode='42501',message='Active account required'; end if;
  if not pg_try_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-account:'||p_user_id::text,0)) then
    raise exception using errcode='40001',message='Account lifecycle changed; retry a fresh transaction';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25000',message='Account writes require READ COMMITTED'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) or public.mobile_account_is_frozen(p_user_id) then
    raise exception using errcode='42501',message='Account is closed';
  end if;
end $$;
revoke execute on function public.mobile_try_lock_open_account(uuid) from public,anon,authenticated,service_role;

-- Progress remains available to a live Auth session after device revocation.
alter function public.mobile_has_live_auth_session() rename to mobile_has_live_auth_session_open;
revoke execute on function public.mobile_has_live_auth_session_open() from public,anon,authenticated,service_role;
create function public.mobile_has_live_auth_session()
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $$ select public.mobile_has_live_auth_session_open() and not public.mobile_account_is_frozen(auth.uid()) $$;

alter function public.mobile_assert_active_device(uuid) rename to mobile_assert_active_device_account_open;
revoke execute on function public.mobile_assert_active_device_account_open(uuid) from public,anon,authenticated,service_role;
create function public.mobile_assert_active_device(p_device_id uuid)
returns public.mobile_devices language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform public.mobile_lock_open_account(auth.uid());
  return public.mobile_assert_active_device_account_open(p_device_id);
end $$;

alter function public.mobile_assert_project_device(uuid,uuid,public.workspace_role) rename to mobile_assert_project_device_account_open;
revoke execute on function public.mobile_assert_project_device_account_open(uuid,uuid,public.workspace_role) from public,anon,authenticated,service_role;
create function public.mobile_assert_project_device(p_device_id uuid,p_project_id uuid,p_min_role public.workspace_role)
returns public.workspace_role language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform public.mobile_lock_open_account(auth.uid());
  return public.mobile_assert_project_device_account_open(p_device_id,p_project_id,p_min_role);
end $$;

alter function public.mobile_enroll_project_device(uuid,uuid,uuid) rename to mobile_enroll_project_device_account_open;
revoke execute on function public.mobile_enroll_project_device_account_open(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.mobile_enroll_project_device(p_requesting_device_id uuid,p_project_id uuid,p_target_device_id uuid)
returns public.mobile_project_devices language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform public.mobile_lock_open_account(auth.uid());
  return public.mobile_enroll_project_device_account_open(p_requesting_device_id,p_project_id,p_target_device_id);
end $$;

alter function public.mobile_begin_project_deletion(uuid,uuid) rename to mobile_begin_project_deletion_account_open;
revoke execute on function public.mobile_begin_project_deletion_account_open(uuid,uuid) from public,anon,authenticated,service_role;
create function public.mobile_begin_project_deletion(p_requesting_device_id uuid,p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform public.mobile_lock_open_account(auth.uid());
  return public.mobile_begin_project_deletion_account_open(p_requesting_device_id,p_project_id);
end $$;

alter function public.mobile_register_device(uuid,uuid,public.mobile_device_platform,text,public.mobile_device_key_algorithm,bytea)
  rename to mobile_register_device_account_open;
revoke execute on function public.mobile_register_device_account_open(uuid,uuid,public.mobile_device_platform,text,public.mobile_device_key_algorithm,bytea) from public,anon,authenticated,service_role;
create function public.mobile_register_device(p_device_id uuid,p_key_id uuid,p_platform public.mobile_device_platform,p_device_label text,p_key_algorithm public.mobile_device_key_algorithm,p_public_key bytea)
returns public.mobile_devices language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform public.mobile_lock_open_account(auth.uid());
  if exists(select 1 from public.mobile_devices where id=p_device_id and user_id is distinct from auth.uid()) then
    raise exception using errcode='42501',message='Device identity belongs to another or closed account';
  end if;
  return public.mobile_register_device_account_open(p_device_id,p_key_id,p_platform,p_device_label,p_key_algorithm,p_public_key);
end $$;

alter function public.assert_workspace_role(uuid,public.workspace_role) rename to assert_workspace_role_account_open;
revoke execute on function public.assert_workspace_role_account_open(uuid,public.workspace_role) from public,anon,authenticated,service_role;
create function public.assert_workspace_role(p_workspace_id uuid,p_min_role public.workspace_role)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform public.mobile_lock_open_account(auth.uid());
  if not public.mobile_has_live_auth_session() then raise exception using errcode='42501',message='Live account required'; end if;
  perform public.assert_workspace_role_account_open(p_workspace_id,p_min_role);
end $$;

-- Account attribution is removable without destroying retained shared records.
alter table public.projects alter column created_by drop not null;
alter table public.projects drop constraint projects_created_by_fkey;
alter table public.projects add constraint projects_created_by_fkey foreign key(created_by) references auth.users(id) on delete set null;
alter table public.project_activity alter column actor_user_id drop not null;
alter table public.project_activity drop constraint project_activity_actor_user_id_fkey;
alter table public.project_activity add constraint project_activity_actor_user_id_fkey foreign key(actor_user_id) references auth.users(id) on delete set null;
alter table public.mobile_devices alter column user_id drop not null;
alter table public.mobile_devices drop constraint mobile_devices_user_id_fkey;
alter table public.mobile_devices add constraint mobile_devices_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;

create function public.mobile_account_inventory(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$
  with owned_devices as (select id from public.mobile_devices where user_id=p_user_id),
  scoped_projects as (
    select distinct p.* from public.projects p where
      exists(select 1 from public.workspace_members wm where wm.workspace_id=p.workspace_id and wm.user_id=p_user_id)
      or p.created_by=p_user_id
      or exists(select 1 from public.project_activity a where a.project_id=p.id and a.actor_user_id=p_user_id)
      or exists(select 1 from public.mobile_project_devices pd where pd.project_id=p.id and (
        pd.device_id in(select id from owned_devices) or pd.enrolled_by_device_id in(select id from owned_devices)
        or pd.revoked_by_device_id in(select id from owned_devices)))
  )
  select jsonb_build_object('user_id',p_user_id,
    'workspaces',coalesce((select jsonb_agg(jsonb_build_object(
      'workspace_id',w.id,'name',w.name,'role',wm.role,'updated_at',w.updated_at,
      'other_members',(select count(*) from public.workspace_members m where m.workspace_id=w.id and m.user_id<>p_user_id),
      'other_owners',(select count(*) from public.workspace_members m where m.workspace_id=w.id and m.user_id<>p_user_id and m.role='owner' and not public.mobile_account_is_frozen(m.user_id)),
      'members',(select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'updated_at',m.updated_at) order by m.user_id) from public.workspace_members m where m.workspace_id=w.id),
      'project_ids',coalesce((select jsonb_agg(p.id order by p.id) from public.projects p where p.workspace_id=w.id),'[]'::jsonb)) order by w.id)
      from public.workspaces w join public.workspace_members wm on wm.workspace_id=w.id and wm.user_id=p_user_id),'[]'::jsonb),
    'projects',coalesce((select jsonb_agg(jsonb_build_object(
      'project_id',p.id,'workspace_id',p.workspace_id,'name',case when exists(select 1 from public.workspace_members m where m.workspace_id=p.workspace_id and m.user_id=p_user_id) then p.name else null end,
      'status',p.status,'updated_at',p.updated_at,'created_by',p.created_by,
      'member_role',(select role from public.workspace_members m where m.workspace_id=p.workspace_id and m.user_id=p_user_id),
      'project_deletion_job',(select jsonb_build_object('job_id',j.job_id,'phase',j.phase) from public.mobile_project_deletion_jobs j where j.project_id=p.id),
      'needs_rotation',exists(select 1 from public.mobile_project_devices pd join public.mobile_devices d on d.id=pd.device_id where pd.project_id=p.id and d.user_id=p_user_id and pd.revoked_at is null and d.revoked_at is null),
      'previous_key_version',coalesce((select max(key_version) from public.mobile_project_key_versions k where k.project_id=p.id),0),
      'active_key_version',(select key_version from public.mobile_project_key_versions k where k.project_id=p.id and k.retired_at is null),
      'own_outbox_ids',coalesce((select jsonb_agg(o.operation_id order by o.operation_id) from public.mobile_outbox_envelopes o where o.project_id=p.id and o.source_device_id in(select id from owned_devices)),'[]'::jsonb),
      'snapshots',coalesce((select jsonb_agg(jsonb_build_object('id',s.snapshot_id,'digest',s.object_sha256,'creator',s.created_by_device_id) order by s.snapshot_id) from public.mobile_snapshot_manifests s where s.project_id=p.id),'[]'::jsonb),
      'enrollments',coalesce((select jsonb_agg(to_jsonb(pd) order by pd.device_id) from public.mobile_project_devices pd where pd.project_id=p.id),'[]'::jsonb),
      'envelopes',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.key_version,'recipient',e.recipient_device_id,'key',e.recipient_key_id,'sender',e.sender_device_id,'digest',e.sealed_project_key_sha256) order by e.id) from public.mobile_project_key_envelopes e where e.project_id=p.id),'[]'::jsonb),
      'objects',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'owner_id',to_jsonb(o)->'owner_id') order by o.name) from storage.objects o where o.bucket_id='mobile-encrypted-sync' and starts_with(o.name,'projects/'||p.id::text||'/')),'[]'::jsonb)
    ) order by p.id) from scoped_projects p),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(jsonb_build_object('device_id',d.id,'platform',d.platform,'device_label',d.device_label,'auth_session_id',d.auth_session_id,'current_key_id',d.current_key_id,'revoked_at',d.revoked_at,
      'key_ids',coalesce((select jsonb_agg(k.id order by k.id) from public.mobile_device_keys k where k.device_id=d.id),'[]'::jsonb)) order by d.id) from public.mobile_devices d where d.user_id=p_user_id),'[]'::jsonb),
    'existing_project_jobs',coalesce((select jsonb_agg(jsonb_build_object('job_id',j.job_id,'project_id',j.project_id,'workspace_id',j.workspace_id,'phase',j.phase) order by j.project_id) from public.mobile_project_deletion_jobs j where j.requested_by=p_user_id),'[]'::jsonb)
  )
$$;

create function public.mobile_account_deletion_preflight(p_requesting_device_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_inventory jsonb; begin
  perform public.mobile_assert_active_device(p_requesting_device_id);
  v_inventory:=public.mobile_account_inventory(auth.uid());
  return jsonb_build_object('schema_version',1,'inventory',v_inventory,'inventory_sha256',encode(digest(v_inventory::text,'sha256'),'hex'));
end $$;

create function public.mobile_account_deletion_result(p_job_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$ select jsonb_build_object('job_id',a.job_id,'phase',a.phase,'requested_at',a.requested_at,'inventory_sha256',a.inventory_sha256,
  'workspaces',coalesce((select jsonb_agg(jsonb_build_object('workspace_id',w.workspace_id,'action',w.action) order by w.workspace_id) from public.mobile_account_deletion_workspaces w where w.job_id=a.job_id),'[]'::jsonb),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('project_id',p.project_id,'name',p.name,'action',p.action,'outbox',p.outbox,'project_job_id',p.project_job_id,
    'phase',case when p.action='delete' then j.phase else 'retained' end,'needs_rotation',p.needs_rotation,'previous_key_version',p.previous_key_version,
    'blockers',to_jsonb(array_remove(array[
      case when p.action='delete' and j.phase<>'finalized' then 'Project deletion and independent backend verification pending' end,
      case when p.action='retain' and p.needs_rotation and not exists(select 1 from public.mobile_project_key_versions k where k.project_id=p.project_id and k.retired_at is null and k.key_version>p.previous_key_version) then 'Remaining author must rotate the shared project key' end,
      case when p.action='retain' and not exists(select 1 from public.workspace_members m where m.workspace_id=p.workspace_id and m.role='owner' and m.user_id<>a.user_id and not public.mobile_account_is_frozen(m.user_id)) then 'Remaining workspace owner required' end
    ]::text[],null))) order by p.project_id) from public.mobile_account_deletion_projects p left join public.mobile_project_deletion_jobs j on j.job_id=p.project_job_id where p.job_id=a.job_id),'[]'::jsonb),
  'blockers',case when a.phase='deleting' then jsonb_build_array('Independent account cleanup verification and guarded Auth finalization pending') else '[]'::jsonb end)
  from public.mobile_account_deletion_jobs a where a.job_id=p_job_id $$;

create function public.mobile_get_account_deletion(p_job_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; begin
  if auth.uid() is null or not public.mobile_has_live_auth_session_open() then raise exception using errcode='42501',message='Live authenticated account required'; end if;
  select * into v_job from public.mobile_account_deletion_jobs where user_id=auth.uid() and (p_job_id is null or job_id=p_job_id);
  if v_job.job_id is null and p_job_id is not null then raise exception using errcode='42501',message='Owned account deletion request required'; end if;
  return public.mobile_account_deletion_result(v_job.job_id);
end $$;

create function public.mobile_begin_account_deletion(p_requesting_device_id uuid,p_expected_inventory_sha256 text,p_dispositions jsonb,p_acknowledge_retained_history boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_user uuid:=auth.uid(); v_inventory jsonb; v_job public.mobile_account_deletion_jobs; v_row jsonb; v_choice jsonb;
  v_workspace uuid; v_project uuid; v_child public.mobile_project_deletion_jobs; v_action text;
begin
  if v_user is null then raise exception using errcode='42501',message='Live owned account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||v_user::text,0));
  if not public.mobile_has_live_auth_session_open() then raise exception using errcode='42501',message='Live owned account required'; end if;
  select * into v_job from public.mobile_account_deletion_jobs where user_id=v_user;
  if v_job.job_id is not null then
    if v_job.inventory_sha256 is distinct from p_expected_inventory_sha256 or v_job.dispositions is distinct from p_dispositions
      or v_job.retained_history_acknowledged is distinct from p_acknowledge_retained_history then
      raise exception using errcode='40001',message='An immutable account deletion request already exists';
    end if;
    return public.mobile_account_deletion_result(v_job.job_id);
  end if;
  perform public.mobile_assert_active_device(p_requesting_device_id);
  -- Hold all relevant workspace fences before project fences. Account, then
  -- sorted workspaces/projects, then enrollments/devices/keys is the write order.
  v_inventory:=public.mobile_account_inventory(v_user);
  for v_workspace in select (value->>'workspace_id')::uuid from jsonb_array_elements(v_inventory->'workspaces') order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-workspace:'||v_workspace::text,0));
    perform 1 from public.workspaces where id=v_workspace for update;
  end loop;
  for v_project in select (value->>'project_id')::uuid from jsonb_array_elements(v_inventory->'projects') order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:'||v_project::text,0));
    perform 1 from public.projects where id=v_project for update;
  end loop;
  perform public.mobile_assert_active_device(p_requesting_device_id);
  v_inventory:=public.mobile_account_inventory(v_user);
  if p_expected_inventory_sha256 is null or p_expected_inventory_sha256 !~ '^[0-9a-f]{64}$'
    or encode(digest(v_inventory::text,'sha256'),'hex')<>p_expected_inventory_sha256 then
    raise exception using errcode='40001',message='Account inventory changed; review a fresh preflight';
  end if;
  if p_acknowledge_retained_history is null or p_dispositions is null or jsonb_typeof(p_dispositions) is distinct from 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_dispositions) key) is distinct from array['projects','workspaces']
    or jsonb_typeof(p_dispositions->'workspaces')<>'array' or jsonb_typeof(p_dispositions->'projects')<>'array'
    or jsonb_array_length(p_dispositions->'workspaces')<>jsonb_array_length(v_inventory->'workspaces')
    or jsonb_array_length(p_dispositions->'projects')<>jsonb_array_length(v_inventory->'projects') then
    raise exception using errcode='22023',message='Exact reviewed workspace and project dispositions required';
  end if;
  for v_row in select value from jsonb_array_elements(v_inventory->'workspaces') loop
    select value into v_choice from jsonb_array_elements(p_dispositions->'workspaces') where value->>'workspace_id'=v_row->>'workspace_id';
    if v_choice is null or (select count(*) from jsonb_array_elements(p_dispositions->'workspaces') where value->>'workspace_id'=v_row->>'workspace_id')<>1
      or (select array_agg(key order by key) from jsonb_object_keys(v_choice) key) is distinct from array['action','workspace_id'] then
      raise exception using errcode='22023',message='Every workspace needs one exact disposition';
    end if;
    v_action:=case when v_row->>'role'='owner' and (v_row->>'other_members')::integer=0 then 'delete' else 'leave' end;
    if v_choice->>'action' is distinct from v_action then raise exception using errcode='22023',message='Shared workspaces are retained; solo owned workspaces need explicit deletion'; end if;
    if v_row->>'role'='owner' and v_action='leave' and (v_row->>'other_owners')::integer=0 then
      raise exception using errcode='55000',message='Review ownership handoff to another owner before account deletion';
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_inventory->'projects') loop
    select value into v_choice from jsonb_array_elements(p_dispositions->'projects') where value->>'project_id'=v_row->>'project_id';
    if v_choice is null or (select count(*) from jsonb_array_elements(p_dispositions->'projects') where value->>'project_id'=v_row->>'project_id')<>1
      or (select array_agg(key order by key) from jsonb_object_keys(v_choice) key) is distinct from array['action','outbox','project_id']
      or coalesce(v_choice->>'outbox','') not in ('preserve','remove') then
      raise exception using errcode='22023',message='Every project needs one exact disposition and outbox decision';
    end if;
    v_action:=case when v_row->'project_deletion_job'<>'null'::jsonb or exists(
      select 1 from jsonb_array_elements(p_dispositions->'workspaces') w where w->>'workspace_id'=v_row->>'workspace_id' and w->>'action'='delete') then 'delete' else 'retain' end;
    if v_choice->>'action' is distinct from v_action then
      raise exception using errcode='22023',message='Project disposition does not match reviewed ownership or prior deletion intent';
    end if;
    if v_action='retain' and not p_acknowledge_retained_history then raise exception using errcode='22023',message='Explicit retained shared history acknowledgment required'; end if;
  end loop;
  insert into public.mobile_account_deletion_jobs(user_id,requested_device_id,inventory,inventory_sha256,dispositions,retained_history_acknowledged)
    values(v_user,p_requesting_device_id,v_inventory,p_expected_inventory_sha256,p_dispositions,p_acknowledge_retained_history) returning * into v_job;
  for v_row in select value from jsonb_array_elements(v_inventory->'projects') loop
    select value into v_choice from jsonb_array_elements(p_dispositions->'projects') where value->>'project_id'=v_row->>'project_id';
    v_child:=null;
    if v_choice->>'action'='delete' then
      select * into v_child from public.mobile_project_deletion_jobs where project_id=(v_row->>'project_id')::uuid;
      if v_child.job_id is null then
        update public.projects set status='archived',updated_at=clock_timestamp() where id=(v_row->>'project_id')::uuid;
        insert into public.mobile_project_deletion_jobs(project_id,workspace_id,requested_by,requested_device_id)
          values((v_row->>'project_id')::uuid,(v_row->>'workspace_id')::uuid,v_user,p_requesting_device_id) returning * into v_child;
      end if;
    end if;
    insert into public.mobile_account_deletion_projects values(v_job.job_id,(v_row->>'project_id')::uuid,(v_row->>'workspace_id')::uuid,v_row->>'name',v_choice->>'action',v_choice->>'outbox',v_child.job_id,(v_row->>'needs_rotation')::boolean,(v_row->>'previous_key_version')::integer);
  end loop;
  -- Every pre-existing account-owned child request is also a durable dependency,
  -- including a project whose metadata was already finalized before preflight.
  for v_row in select value from jsonb_array_elements(v_inventory->'existing_project_jobs') loop
    if not exists(select 1 from public.mobile_account_deletion_projects where job_id=v_job.job_id and project_id=(v_row->>'project_id')::uuid) then
      insert into public.mobile_account_deletion_projects values(v_job.job_id,(v_row->>'project_id')::uuid,(v_row->>'workspace_id')::uuid,null,'delete','remove',(v_row->>'job_id')::uuid,false,0);
    end if;
  end loop;
  insert into public.mobile_account_deletion_workspaces select v_job.job_id,(value->>'workspace_id')::uuid,value->>'action' from jsonb_array_elements(p_dispositions->'workspaces');
  update public.mobile_project_key_versions k set retired_at=clock_timestamp() where k.retired_at is null and exists(
    select 1 from public.mobile_project_devices pd join public.mobile_devices d on d.id=pd.device_id where pd.project_id=k.project_id and d.user_id=v_user and pd.revoked_at is null and d.revoked_at is null);
  update public.mobile_project_devices pd set revoked_at=coalesce(pd.revoked_at,clock_timestamp()),revoked_by_device_id=coalesce(pd.revoked_by_device_id,p_requesting_device_id),revocation_reason_code=coalesce(pd.revocation_reason_code,'account-deletion') where pd.device_id in(select id from public.mobile_devices where user_id=v_user);
  update public.mobile_device_keys set retired_at=coalesce(retired_at,clock_timestamp()),revoked_at=coalesce(revoked_at,clock_timestamp()) where device_id in(select id from public.mobile_devices where user_id=v_user);
  update public.mobile_devices set revoked_at=coalesce(revoked_at,clock_timestamp()),revocation_reason_code=coalesce(revocation_reason_code,'account-deletion') where user_id=v_user;
  return public.mobile_account_deletion_result(v_job.job_id);
end $$;

create function public.mobile_get_account_deletion_worker(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_result jsonb; begin
  v_result:=public.mobile_account_deletion_result(p_job_id);
  if v_result is null then raise exception using errcode='42501',message='Account deletion request not found'; end if;
  return v_result || jsonb_build_object('user_id',(select user_id from public.mobile_account_deletion_jobs where job_id=p_job_id));
end $$;

create function public.mobile_list_account_deletion_work(p_after_job_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception using errcode='22023',message='Bounded account work page required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('job_id',job_id,'phase',phase) order by job_id) from (
    select job_id,phase from public.mobile_account_deletion_jobs where phase<>'finalized' and (p_after_job_id is null or job_id>p_after_job_id) order by job_id limit p_limit
  ) page),'[]'::jsonb);
end $$;

create function public.mobile_prepare_account_auth_finalization(p_job_id uuid,p_expected_inventory_sha256 text,p_cleanup_verification_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; v_project uuid; v_workspace uuid; begin
  select * into v_job from public.mobile_account_deletion_jobs where job_id=p_job_id;
  if v_job.job_id is null then raise exception using errcode='42501',message='Account deletion request not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||v_job.user_id::text,0));
  select * into v_job from public.mobile_account_deletion_jobs where job_id=p_job_id for update;
  if v_job.inventory_sha256 is distinct from p_expected_inventory_sha256 or p_cleanup_verification_sha256 is null or p_cleanup_verification_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='55000',message='Exact reviewed intent and independent account cleanup attestation required';
  end if;
  if v_job.phase<>'deleting' then return public.mobile_account_deletion_result(v_job.job_id); end if;
  for v_workspace in select workspace_id from public.mobile_account_deletion_workspaces where job_id=p_job_id order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-workspace:'||v_workspace::text,0));
    perform 1 from public.workspaces where id=v_workspace for update;
  end loop;
  for v_project in select project_id from public.mobile_account_deletion_projects where job_id=p_job_id order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:'||v_project::text,0));
    perform 1 from public.projects where id=v_project for update;
  end loop;
  if exists(select 1 from public.mobile_account_deletion_projects p left join public.mobile_project_deletion_jobs j on j.job_id=p.project_job_id where p.job_id=p_job_id and p.action='delete' and (j.phase is distinct from 'finalized' or j.backend_verification_sha256 is null)) then
    raise exception using errcode='55000',message='Every project requires independently attested finalization';
  end if;
  if exists(select 1 from public.mobile_account_deletion_projects p where p.job_id=p_job_id and p.action='retain' and (
    not exists(select 1 from public.workspace_members m where m.workspace_id=p.workspace_id and m.role='owner' and m.user_id<>v_job.user_id and not public.mobile_account_is_frozen(m.user_id))
    or (p.needs_rotation and not exists(select 1 from public.mobile_project_key_versions k where k.project_id=p.project_id and k.retired_at is null and k.key_version>p.previous_key_version)))) then
    raise exception using errcode='55000',message='Shared ownership handoff or key rotation remains incomplete';
  end if;
  if exists(select 1 from public.projects p join public.mobile_account_deletion_workspaces w on w.workspace_id=p.workspace_id where w.job_id=p_job_id and w.action='delete')
    or exists(select 1 from public.workspace_members m where m.user_id=v_job.user_id and not exists(select 1 from public.mobile_account_deletion_workspaces w where w.job_id=p_job_id and w.workspace_id=m.workspace_id)) then
    raise exception using errcode='40001',message='Account scope changed after reviewed intent';
  end if;
  delete from public.mobile_outbox_envelopes o where o.source_device_id in(select id from public.mobile_devices where user_id=v_job.user_id) and exists(select 1 from public.mobile_account_deletion_projects p where p.job_id=p_job_id and p.project_id=o.project_id and p.action='retain' and p.outbox='remove');
  delete from public.mobile_snapshot_acknowledgements where device_id in(select id from public.mobile_devices where user_id=v_job.user_id);
  delete from public.mobile_outbox_acknowledgements where device_id in(select id from public.mobile_devices where user_id=v_job.user_id);
  delete from public.mobile_project_key_envelopes where recipient_device_id in(select id from public.mobile_devices where user_id=v_job.user_id);
  update public.mobile_devices set current_key_id=null where user_id=v_job.user_id;
  delete from public.mobile_device_session_bindings where device_id in(select id from public.mobile_devices where user_id=v_job.user_id);
  delete from public.mobile_device_keys where device_id in(select id from public.mobile_devices where user_id=v_job.user_id);
  -- Keep only inactive authorless identifiers required by immutable history.
  update public.mobile_devices set user_id=null,auth_session_id=gen_random_uuid(),device_label='Deleted author',platform='desktop',revoked_at=coalesce(revoked_at,clock_timestamp()),revocation_reason_code='account-deleted' where user_id=v_job.user_id;
  delete from public.workspace_user_state where user_id=v_job.user_id;
  delete from public.workspace_members where user_id=v_job.user_id;
  delete from public.workspaces w where exists(select 1 from public.mobile_account_deletion_workspaces d where d.job_id=p_job_id and d.workspace_id=w.id and d.action='delete');
  update public.mobile_account_deletion_jobs set phase='auth_ready',requested_device_id=null,cleanup_verification_sha256=p_cleanup_verification_sha256 where job_id=p_job_id;
  return public.mobile_account_deletion_result(p_job_id);
end $$;

create function public.mobile_guard_account_auth_lifecycle()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; v_workspace uuid; v_project uuid; begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25000',message='Account lifecycle requires READ COMMITTED'; end if;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-account:'||new.id::text,0));
    if public.mobile_account_is_frozen(new.id) then raise exception using errcode='42501',message='Deleted account identity cannot be reused'; end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||old.id::text,0));
  select * into v_job from public.mobile_account_deletion_jobs where user_id=old.id for update;
  if v_job.phase is distinct from 'auth_ready' or v_job.cleanup_verification_sha256 is null then
    raise exception using errcode='55000',message='Reviewed account lifecycle must complete before Auth deletion';
  end if;
  for v_workspace in select workspace_id from public.mobile_account_deletion_workspaces where job_id=v_job.job_id order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-workspace:'||v_workspace::text,0));
  end loop;
  for v_project in select project_id from public.mobile_account_deletion_projects where job_id=v_job.job_id order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:'||v_project::text,0));
    perform 1 from public.projects where id=v_project for update;
  end loop;
  if exists(select 1 from public.mobile_devices where user_id=old.id) or exists(select 1 from public.workspace_members where user_id=old.id)
    or exists(select 1 from public.mobile_account_deletion_projects p join public.mobile_project_deletion_jobs j on j.job_id=p.project_job_id where p.job_id=v_job.job_id and (j.phase<>'finalized' or j.backend_verification_sha256 is null)) then
    raise exception using errcode='55000',message='Account cleanup prerequisites changed before Auth deletion';
  end if;
  if exists(select 1 from public.mobile_account_deletion_projects p where p.job_id=v_job.job_id and p.action='retain' and (
    not exists(select 1 from public.projects pr join public.workspace_members m on m.workspace_id=pr.workspace_id where pr.id=p.project_id and pr.workspace_id=p.workspace_id and m.role='owner' and not public.mobile_account_is_frozen(m.user_id))
    or (p.needs_rotation and not exists(select 1 from public.mobile_project_key_versions k where k.project_id=p.project_id and k.retired_at is null and k.key_version>p.previous_key_version)))) then
    raise exception using errcode='55000',message='Shared retention prerequisites changed before Auth deletion';
  end if;
  update public.mobile_account_deletion_projects set name=null where job_id=v_job.job_id;
  update public.mobile_account_deletion_jobs set phase='finalized',finalized_at=clock_timestamp(),inventory=jsonb_build_object('reviewed_inventory_sha256',inventory_sha256) where job_id=v_job.job_id;
  return old;
end $$;
create trigger mobile_account_auth_lifecycle before insert or delete on auth.users for each row execute function public.mobile_guard_account_auth_lifecycle();

create function public.mobile_guard_account_registry_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_workspace uuid; v_user uuid; begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25000',message='Registry account writes require READ COMMITTED'; end if;
  if tg_table_name='workspace_members' then
    v_workspace:=new.workspace_id; v_user:=new.user_id;
    perform public.mobile_try_lock_open_account(v_user);
  elsif tg_table_name='projects' then
    v_workspace:=new.workspace_id;
    if tg_op='INSERT' or new.created_by is distinct from old.created_by then
      if new.created_by is not null then perform public.mobile_try_lock_open_account(new.created_by); end if;
    end if;
  else v_workspace:=case when tg_op='DELETE' then old.id else new.id end;
  end if;
  if not pg_try_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-workspace:'||v_workspace::text,0)) then
    raise exception using errcode='40001',message='Workspace lifecycle changed; retry a fresh transaction';
  end if;
  if exists(select 1 from public.mobile_account_deletion_workspaces where workspace_id=v_workspace and action='delete') then
    if tg_table_name='workspaces' and tg_op='DELETE' and not exists(select 1 from public.projects where workspace_id=v_workspace)
      and not exists(select 1 from public.mobile_account_deletion_projects p join public.mobile_account_deletion_workspaces w on w.job_id=p.job_id and w.workspace_id=p.workspace_id where w.workspace_id=v_workspace and p.action='delete' and exists(select 1 from public.mobile_project_deletion_jobs j where j.job_id=p.project_job_id and j.phase<>'finalized')) then return old; end if;
    raise exception using errcode='42501',message='Account deletion workspace namespace is closed';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger mobile_account_workspace_write before insert or update or delete on public.workspaces for each row execute function public.mobile_guard_account_registry_write();
create trigger mobile_account_membership_write before insert or update on public.workspace_members for each row execute function public.mobile_guard_account_registry_write();
create trigger mobile_account_project_write before insert or update on public.projects for each row execute function public.mobile_guard_account_registry_write();

-- Elevated encrypted writes cannot introduce new account contributions or key
-- recipients after intent. Historical revoked identifiers are never enrollable.
create function public.mobile_guard_account_encrypted_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_device uuid; v_user uuid; v_ids uuid[]; begin
  if tg_table_name='mobile_project_devices' then v_ids:=array[new.device_id,new.enrolled_by_device_id];
  elsif tg_table_name='mobile_project_key_versions' then v_ids:=array[new.created_by_device_id];
  elsif tg_table_name='mobile_project_key_envelopes' then v_ids:=array[new.recipient_device_id,new.sender_device_id];
  elsif tg_table_name='mobile_snapshot_manifests' then v_ids:=array[new.created_by_device_id];
  else v_ids:=array[new.source_device_id]; end if;
  for v_user in select distinct d.user_id from public.mobile_devices d where d.id=any(v_ids) order by 1 loop
    perform public.mobile_try_lock_open_account(v_user);
  end loop;
  if exists(select 1 from unnest(v_ids) id where not exists(select 1 from public.mobile_devices d where d.id=id and d.user_id is not null and d.revoked_at is null)) then
    raise exception using errcode='42501',message='Live account device attribution required';
  end if;
  return new;
end $$;
create trigger mobile_account_enrollment_write before insert on public.mobile_project_devices for each row execute function public.mobile_guard_account_encrypted_write();
create trigger mobile_account_key_version_write before insert on public.mobile_project_key_versions for each row execute function public.mobile_guard_account_encrypted_write();
create trigger mobile_account_envelope_write before insert on public.mobile_project_key_envelopes for each row execute function public.mobile_guard_account_encrypted_write();
create trigger mobile_account_snapshot_write before insert on public.mobile_snapshot_manifests for each row execute function public.mobile_guard_account_encrypted_write();
create trigger mobile_account_outbox_write before insert on public.mobile_outbox_envelopes for each row execute function public.mobile_guard_account_encrypted_write();

revoke execute on function public.mobile_account_is_frozen(uuid),public.mobile_lock_open_account(uuid),public.mobile_account_inventory(uuid),public.mobile_account_deletion_result(uuid),public.mobile_guard_account_auth_lifecycle(),public.mobile_guard_account_registry_write(),public.mobile_guard_account_encrypted_write(),public.mobile_prepare_account_auth_finalization(uuid,text,text),public.mobile_get_account_deletion_worker(uuid),public.mobile_list_account_deletion_work(uuid,integer),public.mobile_account_deletion_preflight(uuid),public.mobile_begin_account_deletion(uuid,text,jsonb,boolean),public.mobile_get_account_deletion(uuid),public.mobile_has_live_auth_session(),public.mobile_assert_active_device(uuid),public.mobile_assert_project_device(uuid,uuid,public.workspace_role),public.mobile_enroll_project_device(uuid,uuid,uuid),public.mobile_begin_project_deletion(uuid,uuid),public.mobile_register_device(uuid,uuid,public.mobile_device_platform,text,public.mobile_device_key_algorithm,bytea),public.assert_workspace_role(uuid,public.workspace_role) from public,anon;
revoke execute on function public.mobile_account_is_frozen(uuid),public.mobile_lock_open_account(uuid),public.mobile_account_inventory(uuid),public.mobile_account_deletion_result(uuid),public.mobile_guard_account_auth_lifecycle(),public.mobile_guard_account_registry_write(),public.mobile_guard_account_encrypted_write(),public.mobile_prepare_account_auth_finalization(uuid,text,text),public.mobile_get_account_deletion_worker(uuid) from anon,authenticated,service_role;
revoke execute on function public.mobile_account_deletion_preflight(uuid),public.mobile_begin_account_deletion(uuid,text,jsonb,boolean),public.mobile_get_account_deletion(uuid) from anon,service_role;
revoke execute on function public.mobile_list_account_deletion_work(uuid,integer) from authenticated;
grant execute on function public.mobile_account_deletion_preflight(uuid),public.mobile_begin_account_deletion(uuid,text,jsonb,boolean),public.mobile_get_account_deletion(uuid),public.mobile_enroll_project_device(uuid,uuid,uuid),public.mobile_begin_project_deletion(uuid,uuid),public.mobile_register_device(uuid,uuid,public.mobile_device_platform,text,public.mobile_device_key_algorithm,bytea) to authenticated;
grant execute on function public.mobile_get_account_deletion_worker(uuid),public.mobile_list_account_deletion_work(uuid,integer) to service_role;
grant execute on function public.mobile_prepare_account_auth_finalization(uuid,text,text) to mobile_deletion_verifier;
comment on table public.mobile_account_deletion_jobs is 'Permanent closed account UUID and exact reviewed routing intent. No credentials/ciphertext. Shared historical IDs remain authorless; independent cleanup receipt gates Auth deletion.';
commit;
