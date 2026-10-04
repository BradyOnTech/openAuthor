-- Retention scope may change after account review. Append-only resolutions do
-- not approve new destruction or replace the original routing intent.
begin;

alter table public.mobile_account_deletion_jobs
  add column amendment_revision integer not null default 0 check (amendment_revision >= 0),
  add column effective_intent_sha256 text check (effective_intent_sha256 ~ '^[0-9a-f]{64}$'),
  add column cleanup_intent_sha256 text check (cleanup_intent_sha256 ~ '^[0-9a-f]{64}$');
update public.mobile_account_deletion_jobs set cleanup_intent_sha256=inventory_sha256 where phase<>'deleting';

create table public.mobile_account_deletion_amendments (
  job_id uuid not null references public.mobile_account_deletion_jobs(job_id),
  amendment_id uuid not null,
  revision integer not null check (revision > 0),
  base_revision integer not null check (base_revision >= 0),
  review_sha256 text not null check (review_sha256 ~ '^[0-9a-f]{64}$'),
  previous_intent_sha256 text not null check (previous_intent_sha256 ~ '^[0-9a-f]{64}$'),
  intent_sha256 text not null check (intent_sha256 ~ '^[0-9a-f]{64}$'),
  resolutions jsonb not null,
  actor_session_sha256 text not null check (actor_session_sha256 ~ '^[0-9a-f]{64}$'),
  invalidated_cleanup_sha256 text check (invalidated_cleanup_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (job_id,amendment_id),
  unique (job_id,revision),
  check (revision=base_revision+1)
);
create table public.mobile_account_deletion_retention_resolutions (
  job_id uuid not null,
  project_id uuid not null,
  revision integer not null,
  workspace_id uuid,
  resolution text not null check (resolution in ('retained','independently_deleted')),
  project_job_id uuid references public.mobile_project_deletion_jobs(job_id),
  backend_verification_sha256 text check (backend_verification_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (job_id,project_id,revision),
  foreign key (job_id,revision) references public.mobile_account_deletion_amendments(job_id,revision),
  foreign key (job_id,project_id) references public.mobile_account_deletion_projects(job_id,project_id),
  check ((resolution='independently_deleted')=(project_job_id is not null)),
  check ((resolution='independently_deleted')=(backend_verification_sha256 is not null)),
  check (resolution<>'retained' or workspace_id is not null)
);
alter table public.mobile_account_deletion_amendments enable row level security;
alter table public.mobile_account_deletion_retention_resolutions enable row level security;
revoke all on public.mobile_account_deletion_amendments,public.mobile_account_deletion_retention_resolutions
  from public,anon,authenticated,service_role;

create function public.mobile_account_effective_retention(p_job_id uuid)
returns table(project_id uuid,workspace_id uuid,resolution text,project_job_id uuid,backend_verification_sha256 text,needs_rotation boolean,previous_key_version integer)
language sql stable security definer set search_path=pg_catalog,public
as $$ select p.project_id,case when r.revision is null then p.workspace_id else r.workspace_id end,
  coalesce(r.resolution,'retained'),r.project_job_id,r.backend_verification_sha256,p.needs_rotation,p.previous_key_version
  from public.mobile_account_deletion_projects p left join lateral (
    select x.* from public.mobile_account_deletion_retention_resolutions x
    where x.job_id=p.job_id and x.project_id=p.project_id order by x.revision desc limit 1
  ) r on true where p.job_id=p_job_id and p.action='retain' $$;

create function public.mobile_account_retention_satisfied(p_job_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $$ select not exists (
  select 1 from public.mobile_account_effective_retention(p_job_id) r
  join public.mobile_account_deletion_jobs a on a.job_id=p_job_id
  where case when r.resolution='independently_deleted' then not (
    exists(select 1 from public.mobile_project_deletion_jobs j where j.job_id=r.project_job_id and j.project_id=r.project_id
      and j.phase='finalized' and j.backend_verification_sha256=r.backend_verification_sha256)
    and not exists(select 1 from public.projects p where p.id=r.project_id)
    and not exists(select 1 from storage.objects o where o.bucket_id='mobile-encrypted-sync' and starts_with(o.name,'projects/'||r.project_id::text||'/'))
  ) else not (
    exists(select 1 from public.projects p where p.id=r.project_id and p.workspace_id=r.workspace_id)
    and not public.mobile_project_is_frozen(r.project_id)
    and exists(select 1 from public.workspace_members m where m.workspace_id=r.workspace_id and m.role='owner'
      and m.user_id<>a.user_id and not public.mobile_account_is_frozen(m.user_id))
    and (not r.needs_rotation or exists(select 1 from public.mobile_project_key_versions k
      where k.project_id=r.project_id and k.retired_at is null and k.key_version>r.previous_key_version))
  ) end
) $$;

-- Lock original, effective and observed destination workspaces before projects.
-- A project moved during these waits is re-read by the caller's fingerprint or
-- effective-scope predicate; row locks prevent further movement through commit.
create function public.mobile_lock_account_deletion_scope(p_job_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_workspace uuid; v_project uuid; begin
  for v_workspace in
    select workspace_id from public.mobile_account_deletion_workspaces where job_id=p_job_id
    union select workspace_id from public.mobile_account_deletion_projects where job_id=p_job_id
    union select workspace_id from public.mobile_account_effective_retention(p_job_id)
    union select pr.workspace_id from public.projects pr join public.mobile_account_deletion_projects p on p.project_id=pr.id where p.job_id=p_job_id
    order by 1
  loop
    if v_workspace is not null then
      perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-workspace:'||v_workspace::text,0));
      perform 1 from public.workspaces where id=v_workspace for update;
    end if;
  end loop;
  for v_project in select project_id from public.mobile_account_deletion_projects where job_id=p_job_id order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-project:'||v_project::text,0));
    perform 1 from public.projects where id=v_project for update;
  end loop;
end $$;

create function public.mobile_guard_account_membership_delete()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='25000',message='Registry account writes require READ COMMITTED';
  end if;
  if not pg_try_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-workspace:'||old.workspace_id::text,0)) then
    raise exception using errcode='40001',message='Workspace lifecycle changed; retry a fresh transaction';
  end if;
  return old;
end $$;
create trigger mobile_account_membership_delete before delete on public.workspace_members
  for each row execute function public.mobile_guard_account_membership_delete();

create function public.mobile_account_amendment_snapshot(p_job_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$ select jsonb_build_object('job_id',a.job_id,'phase',a.phase,'base_revision',a.amendment_revision,
  'original_inventory_sha256',a.inventory_sha256,'intent_sha256',coalesce(a.effective_intent_sha256,a.inventory_sha256),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('project_id',r.project_id,'effective_workspace_id',r.workspace_id,
    'resolution',r.resolution,'attached_project_job_id',r.project_job_id,'attached_backend_verification_sha256',r.backend_verification_sha256,
    'project',case when pr.id is null then null else jsonb_build_object('workspace_id',pr.workspace_id,'updated_at',pr.updated_at,'status',pr.status) end,
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'updated_at',m.updated_at,'frozen',public.mobile_account_is_frozen(m.user_id)) order by m.user_id)
      from public.workspace_members m where m.workspace_id=pr.workspace_id),'[]'::jsonb),
    'keys',coalesce((select jsonb_agg(jsonb_build_object('version',k.key_version,'retired_at',k.retired_at) order by k.key_version)
      from public.mobile_project_key_versions k where k.project_id=r.project_id),'[]'::jsonb),
    'independent_deletion',(select jsonb_build_object('job_id',j.job_id,'phase',j.phase,'backend_verification_sha256',j.backend_verification_sha256,'finalized_at',j.finalized_at)
      from public.mobile_project_deletion_jobs j where j.project_id=r.project_id),
    'absent_project_storage_metadata',case when pr.id is null then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name)
      from storage.objects o where o.bucket_id='mobile-encrypted-sync' and starts_with(o.name,'projects/'||r.project_id::text||'/')),'[]'::jsonb) else null end) order by r.project_id)
    from public.mobile_account_effective_retention(p_job_id) r left join public.projects pr on pr.id=r.project_id),'[]'::jsonb))
  from public.mobile_account_deletion_jobs a where a.job_id=p_job_id $$;

create function public.mobile_account_amendment_review(p_job_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$ select jsonb_build_object('schema_version',1,'job_id',a.job_id,'phase',a.phase,'base_revision',a.amendment_revision,
  'original_inventory_sha256',a.inventory_sha256,'intent_sha256',coalesce(a.effective_intent_sha256,a.inventory_sha256),
  'review_sha256',encode(digest(public.mobile_account_amendment_snapshot(p_job_id)::text,'sha256'),'hex'),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('project_id',r.project_id,'name',p.name,'reviewed_workspace_id',p.workspace_id,
    'effective_workspace_id',r.workspace_id,'current_workspace_id',pr.workspace_id,'resolution',r.resolution,
    'needs_rotation',r.needs_rotation,'previous_key_version',r.previous_key_version,
    'active_key_version',(select key_version from public.mobile_project_key_versions k where k.project_id=r.project_id and k.retired_at is null),
    'remaining_owner',exists(select 1 from public.workspace_members m where m.workspace_id=pr.workspace_id and m.role='owner' and m.user_id<>a.user_id and not public.mobile_account_is_frozen(m.user_id)),
    'independent_deletion',case when j.job_id is null then null else jsonb_build_object('job_id',j.job_id,'phase',j.phase,'backend_verification_sha256',j.backend_verification_sha256) end,
    'allowed_resolution',case when r.resolution='independently_deleted' then null
      when pr.id is not null and pr.workspace_id is distinct from r.workspace_id and j.job_id is null
        and exists(select 1 from public.workspace_members m where m.workspace_id=pr.workspace_id and m.role='owner' and m.user_id<>a.user_id and not public.mobile_account_is_frozen(m.user_id)) then 'retain_current_scope'
      when pr.id is null and j.phase='finalized' and j.backend_verification_sha256 is not null
        and not exists(select 1 from storage.objects o where o.bucket_id='mobile-encrypted-sync' and starts_with(o.name,'projects/'||r.project_id::text||'/')) then 'attach_finalized_deletion' else null end,
    'blockers',to_jsonb(array_remove(array[
      case when r.resolution='independently_deleted' and (pr.id is not null or j.job_id is distinct from r.project_job_id or j.phase is distinct from 'finalized'
        or j.backend_verification_sha256 is distinct from r.backend_verification_sha256) then 'Attached independent deletion receipt no longer matches' end,
      case when pr.id is null and exists(select 1 from storage.objects o where o.bucket_id='mobile-encrypted-sync' and starts_with(o.name,'projects/'||r.project_id::text||'/')) then 'Storage metadata remains inside the absent project namespace' end,
      case when r.resolution='retained' and pr.id is null and j.phase is distinct from 'finalized' then 'Project is absent without an independently finalized deletion receipt' end,
      case when r.resolution='retained' and j.job_id is not null and j.phase<>'finalized' then 'Independent project deletion and backend verification pending' end,
      case when r.resolution='retained' and pr.id is not null and pr.workspace_id is distinct from r.workspace_id then 'Retained project moved; review its current workspace scope' end,
      case when r.resolution='retained' and pr.id is not null and not exists(select 1 from public.workspace_members m where m.workspace_id=pr.workspace_id and m.role='owner' and m.user_id<>a.user_id and not public.mobile_account_is_frozen(m.user_id)) then 'Remaining workspace owner required' end,
      case when r.resolution='retained' and pr.id is not null and r.needs_rotation and not exists(select 1 from public.mobile_project_key_versions k where k.project_id=r.project_id and k.retired_at is null and k.key_version>r.previous_key_version) then 'Remaining author must rotate the shared project key' end
    ]::text[],null))) order by r.project_id) from public.mobile_account_effective_retention(p_job_id) r
    join public.mobile_account_deletion_projects p on p.job_id=p_job_id and p.project_id=r.project_id
    left join public.projects pr on pr.id=r.project_id left join public.mobile_project_deletion_jobs j on j.project_id=r.project_id),'[]'::jsonb))
  from public.mobile_account_deletion_jobs a where a.job_id=p_job_id $$;

create function public.mobile_assert_owned_account_amendment(p_job_id uuid)
returns public.mobile_account_deletion_jobs language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; v_session uuid; begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25000',message='Account amendments require READ COMMITTED'; end if;
  if auth.uid() is null or not public.mobile_has_live_auth_session_open() then raise exception using errcode='42501',message='Live owned account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||auth.uid()::text,0));
  select * into v_job from public.mobile_account_deletion_jobs where job_id=p_job_id and user_id=auth.uid() for update;
  if v_job.job_id is null or not public.mobile_has_live_auth_session_open() then raise exception using errcode='42501',message='Live owned account deletion request required'; end if;
  v_session:=(auth.jwt()->>'session_id')::uuid;
  perform 1 from auth.sessions where id=v_session and user_id=auth.uid() for share;
  if not found or not public.mobile_has_live_auth_session_open() then raise exception using errcode='42501',message='Live owned account required'; end if;
  return v_job;
end $$;

create function public.mobile_account_deletion_amendment_receipt(p_job_id uuid,p_amendment_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$ select jsonb_build_object('amendment_id',amendment_id,'revision',revision,'review_sha256',review_sha256,'intent_sha256',intent_sha256)
  from public.mobile_account_deletion_amendments where job_id=p_job_id and amendment_id=p_amendment_id $$;

create function public.mobile_get_account_deletion_amendment(p_job_id uuid,p_amendment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform public.mobile_assert_owned_account_amendment(p_job_id);
  return public.mobile_account_deletion_amendment_receipt(p_job_id,p_amendment_id);
end $$;

create function public.mobile_account_deletion_amendment_preflight(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; begin
  v_job:=public.mobile_assert_owned_account_amendment(p_job_id);
  if v_job.phase='finalized' then raise exception using errcode='55000',message='Account deletion is finalized'; end if;
  perform public.mobile_lock_account_deletion_scope(p_job_id);
  if not public.mobile_has_live_auth_session_open() then raise exception using errcode='42501',message='Live owned account required'; end if;
  return public.mobile_account_amendment_review(p_job_id);
end $$;

create function public.mobile_amend_account_deletion(p_job_id uuid,p_amendment_id uuid,p_expected_revision integer,p_expected_review_sha256 text,p_resolutions jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; v_prior public.mobile_account_deletion_amendments; v_review jsonb;
  v_choices jsonb; v_choice jsonb; v_project jsonb; v_intent text; v_previous text; begin
  v_job:=public.mobile_assert_owned_account_amendment(p_job_id);
  if p_amendment_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_review_sha256 is null or p_expected_review_sha256 !~ '^[0-9a-f]{64}$'
    or p_resolutions is null or jsonb_typeof(p_resolutions) is distinct from 'array' or jsonb_array_length(p_resolutions)<1 or jsonb_array_length(p_resolutions)>100
    or exists(select 1 from jsonb_array_elements(p_resolutions) x where jsonb_typeof(x) is distinct from 'object') then
    raise exception using errcode='22023',message='Exact bounded amendment review required';
  end if;
  select jsonb_agg(x order by x->>'project_id') into v_choices from jsonb_array_elements(p_resolutions) x;
  if (select count(distinct x->>'project_id') from jsonb_array_elements(v_choices) x)<>jsonb_array_length(v_choices) then
    raise exception using errcode='22023',message='One resolution per retained project required';
  end if;
  select * into v_prior from public.mobile_account_deletion_amendments where job_id=p_job_id and amendment_id=p_amendment_id;
  if v_prior.amendment_id is not null then
    if v_prior.base_revision is distinct from p_expected_revision or v_prior.review_sha256 is distinct from p_expected_review_sha256 or v_prior.resolutions is distinct from v_choices then
      raise exception using errcode='22023',message='Amendment identity is already bound to another reviewed request';
    end if;
    return public.mobile_account_deletion_amendment_receipt(p_job_id,p_amendment_id);
  end if;
  if v_job.phase='finalized' then raise exception using errcode='55000',message='Account deletion is finalized'; end if;
  perform public.mobile_lock_account_deletion_scope(p_job_id);
  if not public.mobile_has_live_auth_session_open() then raise exception using errcode='42501',message='Live owned account required'; end if;
  v_review:=public.mobile_account_amendment_review(p_job_id);
  if v_job.amendment_revision is distinct from p_expected_revision or v_review->>'review_sha256' is distinct from p_expected_review_sha256 then
    raise exception using errcode='40001',message='Account retention scope changed; review a fresh amendment';
  end if;
  for v_choice in select value from jsonb_array_elements(v_choices) loop
    select value into v_project from jsonb_array_elements(v_review->'projects') where value->>'project_id'=v_choice->>'project_id';
    if v_project is null or v_project->>'allowed_resolution' is null or v_choice->>'resolution' is distinct from v_project->>'allowed_resolution' then
      raise exception using errcode='22023',message='Only a changed retained scope or independently finalized deletion may be resolved';
    end if;
    if v_choice->>'resolution'='retain_current_scope' then
      if (select array_agg(k order by k) from jsonb_object_keys(v_choice) k) is distinct from array['project_id','resolution','workspace_id']::text[]
        or v_choice->>'workspace_id' is distinct from v_project->>'current_workspace_id' then
        raise exception using errcode='22023',message='Exact current retained workspace required';
      end if;
    else
      if (select array_agg(k order by k) from jsonb_object_keys(v_choice) k) is distinct from array['backend_verification_sha256','project_id','project_job_id','resolution']::text[]
        or v_choice->>'project_job_id' is distinct from v_project->'independent_deletion'->>'job_id'
        or v_choice->>'backend_verification_sha256' is distinct from v_project->'independent_deletion'->>'backend_verification_sha256' then
        raise exception using errcode='22023',message='Exact independently finalized project receipt required';
      end if;
    end if;
  end loop;
  v_previous:=coalesce(v_job.effective_intent_sha256,v_job.inventory_sha256);
  v_intent:=encode(digest(jsonb_build_object('original_inventory_sha256',v_job.inventory_sha256,'previous_intent_sha256',v_previous,
    'revision',p_expected_revision+1,'review_sha256',p_expected_review_sha256,'resolutions',v_choices)::text,'sha256'),'hex');
  insert into public.mobile_account_deletion_amendments values(p_job_id,p_amendment_id,p_expected_revision+1,p_expected_revision,
    p_expected_review_sha256,v_previous,v_intent,v_choices,encode(digest(auth.jwt()->>'session_id','sha256'),'hex'),v_job.cleanup_verification_sha256,clock_timestamp());
  for v_choice in select value from jsonb_array_elements(v_choices) loop
    insert into public.mobile_account_deletion_retention_resolutions values(p_job_id,(v_choice->>'project_id')::uuid,p_expected_revision+1,
      case when v_choice->>'resolution'='retain_current_scope' then (v_choice->>'workspace_id')::uuid else null end,
      case when v_choice->>'resolution'='retain_current_scope' then 'retained' else 'independently_deleted' end,
      (v_choice->>'project_job_id')::uuid,v_choice->>'backend_verification_sha256');
  end loop;
  update public.mobile_account_deletion_jobs set amendment_revision=p_expected_revision+1,effective_intent_sha256=v_intent,
    phase='deleting',cleanup_verification_sha256=null,cleanup_intent_sha256=null where job_id=p_job_id;
  return public.mobile_account_deletion_amendment_receipt(p_job_id,p_amendment_id);
end $$;

revoke all on function public.mobile_account_effective_retention(uuid),public.mobile_account_retention_satisfied(uuid),public.mobile_lock_account_deletion_scope(uuid),
  public.mobile_guard_account_membership_delete(),public.mobile_account_amendment_snapshot(uuid),public.mobile_account_amendment_review(uuid),
  public.mobile_assert_owned_account_amendment(uuid),public.mobile_account_deletion_amendment_receipt(uuid,uuid),
  public.mobile_get_account_deletion_amendment(uuid,uuid),public.mobile_account_deletion_amendment_preflight(uuid),
  public.mobile_amend_account_deletion(uuid,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mobile_get_account_deletion_amendment(uuid,uuid),public.mobile_account_deletion_amendment_preflight(uuid),
  public.mobile_amend_account_deletion(uuid,uuid,integer,text,jsonb) to authenticated;

-- The existing worker/verifier interfaces bind inventory_sha256 to the current
-- effective digest; revision zero remains wire-compatible with original intent.
-- Their implementations below keep the independent voice wrapper unchanged.
create or replace function public.mobile_prepare_account_auth_finalization_without_voice_control(p_job_id uuid,p_expected_inventory_sha256 text,p_cleanup_verification_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; begin
  select * into v_job from public.mobile_account_deletion_jobs where job_id=p_job_id;
  if v_job.job_id is null then raise exception using errcode='42501',message='Account deletion request not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||v_job.user_id::text,0));
  select * into v_job from public.mobile_account_deletion_jobs where job_id=p_job_id for update;
  if coalesce(v_job.effective_intent_sha256,v_job.inventory_sha256) is distinct from p_expected_inventory_sha256 or p_cleanup_verification_sha256 is null or p_cleanup_verification_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='55000',message='Exact reviewed intent and independent account cleanup attestation required';
  end if;
  if v_job.phase<>'deleting' then return public.mobile_account_deletion_result(v_job.job_id); end if;
  if exists(select 1 from public.mobile_account_deletion_amendments where job_id=p_job_id and invalidated_cleanup_sha256=p_cleanup_verification_sha256) then
    raise exception using errcode='55000',message='Amended retention scope requires new independent cleanup attestation';
  end if;
  perform public.mobile_lock_account_deletion_scope(p_job_id);
  if exists(select 1 from public.mobile_account_deletion_projects p left join public.mobile_project_deletion_jobs j on j.job_id=p.project_job_id where p.job_id=p_job_id and p.action='delete' and (j.phase is distinct from 'finalized' or j.backend_verification_sha256 is null)) then
    raise exception using errcode='55000',message='Every project requires independently attested finalization';
  end if;
  if not public.mobile_account_retention_satisfied(p_job_id) then
    raise exception using errcode='55000',message='Effective retained scope, shared ownership, rotation or independent deletion receipt remains incomplete';
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
  update public.mobile_account_deletion_jobs set phase='auth_ready',requested_device_id=null,cleanup_verification_sha256=p_cleanup_verification_sha256,cleanup_intent_sha256=p_expected_inventory_sha256 where job_id=p_job_id;
  return public.mobile_account_deletion_result(p_job_id);
end $$;


create or replace function public.mobile_guard_account_auth_lifecycle()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_job public.mobile_account_deletion_jobs; begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25000',message='Account lifecycle requires READ COMMITTED'; end if;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock_shared(hashtextextended('openauthor-mobile-account:'||new.id::text,0));
    if public.mobile_account_is_frozen(new.id) then raise exception using errcode='42501',message='Deleted account identity cannot be reused'; end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||old.id::text,0));
  select * into v_job from public.mobile_account_deletion_jobs where user_id=old.id for update;
  if v_job.phase is distinct from 'auth_ready' or v_job.cleanup_verification_sha256 is null or v_job.cleanup_intent_sha256 is distinct from coalesce(v_job.effective_intent_sha256,v_job.inventory_sha256) then
    raise exception using errcode='55000',message='Reviewed account lifecycle must complete before Auth deletion';
  end if;
  perform public.mobile_lock_account_deletion_scope(v_job.job_id);
  if exists(select 1 from public.mobile_devices where user_id=old.id) or exists(select 1 from public.workspace_members where user_id=old.id)
    or exists(select 1 from public.mobile_account_deletion_projects p join public.mobile_project_deletion_jobs j on j.job_id=p.project_job_id where p.job_id=v_job.job_id and (j.phase<>'finalized' or j.backend_verification_sha256 is null)) then
    raise exception using errcode='55000',message='Account cleanup prerequisites changed before Auth deletion';
  end if;
  if not public.mobile_account_retention_satisfied(v_job.job_id) then
    raise exception using errcode='55000',message='Effective shared retention prerequisites changed before Auth deletion';
  end if;
  update public.mobile_account_deletion_projects set name=null where job_id=v_job.job_id;
  update public.mobile_account_deletion_jobs set phase='finalized',finalized_at=clock_timestamp(),inventory=jsonb_build_object('reviewed_inventory_sha256',inventory_sha256) where job_id=v_job.job_id;
  return old;
end $$;

create or replace function public.mobile_account_deletion_result_without_voice_control(p_job_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$ select jsonb_build_object('job_id',a.job_id,'phase',a.phase,'requested_at',a.requested_at,
  'inventory_sha256',coalesce(a.effective_intent_sha256,a.inventory_sha256),'original_inventory_sha256',a.inventory_sha256,
  'amendment_revision',a.amendment_revision,'amendment_receipt',(
    select public.mobile_account_deletion_amendment_receipt(a.job_id,x.amendment_id)
    from public.mobile_account_deletion_amendments x where x.job_id=a.job_id order by x.revision desc limit 1),
  'workspaces',coalesce((select jsonb_agg(jsonb_build_object('workspace_id',w.workspace_id,'action',w.action) order by w.workspace_id)
    from public.mobile_account_deletion_workspaces w where w.job_id=a.job_id),'[]'::jsonb),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('project_id',p.project_id,'name',p.name,'action',p.action,'outbox',p.outbox,
    'project_job_id',p.project_job_id,'phase',case when p.action='delete' then j.phase else 'retained' end,
    'needs_rotation',p.needs_rotation,'previous_key_version',p.previous_key_version,
    'resolution',case when p.action='retain' then r.resolution else null end,'reviewed_workspace_id',p.workspace_id,
    'effective_workspace_id',case when p.action='retain' then r.workspace_id else p.workspace_id end,
    'independent_deletion',case when r.resolution='independently_deleted' then jsonb_build_object(
      'job_id',r.project_job_id,'phase','finalized','backend_verification_sha256',r.backend_verification_sha256) else null end,
    'blockers',case when p.action='delete' then
      case when j.phase='finalized' and j.backend_verification_sha256 is not null then '[]'::jsonb
        else jsonb_build_array('Project deletion and independent backend verification pending') end
      else coalesce((select value->'blockers' from jsonb_array_elements(public.mobile_account_amendment_review(a.job_id)->'projects')
        where value->>'project_id'=p.project_id::text),'[]'::jsonb) || case
        when r.resolution='retained' and not exists(select 1 from public.projects pr where pr.id=p.project_id and pr.workspace_id=r.workspace_id)
          then jsonb_build_array('Current retained scope requires an explicitly reviewed amendment')
        when r.resolution='independently_deleted' and not exists(select 1 from public.mobile_project_deletion_jobs dj
          where dj.job_id=r.project_job_id and dj.project_id=r.project_id and dj.phase='finalized' and dj.backend_verification_sha256=r.backend_verification_sha256)
          then jsonb_build_array('Attached independent deletion receipt no longer matches') else '[]'::jsonb end end) order by p.project_id)
    from public.mobile_account_deletion_projects p
    left join public.mobile_project_deletion_jobs j on j.job_id=p.project_job_id
    left join public.mobile_account_effective_retention(a.job_id) r on r.project_id=p.project_id where p.job_id=a.job_id),'[]'::jsonb),
  'blockers',case when a.phase='deleting' then jsonb_build_array('Independent account cleanup verification and guarded Auth finalization pending') else '[]'::jsonb end)
  from public.mobile_account_deletion_jobs a where a.job_id=p_job_id $$;

comment on table public.mobile_account_deletion_amendments is
  'Append-only reviewed retention resolutions and effective intent chain. Does not approve new destruction; contains no new foreign names, credentials or ciphertext.';
comment on function public.mobile_amend_account_deletion(uuid,uuid,integer,text,jsonb) is
  'Owned live-Auth repair of moved retained scope or exact independently finalized deletion receipt. Invalidates prior cleanup proof; original destructive intent remains immutable.';
commit;
