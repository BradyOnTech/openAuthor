-- AppV2 project/workspace registry + RBAC
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_role') then
    create type public.workspace_role as enum ('owner', 'editor', 'viewer');
  end if;
  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type public.project_status as enum ('active', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'project_kind') then
    create type public.project_kind as enum ('book');
  end if;
end $$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  kind public.project_kind not null default 'book',
  status public.project_status not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists public.project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_user_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active_project_id uuid references public.projects(id) on delete set null,
  recent_project_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists idx_projects_workspace on public.projects(workspace_id);
create index if not exists idx_project_activity_project on public.project_activity(project_id, created_at desc);

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(trim(regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'untitled')
$$;

create or replace function public.workspace_role_for_user(p_workspace_id uuid, p_user_id uuid)
returns public.workspace_role
language sql
stable
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_activity enable row level security;
alter table public.workspace_user_state enable row level security;

drop policy if exists workspaces_member_select on public.workspaces;
create policy workspaces_member_select on public.workspaces
for select using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id and wm.user_id = auth.uid()
  )
);

drop policy if exists workspace_members_member_select on public.workspace_members;
create policy workspace_members_member_select on public.workspace_members
for select using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_members.workspace_id and wm.user_id = auth.uid()
  )
);

drop policy if exists projects_member_select on public.projects;
create policy projects_member_select on public.projects
for select using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = projects.workspace_id and wm.user_id = auth.uid()
  )
);

drop policy if exists project_activity_member_select on public.project_activity;
create policy project_activity_member_select on public.project_activity
for select using (
  exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = project_activity.project_id and wm.user_id = auth.uid()
  )
);

drop policy if exists workspace_user_state_owner_select on public.workspace_user_state;
create policy workspace_user_state_owner_select on public.workspace_user_state
for select using (workspace_user_state.user_id = auth.uid());

drop policy if exists workspace_user_state_owner_modify on public.workspace_user_state;
create policy workspace_user_state_owner_modify on public.workspace_user_state
for all using (workspace_user_state.user_id = auth.uid())
with check (workspace_user_state.user_id = auth.uid());

create or replace function public.assert_workspace_role(
  p_workspace_id uuid,
  p_min_role public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role public.workspace_role;
begin
  member_role := public.workspace_role_for_user(p_workspace_id, auth.uid());
  if member_role is null then
    raise exception 'User is not a workspace member';
  end if;
  if p_min_role = 'viewer' then
    return;
  end if;
  if p_min_role = 'editor' and member_role in ('editor', 'owner') then
    return;
  end if;
  if p_min_role = 'owner' and member_role = 'owner' then
    return;
  end if;
  raise exception 'Insufficient workspace role';
end;
$$;

create or replace function public.project_create(
  p_workspace_id uuid,
  p_project_id uuid default null,
  p_name text default 'Untitled Project',
  p_kind public.project_kind default 'book',
  p_settings jsonb default '{}'::jsonb
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.projects;
begin
  perform public.assert_workspace_role(p_workspace_id, 'editor');

  insert into public.projects (
    id,
    workspace_id,
    name,
    slug,
    kind,
    status,
    settings,
    created_by
  )
  values (
    coalesce(p_project_id, gen_random_uuid()),
    p_workspace_id,
    coalesce(nullif(trim(p_name), ''), 'Untitled Project'),
    public.slugify(coalesce(p_name, 'untitled-project')),
    p_kind,
    'active',
    coalesce(p_settings, '{}'::jsonb),
    auth.uid()
  )
  returning * into inserted;

  insert into public.project_activity (project_id, actor_user_id, event_type, payload)
  values (inserted.id, auth.uid(), 'project_created', jsonb_build_object('workspace_id', inserted.workspace_id));

  return inserted;
end;
$$;

create or replace function public.project_open(
  p_workspace_id uuid,
  p_project_id uuid
)
returns public.workspace_user_state
language plpgsql
security definer
set search_path = public
as $$
declare
  state_row public.workspace_user_state;
begin
  perform public.assert_workspace_role(p_workspace_id, 'viewer');
  if not exists (
    select 1 from public.projects p where p.id = p_project_id and p.workspace_id = p_workspace_id
  ) then
    raise exception 'Project not found in workspace';
  end if;

  insert into public.workspace_user_state (
    workspace_id,
    user_id,
    active_project_id,
    recent_project_ids,
    updated_at
  )
  values (
    p_workspace_id,
    auth.uid(),
    p_project_id,
    array[p_project_id],
    now()
  )
  on conflict (workspace_id, user_id)
  do update set
    active_project_id = excluded.active_project_id,
    recent_project_ids = (
      array[p_project_id] ||
      array(
        select distinct project_id
        from unnest(coalesce(workspace_user_state.recent_project_ids, '{}')) as project_id
        where project_id <> p_project_id
        limit 19
      )
    ),
    updated_at = now()
  returning * into state_row;

  return state_row;
end;
$$;

create or replace function public.project_rename(
  p_project_id uuid,
  p_name text
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.projects;
begin
  perform public.assert_workspace_role((select workspace_id from public.projects where id = p_project_id), 'editor');
  update public.projects
  set
    name = coalesce(nullif(trim(p_name), ''), name),
    slug = public.slugify(coalesce(p_name, name)),
    updated_at = now()
  where id = p_project_id
  returning * into updated_row;

  insert into public.project_activity (project_id, actor_user_id, event_type, payload)
  values (updated_row.id, auth.uid(), 'project_renamed', jsonb_build_object('name', updated_row.name));

  return updated_row;
end;
$$;

create or replace function public.project_archive(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.projects;
begin
  perform public.assert_workspace_role((select workspace_id from public.projects where id = p_project_id), 'editor');
  update public.projects
  set status = 'archived', updated_at = now()
  where id = p_project_id
  returning * into updated_row;
  insert into public.project_activity (project_id, actor_user_id, event_type)
  values (updated_row.id, auth.uid(), 'project_archived');
  return updated_row;
end;
$$;

create or replace function public.project_restore(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.projects;
begin
  perform public.assert_workspace_role((select workspace_id from public.projects where id = p_project_id), 'editor');
  update public.projects
  set status = 'active', updated_at = now()
  where id = p_project_id
  returning * into updated_row;
  insert into public.project_activity (project_id, actor_user_id, event_type)
  values (updated_row.id, auth.uid(), 'project_restored');
  return updated_row;
end;
$$;

create or replace function public.project_move(
  p_project_id uuid,
  p_workspace_id uuid
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.projects;
begin
  perform public.assert_workspace_role((select workspace_id from public.projects where id = p_project_id), 'editor');
  perform public.assert_workspace_role(p_workspace_id, 'editor');
  update public.projects
  set workspace_id = p_workspace_id, updated_at = now()
  where id = p_project_id
  returning * into updated_row;
  insert into public.project_activity (project_id, actor_user_id, event_type, payload)
  values (updated_row.id, auth.uid(), 'project_moved', jsonb_build_object('workspace_id', p_workspace_id));
  return updated_row;
end;
$$;

create or replace function public.project_copy(
  p_project_id uuid,
  p_workspace_id uuid default null
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.projects;
  inserted public.projects;
  target_workspace uuid;
begin
  select * into source_row from public.projects where id = p_project_id;
  if source_row.id is null then
    raise exception 'Project not found';
  end if;
  target_workspace := coalesce(p_workspace_id, source_row.workspace_id);
  perform public.assert_workspace_role(source_row.workspace_id, 'editor');
  perform public.assert_workspace_role(target_workspace, 'editor');

  insert into public.projects (
    workspace_id,
    name,
    slug,
    kind,
    status,
    settings,
    created_by
  )
  values (
    target_workspace,
    source_row.name || ' Copy',
    public.slugify(source_row.slug || '-copy-' || substring(gen_random_uuid()::text, 1, 8)),
    source_row.kind,
    'active',
    source_row.settings,
    auth.uid()
  )
  returning * into inserted;

  insert into public.project_activity (project_id, actor_user_id, event_type, payload)
  values (
    inserted.id,
    auth.uid(),
    'project_copied',
    jsonb_build_object('source_project_id', source_row.id, 'workspace_id', target_workspace)
  );

  return inserted;
end;
$$;

create or replace function public.workspace_member_set_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns public.workspace_members
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data public.workspace_members;
begin
  perform public.assert_workspace_role(p_workspace_id, 'owner');
  insert into public.workspace_members (workspace_id, user_id, role, updated_at)
  values (p_workspace_id, p_user_id, p_role, now())
  on conflict (workspace_id, user_id)
  do update set role = excluded.role, updated_at = now()
  returning * into row_data;
  return row_data;
end;
$$;

grant execute on function public.project_create(uuid, uuid, text, public.project_kind, jsonb) to authenticated;
grant execute on function public.project_open(uuid, uuid) to authenticated;
grant execute on function public.project_rename(uuid, text) to authenticated;
grant execute on function public.project_archive(uuid) to authenticated;
grant execute on function public.project_restore(uuid) to authenticated;
grant execute on function public.project_move(uuid, uuid) to authenticated;
grant execute on function public.project_copy(uuid, uuid) to authenticated;
grant execute on function public.workspace_member_set_role(uuid, uuid, public.workspace_role) to authenticated;
