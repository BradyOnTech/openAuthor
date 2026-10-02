-- Revalidate live GoTrue sessions, current membership and active books at the
-- shared device seam. A retained device binding or historical key envelope is
-- not evidence that the caller may still read, publish or continue a call.
begin;

create function public.mobile_has_live_auth_session()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = case
      when coalesce(auth.jwt() ->> 'session_id', '')
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (auth.jwt() ->> 'session_id')::uuid
      else null
    end
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > clock_timestamp())
  )
$$;

create or replace function public.mobile_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user_id uuid;
  v_session_id uuid;
  v_device_id uuid;
begin
  begin
    v_user_id := nullif(event ->> 'user_id', '')::uuid;
    v_session_id := nullif(v_claims ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_set(event, '{claims}', v_claims - 'device_id', true);
  end;
  if v_user_id is null or v_session_id is null then
    return jsonb_set(event, '{claims}', v_claims - 'device_id', true);
  end if;

  select d.id into v_device_id
  from public.mobile_devices d
  join public.mobile_device_keys dk on dk.device_id = d.id and dk.id = d.current_key_id
  join auth.sessions s on s.id = d.auth_session_id and s.user_id = d.user_id
  where d.user_id = v_user_id
    and d.auth_session_id = v_session_id
    and (s.not_after is null or s.not_after > clock_timestamp())
    and d.revoked_at is null
    and dk.retired_at is null
    and dk.revoked_at is null;
  if v_device_id is null then
    v_claims := v_claims - 'device_id';
  else
    v_claims := jsonb_set(v_claims, '{device_id}', to_jsonb(v_device_id::text), true);
  end if;
  return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;

create or replace function public.mobile_has_active_project_device(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.mobile_has_live_auth_session()
    and public.mobile_has_project_role(p_project_id, 'viewer')
    and exists (
      select 1
      from public.mobile_project_devices pd
      join public.projects p on p.id = pd.project_id
      join public.mobile_devices d on d.id = pd.device_id
      join public.mobile_device_keys dk on dk.id = d.current_key_id and dk.device_id = d.id
      where pd.project_id = p_project_id
        and p.status = 'active'
        and d.user_id = auth.uid()
        and d.id = public.mobile_claimed_device_id()
        and d.auth_session_id::text = auth.jwt() ->> 'session_id'
        and pd.revoked_at is null
        and d.revoked_at is null
        and dk.retired_at is null
        and dk.revoked_at is null
    )
$$;

create or replace function public.authorize_realtime_session(p_project_id uuid, p_device_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(auth.uid() is not null
    and public.mobile_claimed_device_id() = p_device_id
    and public.mobile_has_active_project_device(p_project_id), false)
$$;

create or replace function public.mobile_assert_active_device(p_device_id uuid)
returns public.mobile_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_device public.mobile_devices;
begin
  if auth.uid() is null or not public.mobile_has_live_auth_session() then
    raise exception using errcode = '42501', message = 'Live authenticated session required';
  end if;
  if public.mobile_claimed_device_id() is distinct from p_device_id then
    raise exception using errcode = '42501', message = 'Device-bound access token required';
  end if;
  select d.* into v_device
  from public.mobile_devices d
  join public.mobile_device_keys dk on dk.device_id = d.id and dk.id = d.current_key_id
  where d.id = p_device_id
    and d.user_id = auth.uid()
    and d.auth_session_id::text = auth.jwt() ->> 'session_id'
    and d.revoked_at is null
    and dk.retired_at is null
    and dk.revoked_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'Active owned device required';
  end if;
  return v_device;
end;
$$;

create or replace function public.mobile_assert_project_device(
  p_device_id uuid, p_project_id uuid, p_min_role public.workspace_role
)
returns public.workspace_role
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role public.workspace_role;
begin
  perform public.mobile_assert_active_device(p_device_id);
  select wm.role into v_role
  from public.projects p
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

create or replace function public.mobile_register_device(
  p_device_id uuid,
  p_key_id uuid,
  p_platform public.mobile_device_platform,
  p_device_label text,
  p_key_algorithm public.mobile_device_key_algorithm,
  p_public_key bytea
)
returns public.mobile_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_device public.mobile_devices;
  v_key public.mobile_device_keys;
  v_session_id uuid;
  v_bound_device_id uuid;
begin
  if auth.uid() is null or not public.mobile_has_live_auth_session() then
    raise exception using errcode = '42501', message = 'Live authenticated session required';
  end if;
  if p_device_id is null or p_key_id is null or p_device_label is null or p_public_key is null then
    raise exception using errcode = '22023', message = 'Device registration fields are required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'Valid Auth session_id claim required';
  end;
  if v_session_id is null then
    raise exception using errcode = '42501', message = 'Valid Auth session_id claim required';
  end if;
  if public.mobile_claimed_device_id() is not null
     and public.mobile_claimed_device_id() <> p_device_id then
    raise exception using errcode = '42501', message = 'Auth session is bound to another device';
  end if;
  select id into v_bound_device_id
  from public.mobile_devices
  where auth_session_id = v_session_id;
  if v_bound_device_id is not null and v_bound_device_id <> p_device_id then
    raise exception using errcode = '22000', message = 'Auth session is already bound to another device';
  end if;

  insert into public.mobile_devices (id, user_id, auth_session_id, platform, device_label)
  values (p_device_id, auth.uid(), v_session_id, p_platform, p_device_label)
  on conflict (id) do nothing;

  select * into v_device from public.mobile_devices where id = p_device_id for update;
  if v_device.user_id <> auth.uid() or v_device.platform <> p_platform
     or v_device.device_label <> p_device_label or v_device.revoked_at is not null then
    raise exception using errcode = '22000', message = 'Device registration idempotency conflict';
  end if;

  insert into public.mobile_device_keys (
    id, device_id, key_version, algorithm, public_key, public_key_sha256
  ) values (
    p_key_id, p_device_id, 1, p_key_algorithm, p_public_key,
    encode(digest(p_public_key, 'sha256'), 'hex')
  ) on conflict (id) do nothing;

  select * into v_key from public.mobile_device_keys where id = p_key_id;
  if v_key.device_id <> p_device_id or v_key.key_version <> 1
     or v_key.algorithm <> p_key_algorithm or v_key.public_key <> p_public_key
     or v_key.retired_at is not null or v_key.revoked_at is not null then
    raise exception using errcode = '22000', message = 'Device key idempotency conflict';
  end if;
  if v_device.current_key_id is not null and v_device.current_key_id <> p_key_id then
    raise exception using errcode = '22000', message = 'Device already has a different current key';
  end if;
  if v_device.auth_session_id <> v_session_id then
    if exists (
      select 1 from public.mobile_device_session_bindings
      where auth_session_id = v_session_id
    ) then
      raise exception using errcode = '42501', message = 'Previously unbound Auth session cannot reclaim a device';
    end if;
    update public.mobile_device_session_bindings
      set unbound_at = now()
      where device_id = p_device_id and unbound_at is null;
  end if;
  insert into public.mobile_device_session_bindings (device_id, auth_session_id)
    values (p_device_id, v_session_id)
    on conflict (auth_session_id) do nothing;
  if not exists (
    select 1 from public.mobile_device_session_bindings
    where device_id = p_device_id and auth_session_id = v_session_id
      and unbound_at is null
  ) then
    raise exception using errcode = '22000', message = 'Auth session binding idempotency conflict';
  end if;
  -- A normal sign-out/sign-in changes the GoTrue session_id. Move the binding
  -- only after the caller has supplied an exact same-user device record and
  -- exact current key id/algorithm/public-key tuple. The previous Auth session
  -- then fails closed immediately because its session_id no longer matches.
  update public.mobile_devices
    set current_key_id = p_key_id, auth_session_id = v_session_id
    where id = p_device_id;
  select * into v_device from public.mobile_devices where id = p_device_id;
  return v_device;
end;
$$;

create function public.mobile_get_project_key_state(p_requesting_device_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_latest integer;
  v_active integer;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  select coalesce(max(key_version), 0), max(key_version) filter (where retired_at is null)
    into v_latest, v_active
  from public.mobile_project_key_versions where project_id = p_project_id;
  return jsonb_build_object('project_id', p_project_id, 'latest_key_version', v_latest, 'active_key_version', v_active);
end;
$$;

revoke execute on function public.mobile_has_live_auth_session() from public, anon, authenticated;
revoke execute on function public.mobile_get_project_key_state(uuid, uuid) from public, anon;
grant execute on function public.mobile_get_project_key_state(uuid, uuid) to authenticated;
comment on function public.mobile_get_project_key_state(uuid, uuid) is
  'Current server-owned publishing key state, checked against a live editor session and active project device. Historical envelopes do not prove that a key is active.';
comment on function public.authorize_realtime_session(uuid, uuid) is
  'Current live Auth-session, workspace, active-project and device authority for issuance and ongoing call checks. JWT verification and expiry remain enforced by the gateway.';

commit;
