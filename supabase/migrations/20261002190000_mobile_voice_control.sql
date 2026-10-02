-- Content-free known-call control shared by the public gateway and an
-- independently supervised controller. These roles need separately provisioned
-- signed PostgREST credentials; no author bearer or service-role key is stored.
begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mobile_voice_gateway') then
    create role mobile_voice_gateway nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mobile_voice_controller') then
    create role mobile_voice_controller nologin noinherit;
  end if;
  if exists (select 1 from pg_roles where rolname in ('mobile_voice_gateway','mobile_voice_controller')
    and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
    or exists (select 1 from pg_auth_members m join pg_roles r on r.oid=m.member
      where r.rolname in ('mobile_voice_gateway','mobile_voice_controller')) then
    raise exception 'Voice control roles require narrow NOLOGIN NOINHERIT configuration';
  end if;
  if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles member on member.oid=m.member
    where r.rolname in ('mobile_voice_gateway','mobile_voice_controller') and member.rolname<>'authenticator') then
    raise exception 'Voice control roles have untrusted incoming membership';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    if exists(select 1 from pg_roles where rolname='authenticator' and (rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
      raise exception 'Voice control authenticator must be unprivileged NOINHERIT';
    end if;
    if current_setting('server_version_num')::integer>=160000 then
      execute 'grant mobile_voice_gateway, mobile_voice_controller to authenticator with inherit false, set true, admin false';
    else
      grant mobile_voice_gateway, mobile_voice_controller to authenticator;
      revoke admin option for mobile_voice_gateway, mobile_voice_controller from authenticator;
    end if;
  end if;
end $$;
grant usage on schema public to mobile_voice_gateway, mobile_voice_controller;

create table public.mobile_voice_controllers (
  controller_id uuid primary key,
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  last_poll_at timestamptz not null,
  poll_ms integer not null check (poll_ms between 100 and 30000)
);
create table public.mobile_voice_calls (
  lease_id uuid primary key,
  user_id uuid,
  tenant_id text check (length(tenant_id) between 1 and 256),
  project_id uuid,
  device_id uuid,
  session_id uuid,
  identity_redacted boolean not null default false,
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  call_id text check (call_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  phase text not null check (phase in ('allocating','registering','active','closing','closed','unknown')),
  revision bigint not null default 0,
  lease_ms integer not null check (lease_ms between 1000 and 120000),
  hard_expires_at timestamptz not null,
  lease_expires_at timestamptz not null,
  jwt_expires_at timestamptz not null,
  controller_observed boolean not null default false,
  controller_id uuid,
  claim_token uuid,
  claim_expires_at timestamptz,
  next_check_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  unique(binding_sha256, call_id),
  check (lease_expires_at <= hard_expires_at and lease_expires_at <= jwt_expires_at),
  check ((claim_token is null) = (claim_expires_at is null)),
  check ((phase = 'closed') = (closed_at is not null)),
  check (case when identity_redacted then phase='closed' and user_id is null and tenant_id is null and project_id is null and device_id is null and session_id is null
    else user_id is not null and tenant_id is not null and project_id is not null and device_id is not null and session_id is not null end),
  check (phase not in ('registering','active','closed') or call_id is not null)
);
create index mobile_voice_due on public.mobile_voice_calls(binding_sha256,next_check_at)
  where phase not in ('closed','unknown');
alter table public.mobile_voice_calls enable row level security;
alter table public.mobile_voice_controllers enable row level security;
revoke all on public.mobile_voice_calls, public.mobile_voice_controllers
  from public, anon, authenticated, service_role, mobile_voice_gateway, mobile_voice_controller;

create function public.mobile_voice_authorized(p_user_id uuid,p_project_id uuid,p_device_id uuid,p_session_id uuid)
returns boolean language sql volatile security definer set search_path = pg_catalog, public
as $$
  select not public.mobile_account_is_frozen(p_user_id)
    and not public.mobile_project_is_frozen(p_project_id)
    and exists (
      select 1 from public.projects p
      join public.workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=p_user_id
      join public.mobile_project_devices pd on pd.project_id=p.id and pd.device_id=p_device_id
      join public.mobile_devices d on d.id=pd.device_id and d.user_id=p_user_id
      join public.mobile_device_keys k on k.id=d.current_key_id and k.device_id=d.id
      join auth.sessions s on s.id=d.auth_session_id and s.user_id=d.user_id
      where p.id=p_project_id and p.status='active' and wm.role in ('viewer','editor','owner')
        and s.id=p_session_id and (s.not_after is null or s.not_after>clock_timestamp())
        and pd.revoked_at is null and d.revoked_at is null
        and k.retired_at is null and k.revoked_at is null
    )
$$;

create function public.mobile_voice_controller_live(p_binding text,p_lease_ms integer)
returns boolean language sql volatile security definer set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.mobile_voice_controllers c
    where c.binding_sha256=p_binding and c.poll_ms*3<p_lease_ms
      and c.last_poll_at>clock_timestamp()-make_interval(secs=>c.poll_ms*3.0/1000))
    and not exists (select 1 from public.mobile_voice_calls v
      where v.phase in ('closing','unknown') or (v.phase<>'closed' and v.binding_sha256<>p_binding))
$$;

create function public.mobile_voice_json(p_row public.mobile_voice_calls)
returns jsonb language sql immutable security definer set search_path = pg_catalog, public
as $$ select jsonb_build_object(
  'lease_id',p_row.lease_id,'user_id',p_row.user_id,'tenant_id',p_row.tenant_id,
  'project_id',p_row.project_id,'device_id',p_row.device_id,'session_id',p_row.session_id,
  'binding_sha256',p_row.binding_sha256,'call_id',p_row.call_id,'phase',p_row.phase,
  'revision',p_row.revision,'hard_expires_at',p_row.hard_expires_at,
  'lease_expires_at',p_row.lease_expires_at,'jwt_expires_at',p_row.jwt_expires_at,
  'controller_observed',p_row.controller_observed,'controller_id',p_row.controller_id,
  'claim_token',p_row.claim_token,'claim_expires_at',p_row.claim_expires_at,'identity_redacted',p_row.identity_redacted
) $$;

create function public.mobile_voice_begin(
  p_lease_id uuid,p_user_id uuid,p_tenant_id text,p_project_id uuid,p_device_id uuid,p_session_id uuid,
  p_binding text,p_lease_ms integer,p_max_duration_ms integer,p_jwt_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; v_now timestamptz; begin
  if p_lease_id is null or p_user_id is null or p_project_id is null or p_device_id is null or p_session_id is null
    or p_tenant_id is null or length(p_tenant_id) not between 1 and 256
    or p_binding is null or p_binding !~ '^[0-9a-f]{64}$'
    or p_lease_ms is null or p_lease_ms not between 1000 and 120000
    or p_max_duration_ms is null or p_max_duration_ms not between p_lease_ms and 3600000
    or p_jwt_expires_at is null or not isfinite(p_jwt_expires_at) then
    raise exception using errcode='22023',message='Invalid voice control bounds';
  end if;
  perform public.mobile_lock_open_account(p_user_id);
  perform public.mobile_lock_open_project(p_project_id);
  v_now:=clock_timestamp();
  -- One provider credential binding at a time. Rotation cannot bypass an
  -- unresolved old allocation/cleanup by minting a new binding hash.
  perform pg_advisory_xact_lock(hashtextextended('openauthor-voice-control-allocation',0));
  if p_jwt_expires_at<=v_now or not public.mobile_voice_authorized(p_user_id,p_project_id,p_device_id,p_session_id)
    or not public.mobile_voice_controller_live(p_binding,p_lease_ms)
    or (select count(*)>=1000 from public.mobile_voice_calls where binding_sha256=p_binding and phase<>'closed') then
    raise exception using errcode='42501',message='Independent voice control unavailable';
  end if;
  insert into public.mobile_voice_calls(lease_id,user_id,tenant_id,project_id,device_id,session_id,binding_sha256,
    phase,lease_ms,hard_expires_at,lease_expires_at,jwt_expires_at)
    values(p_lease_id,p_user_id,p_tenant_id,p_project_id,p_device_id,p_session_id,p_binding,'allocating',p_lease_ms,
      v_now+make_interval(secs=>p_max_duration_ms/1000.0),
      least(v_now+make_interval(secs=>p_lease_ms/1000.0),p_jwt_expires_at),p_jwt_expires_at);
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id;
  return public.mobile_voice_json(v);
end $$;

create function public.mobile_voice_get(p_lease_id uuid,p_binding text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; begin
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id and binding_sha256=p_binding;
  if not found then raise exception using errcode='42501',message='Voice control identity unavailable'; end if;
  return public.mobile_voice_json(v);
end $$;

create function public.mobile_voice_attach(p_lease_id uuid,p_binding text,p_call_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; begin
  if p_call_id is null or p_call_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then
    raise exception using errcode='22023',message='Invalid provider call identity';
  end if;
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id and binding_sha256=p_binding for update;
  if not found or (v.call_id is not null and v.call_id<>p_call_id) or v.phase='closed' then
    raise exception using errcode='42501',message='Voice control identity changed';
  end if;
  -- Persist even a late identity so the controller can end it. Never raise
  -- after this write merely because the permission/deadline has elapsed.
  if v.call_id is null then
    update public.mobile_voice_calls set call_id=p_call_id,revision=revision+1,next_check_at=clock_timestamp(),
      phase=case when phase='allocating' and lease_expires_at>clock_timestamp()
        and public.mobile_voice_authorized(user_id,project_id,device_id,session_id) then 'registering' else 'closing' end
      where lease_id=p_lease_id returning * into v;
  end if;
  return public.mobile_voice_json(v);
end $$;

create function public.mobile_voice_renew(
  p_lease_id uuid,p_binding text,p_revision bigint,p_user_id uuid,p_tenant_id text,
  p_project_id uuid,p_device_id uuid,p_session_id uuid,p_jwt_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; v_now timestamptz; begin
  perform public.mobile_lock_open_account(p_user_id);
  perform public.mobile_lock_open_project(p_project_id);
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id and binding_sha256=p_binding for update;
  if not found or v.user_id is distinct from p_user_id or v.tenant_id is distinct from p_tenant_id
    or v.project_id is distinct from p_project_id or v.device_id is distinct from p_device_id
    or v.session_id is distinct from p_session_id or v.revision is distinct from p_revision then
    raise exception using errcode='42501',message='Voice renewal scope or revision changed';
  end if;
  v_now:=clock_timestamp();
  if v.phase<>'active' or not v.controller_observed or v.lease_expires_at<=v_now or v.hard_expires_at<=v_now
    or p_jwt_expires_at is null or not isfinite(p_jwt_expires_at) or p_jwt_expires_at<=v_now
    or not public.mobile_voice_authorized(p_user_id,p_project_id,p_device_id,p_session_id)
    or not public.mobile_voice_controller_live(p_binding,v.lease_ms) then
    raise exception using errcode='42501',message='Voice renewal unavailable';
  end if;
  update public.mobile_voice_calls set revision=revision+1,jwt_expires_at=p_jwt_expires_at,
    lease_expires_at=least(hard_expires_at,p_jwt_expires_at,v_now+make_interval(secs=>lease_ms/1000.0))
    where lease_id=p_lease_id returning * into v;
  return public.mobile_voice_json(v);
end $$;

create function public.mobile_voice_close(p_lease_id uuid,p_binding text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; begin
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id and binding_sha256=p_binding for update;
  if not found then raise exception using errcode='42501',message='Voice control identity unavailable'; end if;
  if v.phase not in ('closed','closing','unknown') then
    update public.mobile_voice_calls set phase=case when call_id is null then 'unknown' else 'closing' end,
      revision=revision+1,next_check_at=clock_timestamp() where lease_id=p_lease_id returning * into v;
  end if;
  return public.mobile_voice_json(v);
end $$;

create function public.mobile_voice_controller_poll(
  p_controller_id uuid,p_binding text,p_poll_ms integer,p_claim_ms integer,p_limit integer
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; v_now timestamptz; v_rows jsonb:='[]'; begin
  if p_controller_id is null or p_binding is null or p_binding !~ '^[0-9a-f]{64}$'
    or p_poll_ms is null or p_poll_ms not between 100 and 30000
    or p_claim_ms is null or p_claim_ms not between p_poll_ms*3 and 60000
    or p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode='22023',message='Invalid controller bounds';
  end if;
  v_now:=clock_timestamp();
  insert into public.mobile_voice_controllers values(p_controller_id,p_binding,v_now,p_poll_ms)
    on conflict(controller_id) do update set last_poll_at=excluded.last_poll_at,poll_ms=excluded.poll_ms
      where mobile_voice_controllers.binding_sha256=excluded.binding_sha256;
  if not found then raise exception using errcode='42501',message='Controller binding changed'; end if;
  for v in select * from public.mobile_voice_calls where binding_sha256=p_binding
    and phase not in ('closed','unknown') and next_check_at<=v_now
    and (claim_expires_at is null or claim_expires_at<=v_now or controller_id=p_controller_id)
    order by next_check_at,lease_id for update skip locked limit p_limit loop
    update public.mobile_voice_calls set
      phase=case when phase='closing' or lease_expires_at<=clock_timestamp() or hard_expires_at<=clock_timestamp()
        or not public.mobile_voice_authorized(user_id,project_id,device_id,session_id)
        then case when call_id is null then 'unknown' else 'closing' end else phase end,
      controller_id=p_controller_id,claim_token=gen_random_uuid(),
      claim_expires_at=clock_timestamp()+make_interval(secs=>p_claim_ms/1000.0),
      next_check_at=clock_timestamp()+make_interval(secs=>p_poll_ms/1000.0)
      where lease_id=v.lease_id returning * into v;
    v_rows:=v_rows||jsonb_build_array(public.mobile_voice_json(v));
  end loop;
  return v_rows;
end $$;

create function public.mobile_voice_controller_claim(
  p_controller_id uuid,p_lease_id uuid,p_binding text,p_claim_ms integer,p_force_close boolean
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; begin
  if p_controller_id is null or p_force_close is null or p_claim_ms is null or p_claim_ms not between 1000 and 60000 then
    raise exception using errcode='22023',message='Invalid controller claim';
  end if;
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id and binding_sha256=p_binding for update;
  if not found or v.call_id is null or (v.phase<>'closed' and v.claim_expires_at>clock_timestamp() and v.controller_id<>p_controller_id) then
    raise exception using errcode='42501',message='Controller claim unavailable';
  end if;
  -- An exact positive closed receipt does not require stealing its old claim.
  -- Returning it unchanged lets a crash journal retire after Auth redaction.
  if v.phase<>'closed' then
    update public.mobile_voice_calls set phase=case when p_force_close or phase='closing'
      or lease_expires_at<=clock_timestamp() or hard_expires_at<=clock_timestamp()
      or not public.mobile_voice_authorized(user_id,project_id,device_id,session_id) then 'closing' else phase end,
      revision=revision+1,controller_id=p_controller_id,
      claim_token=gen_random_uuid(),claim_expires_at=clock_timestamp()+make_interval(secs=>p_claim_ms/1000.0)
      where lease_id=p_lease_id returning * into v;
  end if;
  return public.mobile_voice_json(v);
end $$;

create function public.mobile_voice_controller_observed(p_controller_id uuid,p_lease_id uuid,p_binding text,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; begin
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id and binding_sha256=p_binding for update;
  if not found or v.controller_id is distinct from p_controller_id or v.claim_token is distinct from p_claim_token
    or v.claim_expires_at<=clock_timestamp() or v.call_id is null then
    raise exception using errcode='42501',message='Controller generation changed';
  end if;
  update public.mobile_voice_calls set controller_observed=true,
    phase=case when phase='registering' then case when lease_expires_at>clock_timestamp() and hard_expires_at>clock_timestamp()
      and public.mobile_voice_authorized(user_id,project_id,device_id,session_id) then 'active' else 'closing' end else phase end
    where lease_id=p_lease_id returning * into v;
  return public.mobile_voice_json(v);
end $$;

create function public.mobile_voice_controller_get(p_lease_id uuid,p_binding text)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public.mobile_voice_json(v) from public.mobile_voice_calls v where lease_id=p_lease_id and binding_sha256=p_binding $$;

create function public.mobile_voice_controller_complete(p_controller_id uuid,p_lease_id uuid,p_binding text,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v public.mobile_voice_calls; begin
  select * into v from public.mobile_voice_calls where lease_id=p_lease_id and binding_sha256=p_binding for update;
  if not found or v.phase<>'closing' or v.call_id is null
    or v.controller_id is distinct from p_controller_id or v.claim_token is distinct from p_claim_token
    or v.claim_expires_at<=clock_timestamp() then
    raise exception using errcode='42501',message='Controller generation changed';
  end if;
  update public.mobile_voice_calls set phase='closed',revision=revision+1,closed_at=clock_timestamp()
    where lease_id=p_lease_id returning * into v;
  return public.mobile_voice_json(v);
end $$;

-- Account deletion and allocation share the account-first fence. An unknown
-- allocation cannot be declared closed merely because Auth is removed.
create function public.mobile_voice_assert_account_quiescent(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='25000',message='Voice account lifecycle requires READ COMMITTED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||p_user_id::text,0));
  if exists(select 1 from public.mobile_voice_calls where user_id=p_user_id and phase<>'closed') then
    raise exception using errcode='55000',message='Provider cleanup pending: every known or unknown voice intent must be resolved';
  end if;
end $$;

-- This guard also protects direct trusted SQL writes. A row trigger already
-- owns its row lock, so it refuses a contended account fence instead of waiting
-- in reversed order behind an account-first lifecycle operation.
create function public.mobile_voice_guard_account_finalization()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_user uuid; begin
  if tg_table_schema='auth' then v_user:=old.id;
  else
    if tg_op='UPDATE' and new.user_id is distinct from old.user_id then
      raise exception using errcode='55000',message='Account deletion identity is immutable';
    end if;
    if new.phase not in ('auth_ready','finalized') then return new; end if;
    v_user:=new.user_id;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('openauthor-mobile-account:'||v_user::text,0)) then
    raise exception using errcode='40001',message='Account lifecycle changed; retry a fresh transaction';
  end if;
  perform public.mobile_voice_assert_account_quiescent(v_user);
  if tg_table_schema='auth' then return old; end if;
  return new;
end $$;
create trigger mobile_account_aa_voice_guard before delete on auth.users
  for each row execute function public.mobile_voice_guard_account_finalization();
create trigger mobile_account_voice_guard before insert or update on public.mobile_account_deletion_jobs
  for each row execute function public.mobile_voice_guard_account_finalization();

alter function public.mobile_prepare_account_auth_finalization(uuid,text,text)
  rename to mobile_prepare_account_auth_finalization_without_voice_control;
revoke all on function public.mobile_prepare_account_auth_finalization_without_voice_control(uuid,text,text)
  from public,anon,authenticated,service_role,mobile_deletion_verifier;
create function public.mobile_prepare_account_auth_finalization(p_job_id uuid,p_expected_inventory_sha256 text,p_cleanup_verification_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare v_user uuid; begin
  select user_id into v_user from public.mobile_account_deletion_jobs where job_id=p_job_id;
  if v_user is null then raise exception using errcode='42501',message='Account deletion request not found'; end if;
  perform public.mobile_voice_assert_account_quiescent(v_user);
  return public.mobile_prepare_account_auth_finalization_without_voice_control(p_job_id,p_expected_inventory_sha256,p_cleanup_verification_sha256);
end $$;
revoke all on function public.mobile_prepare_account_auth_finalization(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.mobile_prepare_account_auth_finalization(uuid,text,text) to mobile_deletion_verifier;

alter function public.mobile_account_deletion_result(uuid) rename to mobile_account_deletion_result_without_voice_control;
revoke all on function public.mobile_account_deletion_result_without_voice_control(uuid) from public,anon,authenticated,service_role;
create function public.mobile_account_deletion_result(p_job_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public
as $$ with result as (
  select public.mobile_account_deletion_result_without_voice_control(p_job_id) as body,
    exists(select 1 from public.mobile_voice_calls v join public.mobile_account_deletion_jobs a on a.user_id=v.user_id
      where a.job_id=p_job_id and v.phase<>'closed') as pending
) select case when body is null then null else body||jsonb_build_object('provider_cleanup_pending',pending,
  'blockers',coalesce(body->'blockers','[]'::jsonb)||case when pending then jsonb_build_array('Provider cleanup pending: unresolved voice call or allocation') else '[]'::jsonb end) end from result $$;
revoke all on function public.mobile_account_deletion_result(uuid) from public,anon,authenticated,service_role;

create function public.mobile_voice_redact_deleted_account()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  -- The BEFORE guard and its transaction-held account fence prove that these
  -- are all closed. Exact lease/call/binding receipts still reconcile journals.
  update public.mobile_voice_calls set user_id=null,tenant_id=null,project_id=null,device_id=null,session_id=null,
    identity_redacted=true,revision=revision+1 where user_id=old.id and phase='closed';
  return old;
end $$;
create trigger mobile_account_voice_redaction after delete on auth.users
  for each row execute function public.mobile_voice_redact_deleted_account();

-- Existing roles deliberately get no direct or inherited control capability.
do $$ declare f record; begin
  for f in select oid::regprocedure as signature,proname from pg_proc
    where pronamespace='public'::regnamespace and proname like 'mobile_voice_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role, mobile_voice_gateway, mobile_voice_controller',f.signature);
    if f.proname in ('mobile_voice_begin','mobile_voice_get','mobile_voice_attach','mobile_voice_renew','mobile_voice_close') then
      execute format('grant execute on function %s to mobile_voice_gateway',f.signature);
    elsif f.proname in ('mobile_voice_controller_poll','mobile_voice_controller_claim','mobile_voice_controller_observed','mobile_voice_controller_complete','mobile_voice_controller_get') then
      execute format('grant execute on function %s to mobile_voice_controller',f.signature);
    end if;
  end loop;
end $$;
comment on table public.mobile_voice_calls is
  'Content-free control intent and known-call metadata. Unknown allocation is not proof of closure. Controller acknowledgement is hangup acceptance, not final billing accounting.';
commit;
