-- Hosted metadata for end-to-end encrypted mobile sync.
-- Plaintext manuscript, transcript, prompt, tool argument/result, and snapshot
-- content must never be stored in these relations. Ciphertext is append-only;
-- object bytes live in the private mobile-encrypted-sync Storage bucket.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'mobile_device_platform') then
    create type public.mobile_device_platform as enum ('desktop', 'ios', 'android');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'mobile_device_key_algorithm') then
    create type public.mobile_device_key_algorithm as enum ('x25519-v1');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'mobile_cipher_algorithm') then
    create type public.mobile_cipher_algorithm as enum ('aes-256-gcm-v1');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'mobile_envelope_algorithm') then
    create type public.mobile_envelope_algorithm as enum (
      'x25519-xsalsa20-poly1305-sealedbox-v1'
    );
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'mobile_outbox_operation_type') then
    create type public.mobile_outbox_operation_type as enum (
      'capture_note', 'dictated_passage', 'story_memory_suggestion',
      'change_set_request', 'thread_turn', 'review_decision'
    );
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'mobile_snapshot_ack_kind') then
    create type public.mobile_snapshot_ack_kind as enum ('downloaded', 'verified', 'applied');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'mobile_outbox_ack_status') then
    create type public.mobile_outbox_ack_status as enum ('imported', 'rejected', 'conflict');
  end if;
end
$$;

create table public.mobile_devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null unique,
  platform public.mobile_device_platform not null,
  device_label text not null check (
    char_length(device_label) between 1 and 80 and device_label !~ '[[:cntrl:]]'
  ),
  current_key_id uuid,
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason_code text check (
    revocation_reason_code is null or revocation_reason_code ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  ),
  check ((revoked_at is null) = (revocation_reason_code is null))
);

create table public.mobile_device_session_bindings (
  device_id uuid not null references public.mobile_devices(id) on delete cascade,
  auth_session_id uuid primary key,
  bound_at timestamptz not null default now(),
  unbound_at timestamptz,
  check (unbound_at is null or unbound_at >= bound_at),
  unique (device_id, auth_session_id)
);

create unique index mobile_device_session_bindings_one_active
  on public.mobile_device_session_bindings(device_id)
  where unbound_at is null;

create table public.mobile_device_keys (
  id uuid primary key,
  device_id uuid not null references public.mobile_devices(id) on delete cascade,
  key_version integer not null check (key_version > 0),
  algorithm public.mobile_device_key_algorithm not null,
  public_key bytea not null check (octet_length(public_key) = 32),
  public_key_sha256 text not null check (public_key_sha256 ~ '^[0-9a-f]{64}$'),
  rotated_from_key_id uuid,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  revoked_at timestamptz,
  unique (device_id, key_version),
  unique (device_id, id),
  unique (public_key_sha256),
  foreign key (device_id, rotated_from_key_id)
    references public.mobile_device_keys(device_id, id),
  check (public_key_sha256 = encode(digest(public_key, 'sha256'), 'hex')),
  check (rotated_from_key_id is null or rotated_from_key_id <> id),
  check (revoked_at is null or retired_at is not null)
);

alter table public.mobile_devices
  add constraint mobile_devices_current_key_fk
  foreign key (id, current_key_id)
  references public.mobile_device_keys(device_id, id)
  deferrable initially immediate;

create table public.mobile_project_devices (
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid not null references public.mobile_devices(id) on delete cascade,
  enrolled_by_device_id uuid not null references public.mobile_devices(id),
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_device_id uuid references public.mobile_devices(id),
  revocation_reason_code text check (
    revocation_reason_code is null or revocation_reason_code ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  ),
  primary key (project_id, device_id),
  check (
    (revoked_at is null and revoked_by_device_id is null and revocation_reason_code is null)
    or
    (revoked_at is not null and revoked_by_device_id is not null and revocation_reason_code is not null)
  )
);

create table public.mobile_project_key_versions (
  project_id uuid not null references public.projects(id) on delete cascade,
  key_version integer not null check (key_version > 0),
  created_by_device_id uuid not null,
  rotation_reason_code text not null check (rotation_reason_code ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (project_id, key_version),
  foreign key (project_id, created_by_device_id)
    references public.mobile_project_devices(project_id, device_id)
);

create unique index mobile_project_key_versions_one_active
  on public.mobile_project_key_versions(project_id)
  where retired_at is null;

create table public.mobile_project_key_envelopes (
  id uuid primary key,
  project_id uuid not null,
  key_version integer not null,
  recipient_device_id uuid not null,
  recipient_key_id uuid not null,
  sender_device_id uuid not null,
  algorithm public.mobile_envelope_algorithm not null,
  sealed_project_key bytea not null check (octet_length(sealed_project_key) = 80),
  sealed_project_key_sha256 text not null check (sealed_project_key_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (project_id, key_version)
    references public.mobile_project_key_versions(project_id, key_version) on delete cascade,
  foreign key (project_id, recipient_device_id)
    references public.mobile_project_devices(project_id, device_id),
  foreign key (project_id, sender_device_id)
    references public.mobile_project_devices(project_id, device_id),
  foreign key (recipient_device_id, recipient_key_id)
    references public.mobile_device_keys(device_id, id),
  unique (project_id, key_version, recipient_device_id, recipient_key_id),
  check (sealed_project_key_sha256 = encode(digest(sealed_project_key, 'sha256'), 'hex'))
);

create table public.mobile_snapshot_manifests (
  snapshot_id uuid primary key,
  project_id uuid not null,
  project_revision text not null check (project_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  key_version integer not null,
  schema_version integer not null check (schema_version between 1 and 1000),
  object_bucket text not null check (object_bucket = 'mobile-encrypted-sync'),
  object_path text not null check (
    object_path = 'projects/' || project_id::text || '/snapshots/' || snapshot_id::text || '.bin'
  ),
  object_byte_length bigint not null check (object_byte_length between 40 and 67108864),
  object_sha256 text not null check (object_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_algorithm public.mobile_cipher_algorithm not null,
  manifest_nonce bytea not null check (octet_length(manifest_nonce) = 12),
  manifest_ciphertext bytea not null check (octet_length(manifest_ciphertext) between 17 and 65536),
  manifest_ciphertext_sha256 text not null check (manifest_ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_device_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (project_id, key_version)
    references public.mobile_project_key_versions(project_id, key_version),
  foreign key (project_id, created_by_device_id)
    references public.mobile_project_devices(project_id, device_id),
  unique (project_id, project_revision),
  unique (project_id, snapshot_id),
  check (manifest_ciphertext_sha256 = encode(digest(manifest_ciphertext, 'sha256'), 'hex'))
);

create table public.mobile_snapshot_acknowledgements (
  snapshot_id uuid not null,
  project_id uuid not null,
  device_id uuid not null,
  acknowledgement public.mobile_snapshot_ack_kind not null,
  acknowledged_at timestamptz not null default now(),
  primary key (snapshot_id, device_id),
  foreign key (project_id, snapshot_id)
    references public.mobile_snapshot_manifests(project_id, snapshot_id) on delete cascade,
  foreign key (project_id, device_id)
    references public.mobile_project_devices(project_id, device_id)
);

create table public.mobile_outbox_envelopes (
  operation_id uuid primary key,
  project_id uuid not null,
  source_device_id uuid not null,
  key_version integer not null,
  base_project_revision text not null check (base_project_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  operation_type public.mobile_outbox_operation_type not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  algorithm public.mobile_cipher_algorithm not null,
  nonce bytea not null check (octet_length(nonce) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 8388608),
  ciphertext_sha256 text not null check (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  foreign key (project_id, key_version)
    references public.mobile_project_key_versions(project_id, key_version),
  foreign key (project_id, source_device_id)
    references public.mobile_project_devices(project_id, device_id),
  unique (project_id, operation_id),
  check (ciphertext_sha256 = encode(digest(ciphertext, 'sha256'), 'hex'))
);

create table public.mobile_outbox_acknowledgements (
  operation_id uuid not null,
  project_id uuid not null,
  device_id uuid not null,
  status public.mobile_outbox_ack_status not null,
  acknowledged_at timestamptz not null default now(),
  primary key (operation_id, device_id),
  foreign key (project_id, operation_id)
    references public.mobile_outbox_envelopes(project_id, operation_id) on delete cascade,
  foreign key (project_id, device_id)
    references public.mobile_project_devices(project_id, device_id)
);

create index mobile_devices_user_active_idx on public.mobile_devices(user_id, enrolled_at desc) where revoked_at is null;
create index mobile_project_devices_device_idx on public.mobile_project_devices(device_id, project_id) where revoked_at is null;
create index mobile_project_key_envelopes_recipient_idx on public.mobile_project_key_envelopes(recipient_device_id, project_id, key_version desc);
create index mobile_snapshot_manifests_project_idx on public.mobile_snapshot_manifests(project_id, created_at desc, snapshot_id);
create index mobile_snapshot_ack_device_idx on public.mobile_snapshot_acknowledgements(device_id, acknowledged_at desc);
create index mobile_outbox_project_idx on public.mobile_outbox_envelopes(project_id, received_at, operation_id);
create index mobile_outbox_ack_device_idx on public.mobile_outbox_acknowledgements(device_id, acknowledged_at desc);

create or replace function public.mobile_reject_ciphertext_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'Encrypted sync envelopes are immutable';
end;
$$;

create trigger mobile_project_key_envelopes_immutable
before update on public.mobile_project_key_envelopes
for each row execute function public.mobile_reject_ciphertext_update();
create trigger mobile_snapshot_manifests_immutable
before update on public.mobile_snapshot_manifests
for each row execute function public.mobile_reject_ciphertext_update();
create trigger mobile_outbox_envelopes_immutable
before update on public.mobile_outbox_envelopes
for each row execute function public.mobile_reject_ciphertext_update();
create trigger mobile_snapshot_acknowledgements_immutable
before update on public.mobile_snapshot_acknowledgements
for each row execute function public.mobile_reject_ciphertext_update();
create trigger mobile_outbox_acknowledgements_immutable
before update on public.mobile_outbox_acknowledgements
for each row execute function public.mobile_reject_ciphertext_update();

create or replace function public.mobile_has_project_role(
  p_project_id uuid,
  p_min_role public.workspace_role
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case p_min_role
      when 'viewer' then wm.role in ('viewer', 'editor', 'owner')
      when 'editor' then wm.role in ('editor', 'owner')
      when 'owner' then wm.role = 'owner'
      else false
    end
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = p_project_id and wm.user_id = auth.uid()
  ), false)
$$;

-- Content RPCs are bound to a signed device_id JWT claim. Enable
-- public.mobile_custom_access_token_hook as the project's Supabase Auth Custom
-- Access Token Hook. After mobile_register_device, the client must refresh its
-- Auth session before invoking a device-bound RPC. The hook maps one GoTrue
-- session_id to one active device, allowing one user to have multiple devices
-- without placing a mutable device selector in user metadata.
create or replace function public.mobile_claimed_device_id()
returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when coalesce(auth.jwt() ->> 'device_id', '')
      ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then (auth.jwt() ->> 'device_id')::uuid
    else null
  end
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
  -- Fail closed for missing/malformed claims and for retired/revoked keys.
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
  join public.mobile_device_keys dk
    on dk.device_id = d.id and dk.id = d.current_key_id
  where d.user_id = v_user_id
    and d.auth_session_id = v_session_id
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
  select exists (
    select 1
    from public.mobile_project_devices pd
    join public.mobile_devices d on d.id = pd.device_id
    join public.mobile_device_keys dk on dk.id = d.current_key_id and dk.device_id = d.id
    where pd.project_id = p_project_id
      and d.user_id = auth.uid()
      and d.id = public.mobile_claimed_device_id()
      and d.auth_session_id::text = auth.jwt() ->> 'session_id'
      and pd.revoked_at is null
      and d.revoked_at is null
      and dk.retired_at is null
      and dk.revoked_at is null
  )
$$;

-- Narrow boolean authority seam used by the Realtime Session Gateway. The
-- caller's identity comes only from the verified user JWT and its session-bound
-- device claim; the gateway does not need a service-role credential.
create or replace function public.authorize_realtime_session(
  p_project_id uuid,
  p_device_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and public.mobile_claimed_device_id() = p_device_id
    and public.mobile_has_active_project_device(p_project_id)
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
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated user required';
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
  p_device_id uuid,
  p_project_id uuid,
  p_min_role public.workspace_role
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
  where p.id = p_project_id and wm.user_id = auth.uid() and pd.revoked_at is null;
  if v_role is null
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
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated user required';
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

create or replace function public.mobile_rotate_device_key(
  p_device_id uuid,
  p_new_key_id uuid,
  p_key_algorithm public.mobile_device_key_algorithm,
  p_public_key bytea
)
returns public.mobile_device_keys
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_device public.mobile_devices;
  v_old public.mobile_device_keys;
  v_new public.mobile_device_keys;
begin
  v_device := public.mobile_assert_active_device(p_device_id);
  if v_device.current_key_id = p_new_key_id then
    select * into v_new from public.mobile_device_keys where id = p_new_key_id;
    if v_new.device_id = p_device_id and v_new.algorithm = p_key_algorithm
       and v_new.public_key = p_public_key and v_new.retired_at is null
       and v_new.revoked_at is null then
      return v_new;
    end if;
    raise exception using errcode = '22000', message = 'Device key rotation idempotency conflict';
  end if;
  select * into v_old from public.mobile_device_keys where id = v_device.current_key_id for update;
  select * into v_new from public.mobile_device_keys where id = p_new_key_id;
  if found then
    if v_new.device_id = p_device_id and v_new.key_version = v_old.key_version + 1
       and v_new.algorithm = p_key_algorithm and v_new.public_key = p_public_key
       and v_device.current_key_id = p_new_key_id then
      return v_new;
    end if;
    raise exception using errcode = '22000', message = 'Device key rotation idempotency conflict';
  end if;
  insert into public.mobile_device_keys (
    id, device_id, key_version, algorithm, public_key, public_key_sha256, rotated_from_key_id
  ) values (
    p_new_key_id, p_device_id, v_old.key_version + 1, p_key_algorithm, p_public_key,
    encode(digest(p_public_key, 'sha256'), 'hex'), v_old.id
  ) returning * into v_new;
  update public.mobile_device_keys set retired_at = now() where id = v_old.id;
  update public.mobile_devices set current_key_id = v_new.id where id = p_device_id;
  return v_new;
end;
$$;

create or replace function public.mobile_list_project_devices(
  p_requesting_device_id uuid,
  p_project_id uuid
)
returns table (
  device_id uuid,
  user_id uuid,
  platform public.mobile_device_platform,
  key_id uuid,
  key_version integer,
  key_algorithm public.mobile_device_key_algorithm,
  public_key bytea,
  public_key_sha256 text,
  project_enrolled_at timestamptz,
  project_revoked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  return query
  select d.id, d.user_id, d.platform, dk.id, dk.key_version, dk.algorithm,
         dk.public_key, dk.public_key_sha256, pd.enrolled_at, pd.revoked_at
  from public.projects p
  join public.workspace_members wm on wm.workspace_id = p.workspace_id
  join public.mobile_devices d on d.user_id = wm.user_id
  join public.mobile_device_keys dk on dk.device_id = d.id and dk.id = d.current_key_id
  left join public.mobile_project_devices pd on pd.project_id = p.id and pd.device_id = d.id
  where p.id = p_project_id and d.revoked_at is null
    and dk.retired_at is null and dk.revoked_at is null
  order by d.enrolled_at, d.id;
end;
$$;

create or replace function public.mobile_enroll_project_device(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_target_device_id uuid
)
returns public.mobile_project_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target public.mobile_devices;
  v_row public.mobile_project_devices;
begin
  perform public.mobile_assert_active_device(p_requesting_device_id);
  if not public.mobile_has_project_role(p_project_id, 'editor') then
    raise exception using errcode = '42501', message = 'Project editor role required';
  end if;
  -- Serialize enrollment inserts with atomic project-key rotation's recipient
  -- set capture. Revocation and device/key rotation serialize on the existing
  -- project-device, device, and key rows locked by that RPC.
  perform 1 from public.projects
    where id = p_project_id and status = 'active'
    for update;
  if not found then
    raise exception using errcode = '55000', message = 'Active project required';
  end if;
  select d.* into v_target
  from public.mobile_devices d
  join public.mobile_device_keys dk on dk.device_id = d.id and dk.id = d.current_key_id
  join public.projects p on p.id = p_project_id
  join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = d.user_id
  where d.id = p_target_device_id and d.revoked_at is null
    and dk.retired_at is null and dk.revoked_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'Target device is not an active project member device';
  end if;
  insert into public.mobile_project_devices (project_id, device_id, enrolled_by_device_id)
  values (p_project_id, p_target_device_id, p_requesting_device_id)
  on conflict (project_id, device_id) do nothing;
  select * into v_row from public.mobile_project_devices
    where project_id = p_project_id and device_id = p_target_device_id;
  if v_row.revoked_at is not null then
    raise exception using errcode = '42501', message = 'Revoked project device cannot be re-enrolled';
  end if;
  return v_row;
end;
$$;

create or replace function public.mobile_revoke_project_device(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_target_device_id uuid,
  p_reason_code text
)
returns public.mobile_project_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.mobile_project_devices;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if p_reason_code is null or p_reason_code !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Valid revocation reason code required';
  end if;
  update public.mobile_project_devices
  set revoked_at = now(), revoked_by_device_id = p_requesting_device_id,
      revocation_reason_code = p_reason_code
  where project_id = p_project_id and device_id = p_target_device_id and revoked_at is null
  returning * into v_row;
  if not found then
    raise exception using errcode = '42501', message = 'Active project device not found';
  end if;
  -- Force a new project key before another snapshot can be published. Existing
  -- immutable outbox items may still reference an older key for conflict review.
  update public.mobile_project_key_versions
    set retired_at = now()
    where project_id = p_project_id and retired_at is null;
  return v_row;
end;
$$;

create or replace function public.mobile_revoke_device(
  p_requesting_device_id uuid,
  p_target_device_id uuid,
  p_reason_code text
)
returns public.mobile_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_requester public.mobile_devices; v_row public.mobile_devices;
begin
  v_requester := public.mobile_assert_active_device(p_requesting_device_id);
  if p_reason_code is null or p_reason_code !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Valid revocation reason code required';
  end if;
  update public.mobile_devices
  set revoked_at = now(), revocation_reason_code = p_reason_code
  where id = p_target_device_id and user_id = v_requester.user_id and revoked_at is null
  returning * into v_row;
  if not found then
    raise exception using errcode = '42501', message = 'Active owned target device not found';
  end if;
  update public.mobile_project_key_versions kv
    set retired_at = now()
    where kv.retired_at is null
      and exists (
        select 1 from public.mobile_project_devices pd
        where pd.project_id = kv.project_id
          and pd.device_id = p_target_device_id
          and pd.revoked_at is null
      );
  update public.mobile_device_keys set retired_at = coalesce(retired_at, now()), revoked_at = now()
    where device_id = p_target_device_id and revoked_at is null;
  update public.mobile_project_devices
    set revoked_at = now(), revoked_by_device_id = p_requesting_device_id,
        revocation_reason_code = p_reason_code
    where device_id = p_target_device_id and revoked_at is null;
  return v_row;
end;
$$;

create or replace function public.mobile_begin_project_key_rotation(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_expected_previous_version integer,
  p_reason_code text
)
returns public.mobile_project_key_versions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_previous integer; v_row public.mobile_project_key_versions;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if p_reason_code is null or p_reason_code !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Valid key rotation reason code required';
  end if;
  perform 1 from public.projects where id = p_project_id and status = 'active' for update;
  if not found then
    raise exception using errcode = '55000', message = 'Active project required';
  end if;
  select coalesce(max(key_version), 0) into v_previous
    from public.mobile_project_key_versions where project_id = p_project_id;
  if v_previous <> p_expected_previous_version then
    raise exception using errcode = '40001', message = 'Project key version changed';
  end if;
  update public.mobile_project_key_versions set retired_at = now()
    where project_id = p_project_id and retired_at is null;
  insert into public.mobile_project_key_versions (
    project_id, key_version, created_by_device_id, rotation_reason_code
  ) values (p_project_id, v_previous + 1, p_requesting_device_id, p_reason_code)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.mobile_put_project_key_envelope(
  p_requesting_device_id uuid,
  p_envelope_id uuid,
  p_project_id uuid,
  p_key_version integer,
  p_recipient_device_id uuid,
  p_recipient_key_id uuid,
  p_algorithm public.mobile_envelope_algorithm,
  p_sealed_project_key bytea,
  p_sealed_project_key_sha256 text
)
returns public.mobile_project_key_envelopes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.mobile_project_key_envelopes; v_key_algorithm public.mobile_device_key_algorithm;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if not exists (select 1 from public.mobile_project_key_versions where project_id = p_project_id and key_version = p_key_version and retired_at is null) then
    raise exception using errcode = '55000', message = 'Active project key version required';
  end if;
  select dk.algorithm into v_key_algorithm
  from public.mobile_project_devices pd
  join public.mobile_devices d on d.id = pd.device_id
  join public.mobile_device_keys dk on dk.device_id = d.id and dk.id = d.current_key_id
  where pd.project_id = p_project_id and pd.device_id = p_recipient_device_id
    and pd.revoked_at is null and d.revoked_at is null
    and dk.id = p_recipient_key_id and dk.retired_at is null and dk.revoked_at is null;
  if v_key_algorithm is null
     or v_key_algorithm <> 'x25519-v1'
     or p_algorithm <> 'x25519-xsalsa20-poly1305-sealedbox-v1' then
    raise exception using errcode = '42501', message = 'Active recipient project device key required';
  end if;
  if octet_length(p_sealed_project_key) <> 80 then
    raise exception using errcode = '22023', message = 'Sealed project key must be exactly 80 bytes';
  end if;
  if p_sealed_project_key_sha256 <> encode(digest(p_sealed_project_key, 'sha256'), 'hex') then
    raise exception using errcode = '22000', message = 'Sealed project key digest mismatch';
  end if;
  insert into public.mobile_project_key_envelopes (
    id, project_id, key_version, recipient_device_id, recipient_key_id,
    sender_device_id, algorithm, sealed_project_key, sealed_project_key_sha256
  ) values (
    p_envelope_id, p_project_id, p_key_version, p_recipient_device_id, p_recipient_key_id,
    p_requesting_device_id, p_algorithm, p_sealed_project_key, p_sealed_project_key_sha256
  ) on conflict (id) do nothing;
  select * into v_row from public.mobile_project_key_envelopes where id = p_envelope_id;
  if v_row.project_id <> p_project_id or v_row.key_version <> p_key_version
     or v_row.recipient_device_id <> p_recipient_device_id or v_row.recipient_key_id <> p_recipient_key_id
     or v_row.sender_device_id <> p_requesting_device_id or v_row.algorithm <> p_algorithm
     or v_row.sealed_project_key <> p_sealed_project_key
     or v_row.sealed_project_key_sha256 <> p_sealed_project_key_sha256 then
    raise exception using errcode = '22000', message = 'Key envelope idempotency conflict';
  end if;
  return v_row;
end;
$$;

-- Atomically creates one project key version and exactly one independently
-- sealed copy of its 32-byte key for every currently active enrolled device.
-- sealed_project_key_hex is lowercase hex for the complete 80-byte
-- crypto_box_seal output; no project-key plaintext or external nonce is sent.
create or replace function public.mobile_rotate_project_key_with_envelopes(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_expected_previous_version integer,
  p_reason_code text,
  p_envelopes jsonb
)
returns public.mobile_project_key_versions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_previous integer;
  v_item jsonb;
  v_version public.mobile_project_key_versions;
  v_expected_keys constant text[] := array[
    'algorithm', 'envelope_id', 'recipient_device_id', 'recipient_key_id',
    'sealed_project_key_hex', 'sealed_project_key_sha256'
  ];
begin
  perform public.mobile_assert_project_device(
    p_requesting_device_id, p_project_id, 'editor'
  );
  if p_expected_previous_version is null or p_expected_previous_version < 0 then
    raise exception using errcode = '22023', message = 'Expected previous key version must be nonnegative';
  end if;
  if p_reason_code is null or p_reason_code !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Valid key rotation reason code required';
  end if;
  if p_envelopes is null or jsonb_typeof(p_envelopes) <> 'array'
     or jsonb_array_length(p_envelopes) = 0 then
    raise exception using errcode = '22023', message = 'Nonempty project key envelope array required';
  end if;

  -- Serialize enrollment, revocation, device-key rotation, and project-key
  -- rotation around the recipient set captured by this transaction.
  perform 1 from public.projects
    where id = p_project_id and status = 'active'
    for update;
  if not found then
    raise exception using errcode = '55000', message = 'Active project required';
  end if;
  perform 1 from public.mobile_project_devices
    where project_id = p_project_id and revoked_at is null
    for update;
  perform 1
    from public.mobile_devices d
    join public.mobile_project_devices pd on pd.device_id = d.id
    where pd.project_id = p_project_id and pd.revoked_at is null
    for update of d;
  perform 1
    from public.mobile_device_keys dk
    join public.mobile_devices d on d.id = dk.device_id and d.current_key_id = dk.id
    join public.mobile_project_devices pd on pd.device_id = d.id
    where pd.project_id = p_project_id and pd.revoked_at is null
    for update of dk;

  select coalesce(max(key_version), 0) into v_previous
  from public.mobile_project_key_versions where project_id = p_project_id;
  if v_previous <> p_expected_previous_version then
    raise exception using errcode = '40001', message = 'Project key version changed';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_envelopes) as envelope(value)
    where jsonb_typeof(value) <> 'object'
       or (select array_agg(key order by key) from jsonb_object_keys(value) as keys(key))
          is distinct from v_expected_keys
  ) then
    raise exception using errcode = '22023', message = 'Project key envelope fields are invalid';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_envelopes) as envelope(value)
    where coalesce(value ->> 'envelope_id', '')
            !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(value ->> 'recipient_device_id', '')
            !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(value ->> 'recipient_key_id', '')
            !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(value ->> 'algorithm', '')
            <> 'x25519-xsalsa20-poly1305-sealedbox-v1'
       or coalesce(value ->> 'sealed_project_key_hex', '') !~ '^[0-9a-f]{160}$'
       or coalesce(value ->> 'sealed_project_key_sha256', '') !~ '^[0-9a-f]{64}$'
  ) then
    raise exception using errcode = '22023', message = 'Project key envelope values are invalid';
  end if;

  if (
    select count(*) <> count(distinct value ->> 'envelope_id')
        or count(*) <> count(distinct value ->> 'recipient_device_id')
        or count(*) <> count(distinct value ->> 'recipient_key_id')
    from jsonb_array_elements(p_envelopes) as envelope(value)
  ) then
    raise exception using errcode = '22023', message = 'Duplicate project key envelope identity';
  end if;

  -- Bidirectional set comparison rejects missing, extra, unenrolled, revoked,
  -- retired-key, and stale-current-key recipients.
  if exists (
    with supplied as (
      select (value ->> 'recipient_device_id')::uuid as device_id,
             (value ->> 'recipient_key_id')::uuid as key_id
      from jsonb_array_elements(p_envelopes) as envelope(value)
    ), active as (
      select pd.device_id, dk.id as key_id
      from public.mobile_project_devices pd
      join public.mobile_devices d on d.id = pd.device_id
      join public.mobile_device_keys dk
        on dk.device_id = d.id and dk.id = d.current_key_id
      where pd.project_id = p_project_id
        and pd.revoked_at is null and d.revoked_at is null
        and dk.retired_at is null and dk.revoked_at is null
    )
    select 1 from supplied s
    left join active a on a.device_id = s.device_id and a.key_id = s.key_id
    where a.device_id is null
  ) or exists (
    with supplied as (
      select (value ->> 'recipient_device_id')::uuid as device_id,
             (value ->> 'recipient_key_id')::uuid as key_id
      from jsonb_array_elements(p_envelopes) as envelope(value)
    ), active as (
      select pd.device_id, dk.id as key_id
      from public.mobile_project_devices pd
      join public.mobile_devices d on d.id = pd.device_id
      join public.mobile_device_keys dk
        on dk.device_id = d.id and dk.id = d.current_key_id
      where pd.project_id = p_project_id
        and pd.revoked_at is null and d.revoked_at is null
        and dk.retired_at is null and dk.revoked_at is null
    )
    select 1 from active a
    left join supplied s on s.device_id = a.device_id and s.key_id = a.key_id
    where s.device_id is null
  ) then
    raise exception using errcode = '42501', message = 'Envelope recipients must equal active enrolled project devices';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_envelopes) as envelope(value)
    where value ->> 'sealed_project_key_sha256'
       <> encode(digest(decode(value ->> 'sealed_project_key_hex', 'hex'), 'sha256'), 'hex')
  ) then
    raise exception using errcode = '22000', message = 'Sealed project key digest mismatch';
  end if;

  v_version := public.mobile_begin_project_key_rotation(
    p_requesting_device_id, p_project_id, p_expected_previous_version, p_reason_code
  );
  for v_item in select value from jsonb_array_elements(p_envelopes) as envelope(value)
  loop
    perform public.mobile_put_project_key_envelope(
      p_requesting_device_id,
      (v_item ->> 'envelope_id')::uuid,
      p_project_id,
      v_version.key_version,
      (v_item ->> 'recipient_device_id')::uuid,
      (v_item ->> 'recipient_key_id')::uuid,
      (v_item ->> 'algorithm')::public.mobile_envelope_algorithm,
      decode(v_item ->> 'sealed_project_key_hex', 'hex'),
      v_item ->> 'sealed_project_key_sha256'
    );
  end loop;
  return v_version;
end;
$$;

create or replace function public.mobile_get_project_key_envelopes(
  p_requesting_device_id uuid,
  p_project_id uuid
)
returns setof public.mobile_project_key_envelopes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_device public.mobile_devices;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'viewer');
  select * into v_device from public.mobile_devices where id = p_requesting_device_id;
  return query select e.* from public.mobile_project_key_envelopes e
    where e.project_id = p_project_id
      and e.recipient_device_id = p_requesting_device_id
      and e.recipient_key_id = v_device.current_key_id
    order by e.key_version desc;
end;
$$;

create or replace function public.mobile_publish_snapshot(
  p_requesting_device_id uuid,
  p_snapshot_id uuid,
  p_project_id uuid,
  p_project_revision text,
  p_key_version integer,
  p_schema_version integer,
  p_object_bucket text,
  p_object_path text,
  p_object_byte_length bigint,
  p_object_sha256 text,
  p_manifest_algorithm public.mobile_cipher_algorithm,
  p_manifest_nonce bytea,
  p_manifest_ciphertext bytea,
  p_manifest_ciphertext_sha256 text
)
returns public.mobile_snapshot_manifests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.mobile_snapshot_manifests; v_device public.mobile_devices;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  select * into v_device from public.mobile_devices where id = p_requesting_device_id;
  if not exists (select 1 from public.projects where id = p_project_id and status = 'active')
     or not exists (select 1 from public.mobile_project_key_versions where project_id = p_project_id and key_version = p_key_version and retired_at is null)
     or not exists (select 1 from public.mobile_project_key_envelopes where project_id = p_project_id and key_version = p_key_version and recipient_device_id = p_requesting_device_id and recipient_key_id = v_device.current_key_id) then
    raise exception using errcode = '42501', message = 'Active project key access required';
  end if;
  if p_object_path <> 'projects/' || p_project_id::text || '/snapshots/' || p_snapshot_id::text || '.bin' then
    raise exception using errcode = '22023', message = 'Invalid project-scoped object path';
  end if;
  if p_manifest_ciphertext_sha256 <> encode(digest(p_manifest_ciphertext, 'sha256'), 'hex') then
    raise exception using errcode = '22000', message = 'Manifest ciphertext digest mismatch';
  end if;
  insert into public.mobile_snapshot_manifests (
    snapshot_id, project_id, project_revision, key_version, schema_version,
    object_bucket, object_path, object_byte_length, object_sha256,
    manifest_algorithm, manifest_nonce, manifest_ciphertext, manifest_ciphertext_sha256,
    created_by_device_id
  ) values (
    p_snapshot_id, p_project_id, p_project_revision, p_key_version, p_schema_version,
    p_object_bucket, p_object_path, p_object_byte_length, p_object_sha256,
    p_manifest_algorithm, p_manifest_nonce, p_manifest_ciphertext, p_manifest_ciphertext_sha256,
    p_requesting_device_id
  ) on conflict (snapshot_id) do nothing;
  select * into v_row from public.mobile_snapshot_manifests where snapshot_id = p_snapshot_id;
  if v_row.project_id <> p_project_id or v_row.project_revision <> p_project_revision
     or v_row.key_version <> p_key_version or v_row.schema_version <> p_schema_version
     or v_row.object_bucket <> p_object_bucket or v_row.object_path <> p_object_path
     or v_row.object_byte_length <> p_object_byte_length or v_row.object_sha256 <> p_object_sha256
     or v_row.manifest_algorithm <> p_manifest_algorithm or v_row.manifest_nonce <> p_manifest_nonce
     or v_row.manifest_ciphertext <> p_manifest_ciphertext
     or v_row.manifest_ciphertext_sha256 <> p_manifest_ciphertext_sha256
     or v_row.created_by_device_id <> p_requesting_device_id then
    raise exception using errcode = '22000', message = 'Snapshot idempotency conflict';
  end if;
  return v_row;
end;
$$;

create or replace function public.mobile_list_snapshot_manifests(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_limit integer default 20
)
returns setof public.mobile_snapshot_manifests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_device public.mobile_devices;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'viewer');
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'Limit must be between 1 and 100';
  end if;
  select * into v_device from public.mobile_devices where id = p_requesting_device_id;
  return query
    select s.* from public.mobile_snapshot_manifests s
    where s.project_id = p_project_id
      and exists (
        select 1 from public.mobile_project_key_envelopes e
        where e.project_id = s.project_id and e.key_version = s.key_version
          and e.recipient_device_id = p_requesting_device_id
          and e.recipient_key_id = v_device.current_key_id
      )
    order by s.created_at desc, s.snapshot_id desc limit p_limit;
end;
$$;

-- Storage object deletion is intentionally not performed from SQL. A trusted
-- lifecycle worker must call this RPC while the owner membership and active
-- device binding still exist, delete every returned object through the
-- Supabase Storage API, verify completion, and only then delete the project.
-- Account deletion must run the same workflow for each owned project first.
create or replace function public.mobile_list_project_snapshot_cleanup_paths(
  p_requesting_device_id uuid,
  p_project_id uuid
)
returns table (
  object_bucket text,
  object_path text,
  object_sha256 text,
  object_byte_length bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.mobile_assert_project_device(
    p_requesting_device_id, p_project_id, 'owner'
  );
  return query
    select s.object_bucket, s.object_path, s.object_sha256, s.object_byte_length
    from public.mobile_snapshot_manifests s
    where s.project_id = p_project_id
    order by s.object_path;
end;
$$;

create or replace function public.mobile_ack_snapshot(
  p_requesting_device_id uuid,
  p_snapshot_id uuid,
  p_acknowledgement public.mobile_snapshot_ack_kind
)
returns public.mobile_snapshot_acknowledgements
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_snapshot public.mobile_snapshot_manifests; v_device public.mobile_devices; v_row public.mobile_snapshot_acknowledgements;
begin
  select * into v_snapshot from public.mobile_snapshot_manifests where snapshot_id = p_snapshot_id;
  if not found then raise exception using errcode = '42501', message = 'Authorized snapshot required'; end if;
  perform public.mobile_assert_project_device(p_requesting_device_id, v_snapshot.project_id, 'viewer');
  select * into v_device from public.mobile_devices where id = p_requesting_device_id;
  if not exists (select 1 from public.mobile_project_key_envelopes where project_id = v_snapshot.project_id and key_version = v_snapshot.key_version and recipient_device_id = p_requesting_device_id and recipient_key_id = v_device.current_key_id) then
    raise exception using errcode = '42501', message = 'Snapshot key envelope required';
  end if;
  insert into public.mobile_snapshot_acknowledgements (snapshot_id, project_id, device_id, acknowledgement)
  values (p_snapshot_id, v_snapshot.project_id, p_requesting_device_id, p_acknowledgement)
  on conflict (snapshot_id, device_id) do nothing;
  select * into v_row from public.mobile_snapshot_acknowledgements where snapshot_id = p_snapshot_id and device_id = p_requesting_device_id;
  if v_row.acknowledgement <> p_acknowledgement then
    raise exception using errcode = '22000', message = 'Snapshot acknowledgement idempotency conflict';
  end if;
  return v_row;
end;
$$;

create or replace function public.mobile_append_outbox(
  p_requesting_device_id uuid,
  p_operation_id uuid,
  p_project_id uuid,
  p_key_version integer,
  p_base_project_revision text,
  p_operation_type public.mobile_outbox_operation_type,
  p_client_created_at timestamptz,
  p_algorithm public.mobile_cipher_algorithm,
  p_nonce bytea,
  p_ciphertext bytea,
  p_ciphertext_sha256 text
)
returns public.mobile_outbox_envelopes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_device public.mobile_devices; v_row public.mobile_outbox_envelopes;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  select * into v_device from public.mobile_devices where id = p_requesting_device_id;
  if p_client_created_at is null or p_client_created_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Invalid client creation time';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id and status = 'active')
     or not exists (select 1 from public.mobile_project_key_versions where project_id = p_project_id and key_version = p_key_version)
     or not exists (select 1 from public.mobile_project_key_envelopes where project_id = p_project_id and key_version = p_key_version and recipient_device_id = p_requesting_device_id and recipient_key_id = v_device.current_key_id) then
    raise exception using errcode = '42501', message = 'Project key access required';
  end if;
  if p_ciphertext_sha256 <> encode(digest(p_ciphertext, 'sha256'), 'hex') then
    raise exception using errcode = '22000', message = 'Outbox ciphertext digest mismatch';
  end if;
  insert into public.mobile_outbox_envelopes (
    operation_id, project_id, source_device_id, key_version, base_project_revision,
    operation_type, client_created_at, algorithm, nonce, ciphertext, ciphertext_sha256
  ) values (
    p_operation_id, p_project_id, p_requesting_device_id, p_key_version, p_base_project_revision,
    p_operation_type, p_client_created_at, p_algorithm, p_nonce, p_ciphertext, p_ciphertext_sha256
  ) on conflict (operation_id) do nothing;
  select * into v_row from public.mobile_outbox_envelopes where operation_id = p_operation_id;
  if v_row.project_id <> p_project_id or v_row.source_device_id <> p_requesting_device_id
     or v_row.key_version <> p_key_version or v_row.base_project_revision <> p_base_project_revision
     or v_row.operation_type <> p_operation_type or v_row.client_created_at <> p_client_created_at
     or v_row.algorithm <> p_algorithm or v_row.nonce <> p_nonce
     or v_row.ciphertext <> p_ciphertext or v_row.ciphertext_sha256 <> p_ciphertext_sha256 then
    raise exception using errcode = '22000', message = 'Outbox idempotency conflict';
  end if;
  return v_row;
end;
$$;

create or replace function public.mobile_list_outbox(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_after_received_at timestamptz default null,
  p_after_operation_id uuid default null,
  p_limit integer default 100
)
returns setof public.mobile_outbox_envelopes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'Limit must be between 1 and 500';
  end if;
  if (p_after_received_at is null) <> (p_after_operation_id is null) then
    raise exception using errcode = '22023', message = 'Complete outbox cursor required';
  end if;
  return query select o.* from public.mobile_outbox_envelopes o
    where o.project_id = p_project_id
      and (
        p_after_received_at is null
        or (o.received_at, o.operation_id) > (p_after_received_at, p_after_operation_id)
      )
      and not exists (
        select 1 from public.mobile_outbox_acknowledgements a
        where a.operation_id = o.operation_id and a.device_id = p_requesting_device_id
      )
    order by o.received_at, o.operation_id limit p_limit;
end;
$$;

create or replace function public.mobile_ack_outbox(
  p_requesting_device_id uuid,
  p_operation_id uuid,
  p_status public.mobile_outbox_ack_status
)
returns public.mobile_outbox_acknowledgements
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_project_id uuid; v_row public.mobile_outbox_acknowledgements;
begin
  select project_id into v_project_id from public.mobile_outbox_envelopes where operation_id = p_operation_id;
  if v_project_id is null then raise exception using errcode = '42501', message = 'Authorized outbox operation required'; end if;
  perform public.mobile_assert_project_device(p_requesting_device_id, v_project_id, 'editor');
  insert into public.mobile_outbox_acknowledgements (operation_id, project_id, device_id, status)
  values (p_operation_id, v_project_id, p_requesting_device_id, p_status)
  on conflict (operation_id, device_id) do nothing;
  select * into v_row from public.mobile_outbox_acknowledgements where operation_id = p_operation_id and device_id = p_requesting_device_id;
  if v_row.status <> p_status then
    raise exception using errcode = '22000', message = 'Outbox acknowledgement idempotency conflict';
  end if;
  return v_row;
end;
$$;

alter table public.mobile_devices enable row level security;
alter table public.mobile_device_session_bindings enable row level security;
alter table public.mobile_device_keys enable row level security;
alter table public.mobile_project_devices enable row level security;
alter table public.mobile_project_key_versions enable row level security;
alter table public.mobile_project_key_envelopes enable row level security;
alter table public.mobile_snapshot_manifests enable row level security;
alter table public.mobile_snapshot_acknowledgements enable row level security;
alter table public.mobile_outbox_envelopes enable row level security;
alter table public.mobile_outbox_acknowledgements enable row level security;

create policy mobile_devices_owner_select on public.mobile_devices
for select using (
  user_id = auth.uid() and id = public.mobile_claimed_device_id() and revoked_at is null
);
create policy mobile_device_keys_owner_select on public.mobile_device_keys
for select using (exists (
  select 1 from public.mobile_devices d
  where d.id = device_id and d.user_id = auth.uid()
    and d.id = public.mobile_claimed_device_id() and d.revoked_at is null
));
create policy mobile_project_devices_member_select on public.mobile_project_devices
for select using (public.mobile_has_project_role(project_id, 'viewer') and public.mobile_has_active_project_device(project_id));
create policy mobile_project_key_versions_member_select on public.mobile_project_key_versions
for select using (public.mobile_has_project_role(project_id, 'viewer') and public.mobile_has_active_project_device(project_id));
create policy mobile_project_key_envelopes_recipient_select on public.mobile_project_key_envelopes
for select using (
  public.mobile_has_project_role(project_id, 'viewer')
  and exists (
    select 1 from public.mobile_devices d
    join public.mobile_project_devices pd on pd.device_id = d.id and pd.project_id = mobile_project_key_envelopes.project_id
    where d.id = recipient_device_id and d.user_id = auth.uid()
      and d.id = public.mobile_claimed_device_id()
      and d.revoked_at is null and pd.revoked_at is null and d.current_key_id = recipient_key_id
  )
);
create policy mobile_snapshot_manifests_member_select on public.mobile_snapshot_manifests
for select using (public.mobile_has_project_role(project_id, 'viewer') and public.mobile_has_active_project_device(project_id));
create policy mobile_snapshot_acknowledgements_member_select on public.mobile_snapshot_acknowledgements
for select using (public.mobile_has_project_role(project_id, 'viewer') and public.mobile_has_active_project_device(project_id));
create policy mobile_outbox_envelopes_editor_select on public.mobile_outbox_envelopes
for select using (public.mobile_has_project_role(project_id, 'editor') and public.mobile_has_active_project_device(project_id));
create policy mobile_outbox_acknowledgements_editor_select on public.mobile_outbox_acknowledgements
for select using (
  public.mobile_has_project_role(project_id, 'editor')
  and public.mobile_has_active_project_device(project_id)
);

revoke all on table public.mobile_devices from anon, authenticated;
revoke all on table public.mobile_device_session_bindings from anon, authenticated;
revoke all on table public.mobile_device_keys from anon, authenticated;
revoke all on table public.mobile_project_devices from anon, authenticated;
revoke all on table public.mobile_project_key_versions from anon, authenticated;
revoke all on table public.mobile_project_key_envelopes from anon, authenticated;
revoke all on table public.mobile_snapshot_manifests from anon, authenticated;
revoke all on table public.mobile_snapshot_acknowledgements from anon, authenticated;
revoke all on table public.mobile_outbox_envelopes from anon, authenticated;
revoke all on table public.mobile_outbox_acknowledgements from anon, authenticated;

revoke execute on function public.mobile_reject_ciphertext_update() from public, anon, authenticated;
revoke execute on function public.mobile_has_project_role(uuid, public.workspace_role) from public, anon;
revoke execute on function public.mobile_claimed_device_id() from public, anon;
revoke execute on function public.mobile_custom_access_token_hook(jsonb) from public, anon, authenticated;
revoke execute on function public.mobile_has_active_project_device(uuid) from public, anon;
revoke execute on function public.authorize_realtime_session(uuid, uuid) from public, anon;
revoke execute on function public.mobile_assert_active_device(uuid) from public, anon, authenticated;
revoke execute on function public.mobile_assert_project_device(uuid, uuid, public.workspace_role) from public, anon, authenticated;
revoke execute on function public.mobile_register_device(uuid, uuid, public.mobile_device_platform, text, public.mobile_device_key_algorithm, bytea) from public, anon;
revoke execute on function public.mobile_rotate_device_key(uuid, uuid, public.mobile_device_key_algorithm, bytea) from public, anon, authenticated;
revoke execute on function public.mobile_enroll_project_device(uuid, uuid, uuid) from public, anon;
revoke execute on function public.mobile_list_project_devices(uuid, uuid) from public, anon;
revoke execute on function public.mobile_revoke_project_device(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.mobile_revoke_device(uuid, uuid, text) from public, anon;
revoke execute on function public.mobile_begin_project_key_rotation(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.mobile_put_project_key_envelope(uuid, uuid, uuid, integer, uuid, uuid, public.mobile_envelope_algorithm, bytea, text) from public, anon, authenticated;
revoke execute on function public.mobile_rotate_project_key_with_envelopes(uuid, uuid, integer, text, jsonb) from public, anon;
revoke execute on function public.mobile_get_project_key_envelopes(uuid, uuid) from public, anon;
revoke execute on function public.mobile_publish_snapshot(uuid, uuid, uuid, text, integer, integer, text, text, bigint, text, public.mobile_cipher_algorithm, bytea, bytea, text) from public, anon;
revoke execute on function public.mobile_list_snapshot_manifests(uuid, uuid, integer) from public, anon;
revoke execute on function public.mobile_list_project_snapshot_cleanup_paths(uuid, uuid) from public, anon;
revoke execute on function public.mobile_ack_snapshot(uuid, uuid, public.mobile_snapshot_ack_kind) from public, anon;
revoke execute on function public.mobile_append_outbox(uuid, uuid, uuid, integer, text, public.mobile_outbox_operation_type, timestamptz, public.mobile_cipher_algorithm, bytea, bytea, text) from public, anon;
revoke execute on function public.mobile_list_outbox(uuid, uuid, timestamptz, uuid, integer) from public, anon;
revoke execute on function public.mobile_ack_outbox(uuid, uuid, public.mobile_outbox_ack_status) from public, anon;

grant execute on function public.mobile_has_project_role(uuid, public.workspace_role) to authenticated;
grant execute on function public.mobile_claimed_device_id() to authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.mobile_custom_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function public.mobile_has_active_project_device(uuid) to authenticated;
grant execute on function public.authorize_realtime_session(uuid, uuid) to authenticated;
grant execute on function public.mobile_register_device(uuid, uuid, public.mobile_device_platform, text, public.mobile_device_key_algorithm, bytea) to authenticated;
grant execute on function public.mobile_enroll_project_device(uuid, uuid, uuid) to authenticated;
grant execute on function public.mobile_list_project_devices(uuid, uuid) to authenticated;
grant execute on function public.mobile_revoke_project_device(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.mobile_revoke_device(uuid, uuid, text) to authenticated;
grant execute on function public.mobile_rotate_project_key_with_envelopes(uuid, uuid, integer, text, jsonb) to authenticated;
grant execute on function public.mobile_get_project_key_envelopes(uuid, uuid) to authenticated;
grant execute on function public.mobile_publish_snapshot(uuid, uuid, uuid, text, integer, integer, text, text, bigint, text, public.mobile_cipher_algorithm, bytea, bytea, text) to authenticated;
grant execute on function public.mobile_list_snapshot_manifests(uuid, uuid, integer) to authenticated;
grant execute on function public.mobile_list_project_snapshot_cleanup_paths(uuid, uuid) to authenticated;
grant execute on function public.mobile_ack_snapshot(uuid, uuid, public.mobile_snapshot_ack_kind) to authenticated;
grant execute on function public.mobile_append_outbox(uuid, uuid, uuid, integer, text, public.mobile_outbox_operation_type, timestamptz, public.mobile_cipher_algorithm, bytea, bytea, text) to authenticated;
grant execute on function public.mobile_list_outbox(uuid, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.mobile_ack_outbox(uuid, uuid, public.mobile_outbox_ack_status) to authenticated;

comment on table public.mobile_snapshot_manifests is
  'Ciphertext-only snapshot metadata; object bytes are in a private Storage bucket.';
comment on table public.mobile_outbox_envelopes is
  'Immutable client-encrypted mobile operations; never stores plaintext operation content.';
comment on function public.mobile_custom_access_token_hook(jsonb) is
  'Enable as the Supabase Auth Custom Access Token Hook; binds claims.device_id to one active registered auth session.';
comment on function public.mobile_list_project_snapshot_cleanup_paths(uuid, uuid) is
  'Owner-only exact Storage cleanup manifest. External lifecycle code must delete these objects before deleting a project/account; SQL never deletes storage.objects directly.';

-- The follow-on 20260830193000 migration installs the private Storage bucket
-- and its RLS policies when the Supabase Storage schema is available.
