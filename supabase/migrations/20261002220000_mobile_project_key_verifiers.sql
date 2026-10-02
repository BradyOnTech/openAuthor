-- A fixed, non-prose AEAD witness is registered by the same authorized client
-- that creates the key envelopes. SQL binds its immutable bytes to one version;
-- only the client can prove a candidate key by authenticating those bytes.
begin;

create table public.mobile_project_key_verifiers (
  project_id uuid not null,
  key_version integer not null check (key_version > 0),
  algorithm text not null check (algorithm = 'aes-256-gcm-v1'),
  aad_version integer not null check (aad_version = 1),
  nonce bytea not null check (octet_length(nonce) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) = 57),
  ciphertext_sha256 text not null check (
    ciphertext_sha256 ~ '^[0-9a-f]{64}$'
    and ciphertext_sha256 = encode(digest(ciphertext, 'sha256'), 'hex')
  ),
  created_by_device_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (project_id, key_version),
  foreign key (project_id, key_version)
    references public.mobile_project_key_versions(project_id, key_version) on delete cascade,
  foreign key (project_id, created_by_device_id)
    references public.mobile_project_devices(project_id, device_id)
);
alter table public.mobile_project_key_verifiers enable row level security;
revoke all on table public.mobile_project_key_verifiers from public, anon, authenticated, service_role;

create function public.mobile_guard_project_key_verifier_write()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_user uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = '42501', message = 'Project key verifier is immutable';
  elsif tg_op = 'DELETE' then
    -- The existing verified project lifecycle deletes key versions first.
    -- Keep the witness until that parent version is actually being removed.
    if exists (select 1 from public.mobile_project_key_versions
      where project_id = old.project_id and key_version = old.key_version) then
      raise exception using errcode = '42501', message = 'Project key verifier requires key-version purge';
    end if;
    return old;
  end if;
  perform public.mobile_lock_open_project(new.project_id);
  select user_id into v_user from public.mobile_devices
    where id = new.created_by_device_id and revoked_at is null;
  perform public.mobile_try_lock_open_account(v_user);
  if not exists (select 1 from public.mobile_project_key_versions
    where project_id = new.project_id and key_version = new.key_version
      and created_by_device_id = new.created_by_device_id and retired_at is null) then
    raise exception using errcode = '42501', message = 'Current project key attribution required';
  end if;
  return new;
end;
$$;
create trigger mobile_project_key_verifier_write
  before insert or update or delete on public.mobile_project_key_verifiers
  for each row execute function public.mobile_guard_project_key_verifier_write();

create function public.mobile_project_key_verifier_result(p_row public.mobile_project_key_verifiers)
returns jsonb language sql immutable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'schema', 'openauthor.mobile.project-key-verifier',
    'schema_version', 1,
    'project_id', p_row.project_id,
    'key_version', p_row.key_version,
    'algorithm', p_row.algorithm,
    'aad_version', p_row.aad_version,
    'nonce_hex', encode(p_row.nonce, 'hex'),
    'ciphertext_hex', encode(p_row.ciphertext, 'hex'),
    'ciphertext_sha256', p_row.ciphertext_sha256
  )
$$;

create function public.mobile_rotate_project_key_with_verifier(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_expected_previous_version integer,
  p_reason_code text,
  p_envelopes jsonb,
  p_verifier jsonb
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_version public.mobile_project_key_versions;
  v_verifier public.mobile_project_key_verifiers;
  v_expected_fields constant text[] := array[
    'aad_version', 'algorithm', 'ciphertext_hex', 'ciphertext_sha256',
    'key_version', 'nonce_hex', 'project_id', 'schema', 'schema_version'
  ];
begin
  if p_project_id is null or p_expected_previous_version is null
    or p_expected_previous_version < 0 or p_expected_previous_version = 2147483647
    or jsonb_typeof(p_verifier) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Exact project key verifier required';
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(p_verifier) as fields(key))
    is distinct from v_expected_fields
    or jsonb_typeof(p_verifier -> 'schema') is distinct from 'string'
    or p_verifier ->> 'schema' is distinct from 'openauthor.mobile.project-key-verifier'
    or jsonb_typeof(p_verifier -> 'schema_version') is distinct from 'number'
    or p_verifier ->> 'schema_version' is distinct from '1'
    or jsonb_typeof(p_verifier -> 'project_id') is distinct from 'string'
    or p_verifier ->> 'project_id' is distinct from p_project_id::text
    or jsonb_typeof(p_verifier -> 'key_version') is distinct from 'number'
    or p_verifier ->> 'key_version' is distinct from (p_expected_previous_version + 1)::text
    or jsonb_typeof(p_verifier -> 'algorithm') is distinct from 'string'
    or p_verifier ->> 'algorithm' is distinct from 'aes-256-gcm-v1'
    or jsonb_typeof(p_verifier -> 'aad_version') is distinct from 'number'
    or p_verifier ->> 'aad_version' is distinct from '1'
    or jsonb_typeof(p_verifier -> 'nonce_hex') is distinct from 'string'
    or coalesce(p_verifier ->> 'nonce_hex', '') !~ '^[0-9a-f]{24}$'
    or jsonb_typeof(p_verifier -> 'ciphertext_hex') is distinct from 'string'
    or coalesce(p_verifier ->> 'ciphertext_hex', '') !~ '^[0-9a-f]{114}$'
    or jsonb_typeof(p_verifier -> 'ciphertext_sha256') is distinct from 'string'
    or coalesce(p_verifier ->> 'ciphertext_sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Project key verifier fields or identity are invalid';
  end if;
  if p_verifier ->> 'ciphertext_sha256'
    <> encode(digest(decode(p_verifier ->> 'ciphertext_hex', 'hex'), 'sha256'), 'hex') then
    raise exception using errcode = '22000', message = 'Project key verifier ciphertext digest mismatch';
  end if;
  -- The shared account/project namespace fences require READ COMMITTED. Take
  -- the project row before recipient locks; recheck the current workspace,
  -- live session, enrollment and device after the potentially queued lock.
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  perform 1 from public.projects where id = p_project_id and status = 'active' for update;
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  v_version := public.mobile_rotate_project_key_with_envelopes(
    p_requesting_device_id, p_project_id, p_expected_previous_version,
    p_reason_code, p_envelopes
  );
  -- The legacy atomic recipient module rechecks after its device/key waits.
  -- Recheck once more before the witness insert and never accept a caller's
  -- declared version in place of the actual durable rotation result.
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if v_version.project_id is distinct from p_project_id
    or v_version.key_version is distinct from p_expected_previous_version + 1 then
    raise exception using errcode = '40001', message = 'Project key rotation result changed';
  end if;
  insert into public.mobile_project_key_verifiers (
    project_id, key_version, algorithm, aad_version, nonce, ciphertext,
    ciphertext_sha256, created_by_device_id
  ) values (
    p_project_id, v_version.key_version, 'aes-256-gcm-v1', 1,
    decode(p_verifier ->> 'nonce_hex', 'hex'),
    decode(p_verifier ->> 'ciphertext_hex', 'hex'),
    p_verifier ->> 'ciphertext_sha256', p_requesting_device_id
  ) returning * into v_verifier;
  return jsonb_build_object(
    'project_id', p_project_id, 'key_version', v_version.key_version,
    'recovery_verifier', public.mobile_project_key_verifier_result(v_verifier)
  );
end;
$$;

create function public.mobile_get_project_key_verifier(
  p_requesting_device_id uuid, p_project_id uuid, p_expected_key_version integer
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_verifier public.mobile_project_key_verifiers;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'viewer');
  if p_expected_key_version is null or p_expected_key_version < 1 then
    raise exception using errcode = '22023', message = 'Positive project key verifier version required';
  end if;
  if not exists (select 1 from public.mobile_project_key_versions
    where project_id = p_project_id and key_version = p_expected_key_version and retired_at is null) then
    raise exception using errcode = '40001', message = 'Current project key version changed';
  end if;
  select * into v_verifier from public.mobile_project_key_verifiers
    where project_id = p_project_id and key_version = p_expected_key_version;
  if not found then return null; end if;
  return public.mobile_project_key_verifier_result(v_verifier);
end;
$$;

revoke execute on function public.mobile_guard_project_key_verifier_write(),
  public.mobile_project_key_verifier_result(public.mobile_project_key_verifiers)
  from public, anon, authenticated, service_role;
revoke execute on function public.mobile_rotate_project_key_with_verifier(uuid,uuid,integer,text,jsonb,jsonb),
  public.mobile_get_project_key_verifier(uuid,uuid,integer) from public, anon, service_role;
grant execute on function public.mobile_rotate_project_key_with_verifier(uuid,uuid,integer,text,jsonb,jsonb),
  public.mobile_get_project_key_verifier(uuid,uuid,integer) to authenticated;

comment on table public.mobile_project_key_verifiers is
  'Immutable fixed non-prose AEAD witness registered atomically with a new key and every reviewed recipient envelope. No raw key or prose. Legacy versions may have no verifier; there is no candidate-created backfill.';
comment on function public.mobile_get_project_key_verifier(uuid,uuid,integer) is
  'Current active version only, live enrolled viewer or higher. A locator is not proof: the client must authenticate fixed plaintext and exact project/version AAD before accepting a candidate key.';
commit;
