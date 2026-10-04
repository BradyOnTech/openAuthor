-- Permanent closed namespaces and durable leased cleanup. Storage API removal
-- and independent backing verification precede metadata finalization; SQL never
-- deletes storage.objects. Jobs retain no manuscript, key, token or receipt text.
begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mobile_deletion_verifier') then
    create role mobile_deletion_verifier nologin noinherit;
  end if;
end $$;

create table public.mobile_project_deletion_jobs (
  job_id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique,
  workspace_id uuid references public.workspaces(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_device_id uuid references public.mobile_devices(id) on delete set null,
  phase text not null default 'pending'
    check (phase in ('pending', 'deleting', 'awaiting_backend_verification', 'finalized')),
  lease_token uuid,
  lease_expires_at timestamptz,
  pending_paths text[] not null default '{}',
  requested_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  backend_verification_sha256 text check (backend_verification_sha256 ~ '^[0-9a-f]{64}$'),
  check (cardinality(pending_paths) <= 100),
  check ((lease_token is null) = (lease_expires_at is null)),
  check ((phase = 'finalized') = (finalized_at is not null)),
  check (phase <> 'finalized' or (cardinality(pending_paths) = 0 and backend_verification_sha256 is not null))
);
alter table public.mobile_project_deletion_jobs enable row level security;
revoke all on public.mobile_project_deletion_jobs from public, anon, authenticated, service_role;

create function public.mobile_project_is_frozen(p_project_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$ select exists (select 1 from public.mobile_project_deletion_jobs where project_id = p_project_id) $$;

create function public.mobile_lock_open_project(p_project_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-project:' || p_project_id::text, 0));
  -- Refuse stale-snapshot transactions at this fence: advisory locks alone do
  -- not refresh REPEATABLE READ snapshots to see a newly committed tombstone.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'Encrypted project writes require READ COMMITTED';
  end if;
  -- Project-mutating RPCs take their own FOR UPDATE after this advisory fence.
  -- A blanket FOR SHARE here would make parallel writers deadlock on upgrade.
  perform 1 from public.projects where id = p_project_id;
  if not found or public.mobile_project_is_frozen(p_project_id) then
    raise exception using errcode = '42501', message = 'Project namespace is closed';
  end if;
end;
$$;

create or replace function public.mobile_has_active_project_device(p_project_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.mobile_has_live_auth_session()
    and not public.mobile_project_is_frozen(p_project_id)
    and public.mobile_has_project_role(p_project_id, 'viewer')
    and exists (
      select 1 from public.mobile_project_devices pd
      join public.projects p on p.id = pd.project_id
      join public.mobile_devices d on d.id = pd.device_id
      join public.mobile_device_keys dk on dk.id = d.current_key_id and dk.device_id = d.id
      where pd.project_id = p_project_id and p.status = 'active'
        and d.user_id = auth.uid() and d.id = public.mobile_claimed_device_id()
        and d.auth_session_id::text = auth.jwt() ->> 'session_id'
        and pd.revoked_at is null and d.revoked_at is null
        and dk.retired_at is null and dk.revoked_at is null
    )
$$;

create or replace function public.mobile_assert_project_device(
  p_device_id uuid, p_project_id uuid, p_min_role public.workspace_role
)
returns public.workspace_role language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_role public.workspace_role;
begin
  perform public.mobile_lock_open_project(p_project_id);
  perform public.mobile_assert_active_device(p_device_id);
  select wm.role into v_role from public.projects p
  join public.workspace_members wm on wm.workspace_id = p.workspace_id
  join public.mobile_project_devices pd on pd.project_id = p.id and pd.device_id = p_device_id
  where p.id = p_project_id and p.status = 'active'
    and wm.user_id = auth.uid() and pd.revoked_at is null;
  if v_role is null or p_min_role is null
     or (p_min_role = 'editor' and v_role not in ('editor', 'owner'))
     or (p_min_role = 'owner' and v_role <> 'owner') then
    raise exception using errcode = '42501', message = 'Project device is not authorized';
  end if;
  return v_role;
end;
$$;

-- Initial enrollment deliberately has no existing project-device assertion.
-- Fence it before the original implementation obtains its project row lock.
alter function public.mobile_enroll_project_device(uuid,uuid,uuid) rename to mobile_enroll_project_device_open;
revoke execute on function public.mobile_enroll_project_device_open(uuid,uuid,uuid) from public, anon, authenticated, service_role;
create function public.mobile_enroll_project_device(p_requesting_device_id uuid, p_project_id uuid, p_target_device_id uuid)
returns public.mobile_project_devices language plpgsql security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.mobile_lock_open_project(p_project_id);
  return public.mobile_enroll_project_device_open(p_requesting_device_id,p_project_id,p_target_device_id);
end $$;
revoke execute on function public.mobile_enroll_project_device(uuid,uuid,uuid) from public, anon;
grant execute on function public.mobile_enroll_project_device(uuid,uuid,uuid) to authenticated;

create function public.mobile_guard_encrypted_project_insert()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.mobile_lock_open_project(new.project_id);
  return new;
end $$;
create trigger mobile_project_devices_closed_namespace before insert on public.mobile_project_devices
  for each row execute function public.mobile_guard_encrypted_project_insert();
create trigger mobile_project_keys_closed_namespace before insert on public.mobile_project_key_versions
  for each row execute function public.mobile_guard_encrypted_project_insert();
create trigger mobile_project_envelopes_closed_namespace before insert on public.mobile_project_key_envelopes
  for each row execute function public.mobile_guard_encrypted_project_insert();
create trigger mobile_snapshots_closed_namespace before insert on public.mobile_snapshot_manifests
  for each row execute function public.mobile_guard_encrypted_project_insert();
create trigger mobile_outbox_closed_namespace before insert on public.mobile_outbox_envelopes
  for each row execute function public.mobile_guard_encrypted_project_insert();

create function public.mobile_guard_storage_project_write()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_ids uuid[] := '{}'; v_id uuid; v_name text; v_bucket text; v_index integer;
begin
  -- Fence both source and destination when an elevated metadata update moves
  -- an object. Lexically sorted UUID locks avoid cross-project inversions.
  for v_index in 1..(case when tg_op = 'UPDATE' then 2 else 1 end) loop
    if tg_op = 'UPDATE' and v_index = 1 then
      v_name := old.name; v_bucket := old.bucket_id;
    else
      v_name := new.name; v_bucket := new.bucket_id;
    end if;
    if v_bucket = 'mobile-encrypted-sync' then
      if v_name !~ '^projects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$' then
        raise exception using errcode = '42501', message = 'Encrypted object project namespace required';
      end if;
      v_ids := array_append(v_ids, split_part(v_name, '/', 2)::uuid);
    end if;
  end loop;
  for v_id in select distinct unnest(v_ids) order by 1 loop
    perform public.mobile_lock_open_project(v_id);
    -- Storage metadata has no project foreign key. Keep a direct project
    -- deletion from racing the existence check through this transaction.
    perform 1 from public.projects where id = v_id for share;
    if not found then
      raise exception using errcode = '42501', message = 'Project namespace is closed';
    end if;
  end loop;
  return new;
end;
$$;
create trigger mobile_storage_closed_namespace before insert or update on storage.objects
  for each row execute function public.mobile_guard_storage_project_write();

create function public.mobile_guard_project_lifecycle()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-project:' || new.id::text, 0));
    if current_setting('transaction_isolation') <> 'read committed'
       or public.mobile_project_is_frozen(new.id) then
      raise exception using errcode = '42501', message = 'Deleted project identity cannot be recreated';
    end if;
    return new;
  end if;
  select * into v_job from public.mobile_project_deletion_jobs where project_id = old.id;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or v_job.job_id is not null then
      raise exception using errcode = '42501', message = 'Deleting project cannot be restored, moved or changed';
    end if;
    return new;
  end if;
  if (v_job.job_id is not null and v_job.phase <> 'finalized') or (
    v_job.job_id is null and (
      exists (select 1 from public.mobile_project_devices where project_id = old.id)
      or exists (select 1 from storage.objects where bucket_id = 'mobile-encrypted-sync'
        and starts_with(name, 'projects/' || old.id::text || '/'))
    )
  ) then
    raise exception using errcode = '42501', message = 'Encrypted project requires verified lifecycle finalization';
  end if;
  return old;
end;
$$;
create trigger mobile_project_lifecycle_guard before insert or update or delete on public.projects
  for each row execute function public.mobile_guard_project_lifecycle();

create function public.mobile_deletion_job_result(p_job public.mobile_project_deletion_jobs)
returns jsonb language sql immutable
set search_path = pg_catalog, public
as $$ select jsonb_build_object(
  'job_id', p_job.job_id, 'project_id', p_job.project_id, 'phase', p_job.phase,
  'lease_token', p_job.lease_token, 'lease_expires_at', p_job.lease_expires_at,
  'pending_paths', to_jsonb(p_job.pending_paths)
) $$;

create function public.mobile_begin_project_deletion(p_requesting_device_id uuid, p_project_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs; v_workspace uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:' || p_project_id::text, 0));
  perform public.mobile_assert_active_device(p_requesting_device_id);
  select workspace_id into v_workspace from public.projects where id = p_project_id for update;
  perform public.mobile_assert_active_device(p_requesting_device_id);
  if v_workspace is null or not exists (
    select 1 from public.workspace_members where workspace_id = v_workspace and user_id = auth.uid() and role = 'owner'
  ) or not exists (
    select 1 from public.mobile_project_devices where project_id = p_project_id
      and device_id = p_requesting_device_id and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'Live enrolled project owner required';
  end if;
  select * into v_job from public.mobile_project_deletion_jobs where project_id = p_project_id;
  if v_job.job_id is null then
    -- Version the existing row before publishing the permanent tombstone.
    update public.projects set status = 'archived', updated_at = clock_timestamp() where id = p_project_id;
    insert into public.mobile_project_deletion_jobs(project_id,workspace_id,requested_by,requested_device_id)
      values (p_project_id,v_workspace,auth.uid(),p_requesting_device_id) returning * into v_job;
  elsif v_job.requested_by is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Deletion request belongs to another owner';
  end if;
  return jsonb_build_object('job_id',v_job.job_id,'project_id',v_job.project_id,'phase',v_job.phase);
end;
$$;

create function public.mobile_get_project_deletion(p_requesting_device_id uuid, p_job_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs;
begin
  perform public.mobile_assert_active_device(p_requesting_device_id);
  select * into v_job from public.mobile_project_deletion_jobs where job_id = p_job_id;
  if v_job.job_id is null or v_job.requested_by is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Owned deletion request required';
  end if;
  return jsonb_build_object('job_id',v_job.job_id,'project_id',v_job.project_id,'phase',v_job.phase);
end;
$$;

create function public.mobile_assert_deletion_lease(p_job_id uuid,p_project_id uuid,p_lease_token uuid)
returns public.mobile_project_deletion_jobs language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:' || p_project_id::text, 0));
  select * into v_job from public.mobile_project_deletion_jobs where job_id = p_job_id for update;
  if v_job.project_id is distinct from p_project_id or p_lease_token is null
     or v_job.lease_token is distinct from p_lease_token
     or v_job.lease_expires_at <= clock_timestamp() or v_job.phase = 'finalized' then
    raise exception using errcode = '40001', message = 'Current project deletion lease required';
  end if;
  return v_job;
end;
$$;

create function public.mobile_claim_project_deletion(p_job_id uuid,p_lease_seconds integer default 60)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_project uuid; v_job public.mobile_project_deletion_jobs;
begin
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception using errcode = '22023', message = 'Lease duration must be 15 through 300 seconds';
  end if;
  select project_id into v_project from public.mobile_project_deletion_jobs where job_id = p_job_id;
  if v_project is null then raise exception using errcode = '42501', message = 'Deletion request not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:' || v_project::text, 0));
  select * into v_job from public.mobile_project_deletion_jobs where job_id = p_job_id for update;
  if v_job.phase = 'finalized' or v_job.lease_expires_at > clock_timestamp() then
    raise exception using errcode = '40001', message = 'Deletion request is already leased or finalized';
  end if;
  update public.mobile_project_deletion_jobs set
    phase = case when phase = 'pending' then 'deleting' else phase end,
    lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where job_id = p_job_id returning * into v_job;
  return public.mobile_deletion_job_result(v_job);
end;
$$;

create function public.mobile_renew_project_deletion_lease(
  p_job_id uuid,p_project_id uuid,p_lease_token uuid,p_lease_seconds integer default 60
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs;
begin
  v_job := public.mobile_assert_deletion_lease(p_job_id,p_project_id,p_lease_token);
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception using errcode = '22023', message = 'Lease duration must be 15 through 300 seconds';
  end if;
  update public.mobile_project_deletion_jobs set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where job_id = p_job_id returning * into v_job;
  return public.mobile_deletion_job_result(v_job);
end;
$$;

create function public.mobile_prepare_project_deletion_batch(p_job_id uuid,p_project_id uuid,p_lease_token uuid,p_paths text[])
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs; v_prefix text := 'projects/' || p_project_id::text || '/';
begin
  v_job := public.mobile_assert_deletion_lease(p_job_id,p_project_id,p_lease_token);
  if v_job.phase <> 'deleting' or cardinality(v_job.pending_paths) <> 0 then
    raise exception using errcode = '40001', message = 'Reconcile the prepared batch before another delete';
  end if;
  if p_paths is null or cardinality(p_paths) < 1 or cardinality(p_paths) > 100
     or array_ndims(p_paths) <> 1 or array_lower(p_paths,1) <> 1
     or (select count(*) <> count(distinct path) from unnest(p_paths) path)
     or exists (select 1 from unnest(p_paths) path where path is null
       or not starts_with(path,v_prefix) or length(path) <= length(v_prefix) or length(path) > 1024
       or path ~ '[[:cntrl:]%]' or strpos(path,chr(92)) > 0
       or exists (select 1 from unnest(string_to_array(substring(path from length(v_prefix)+1),'/')) segment
         where segment in ('','.','..') or length(segment) > 255)) then
    raise exception using errcode = '22023', message = 'Bounded exact project object paths required';
  end if;
  update public.mobile_project_deletion_jobs set pending_paths = p_paths where job_id = p_job_id returning * into v_job;
  return public.mobile_deletion_job_result(v_job);
end;
$$;

create function public.mobile_ack_project_deletion_batch(p_job_id uuid,p_project_id uuid,p_lease_token uuid,p_paths text[])
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs;
begin
  v_job := public.mobile_assert_deletion_lease(p_job_id,p_project_id,p_lease_token);
  if v_job.phase <> 'deleting' or cardinality(v_job.pending_paths) = 0 or p_paths is distinct from v_job.pending_paths then
    raise exception using errcode = '40001', message = 'Exact prepared deletion batch required';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'mobile-encrypted-sync' and name = any(p_paths)) then
    raise exception using errcode = '55000', message = 'Prepared object metadata still exists';
  end if;
  update public.mobile_project_deletion_jobs set pending_paths = '{}' where job_id = p_job_id returning * into v_job;
  return public.mobile_deletion_job_result(v_job);
end;
$$;

create function public.mobile_mark_project_deletion_storage_empty(p_job_id uuid,p_project_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs;
begin
  v_job := public.mobile_assert_deletion_lease(p_job_id,p_project_id,p_lease_token);
  if cardinality(v_job.pending_paths) <> 0 or exists (
    select 1 from storage.objects where bucket_id = 'mobile-encrypted-sync'
      and starts_with(name,'projects/' || p_project_id::text || '/')
  ) then raise exception using errcode = '55000', message = 'Project Storage metadata is not empty'; end if;
  update public.mobile_project_deletion_jobs set phase = 'awaiting_backend_verification'
    where job_id = p_job_id returning * into v_job;
  return public.mobile_deletion_job_result(v_job);
end;
$$;

create function public.mobile_finalize_project_deletion(
  p_job_id uuid,p_project_id uuid,p_lease_token uuid,p_backend_verification_sha256 text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_job public.mobile_project_deletion_jobs;
begin
  v_job := public.mobile_assert_deletion_lease(p_job_id,p_project_id,p_lease_token);
  if v_job.phase <> 'awaiting_backend_verification'
     or p_backend_verification_sha256 is null or p_backend_verification_sha256 !~ '^[0-9a-f]{64}$'
     or cardinality(v_job.pending_paths) <> 0 or exists (
       select 1 from storage.objects where bucket_id = 'mobile-encrypted-sync'
         and starts_with(name,'projects/' || p_project_id::text || '/')
     ) then raise exception using errcode = '55000', message = 'Independent backend attestation and empty metadata required'; end if;
  perform 1 from public.projects where id = p_project_id for update;
  update public.mobile_project_deletion_jobs set phase = 'finalized', finalized_at = clock_timestamp(),
    backend_verification_sha256 = p_backend_verification_sha256,
    requested_device_id = null, lease_token = null, lease_expires_at = null
    where job_id = p_job_id returning * into v_job;
  -- Existing encrypted child foreign keys are intentionally restrictive.
  -- Delete them in dependency order only after Storage/backend verification.
  delete from public.mobile_outbox_acknowledgements where project_id = p_project_id;
  delete from public.mobile_snapshot_acknowledgements where project_id = p_project_id;
  delete from public.mobile_outbox_envelopes where project_id = p_project_id;
  delete from public.mobile_snapshot_manifests where project_id = p_project_id;
  delete from public.mobile_project_key_envelopes where project_id = p_project_id;
  delete from public.mobile_project_key_versions where project_id = p_project_id;
  delete from public.mobile_project_devices where project_id = p_project_id;
  update public.workspace_user_state set recent_project_ids = array_remove(recent_project_ids,p_project_id)
    where p_project_id = any(recent_project_ids);
  delete from public.projects where id = p_project_id;
  return public.mobile_deletion_job_result(v_job);
end;
$$;

-- Explicit grants; neither user nor Storage-worker credentials can provide the
-- separate database-operator attestation. The verifier role has no login and
-- must be selected using a separately authorized database-admin connection.
revoke execute on function public.mobile_project_is_frozen(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.mobile_lock_open_project(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.mobile_guard_encrypted_project_insert() from public, anon, authenticated, service_role;
revoke execute on function public.mobile_guard_storage_project_write() from public, anon, authenticated, service_role;
revoke execute on function public.mobile_guard_project_lifecycle() from public, anon, authenticated, service_role;
revoke execute on function public.mobile_deletion_job_result(public.mobile_project_deletion_jobs) from public, anon, authenticated, service_role;
revoke execute on function public.mobile_assert_deletion_lease(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke execute on function public.mobile_begin_project_deletion(uuid,uuid) from public, anon, service_role;
revoke execute on function public.mobile_get_project_deletion(uuid,uuid) from public, anon, service_role;
grant execute on function public.mobile_begin_project_deletion(uuid,uuid) to authenticated;
grant execute on function public.mobile_get_project_deletion(uuid,uuid) to authenticated;

revoke execute on function public.mobile_claim_project_deletion(uuid,integer) from public, anon, authenticated;
revoke execute on function public.mobile_renew_project_deletion_lease(uuid,uuid,uuid,integer) from public, anon, authenticated;
revoke execute on function public.mobile_prepare_project_deletion_batch(uuid,uuid,uuid,text[]) from public, anon, authenticated;
revoke execute on function public.mobile_ack_project_deletion_batch(uuid,uuid,uuid,text[]) from public, anon, authenticated;
revoke execute on function public.mobile_mark_project_deletion_storage_empty(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.mobile_claim_project_deletion(uuid,integer) to service_role;
grant execute on function public.mobile_renew_project_deletion_lease(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.mobile_prepare_project_deletion_batch(uuid,uuid,uuid,text[]) to service_role;
grant execute on function public.mobile_ack_project_deletion_batch(uuid,uuid,uuid,text[]) to service_role;
grant execute on function public.mobile_mark_project_deletion_storage_empty(uuid,uuid,uuid) to service_role;
revoke execute on function public.mobile_finalize_project_deletion(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
grant usage on schema public to mobile_deletion_verifier;
grant execute on function public.mobile_finalize_project_deletion(uuid,uuid,uuid,text) to mobile_deletion_verifier;

comment on table public.mobile_project_deletion_jobs is
  'Permanent project UUID tombstone and leased orphan-inclusive cleanup intent. No cancel/reactivate. Finalization digest records an external operator attestation; SQL cannot verify backing blobs or failed-upload queue drain.';
commit;
