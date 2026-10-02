-- pgTAP-free transactional smoke tests for mobile encrypted sync.
-- Run after applying all migrations, for example:
--   supabase db reset
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/mobile_encrypted_sync_rls.sql
-- Every fixture and assertion is rolled back.

begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.authenticate_as(
  p_user_id uuid,
  p_device_id uuid default null,
  p_session_id uuid default null
)
returns void
language plpgsql
as $$
declare
  v_session_id uuid;
begin
  v_session_id := coalesce(p_session_id, case
    when p_device_id = '40000000-0000-0000-0000-000000000001' then '90000000-0000-0000-0000-000000000005'::uuid
    when p_device_id = '40000000-0000-0000-0000-000000000002' then '90000000-0000-0000-0000-000000000002'::uuid
    when p_device_id = '40000000-0000-0000-0000-000000000003' then '90000000-0000-0000-0000-000000000003'::uuid
    when p_device_id = '40000000-0000-0000-0000-000000000004' then '90000000-0000-0000-0000-000000000004'::uuid
    when p_user_id = '10000000-0000-0000-0000-000000000001' then '90000000-0000-0000-0000-000000000001'::uuid
    when p_user_id = '10000000-0000-0000-0000-000000000002' then '90000000-0000-0000-0000-000000000003'::uuid
    else '90000000-0000-0000-0000-000000000004'::uuid
  end);
  perform set_config(
    'request.jwt.claims',
    (jsonb_build_object('sub', p_user_id, 'role', 'authenticated', 'session_id', v_session_id)
      || case when p_device_id is null then '{}'::jsonb
              else jsonb_build_object('device_id', p_device_id) end)::text,
    true
  );
end;
$$;

-- Auth fixtures use the minimum GoTrue-compatible user shape required by the
-- existing workspace_members foreign key.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'mobile-owner@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'mobile-viewer@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'mobile-outsider@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into auth.sessions (id, user_id)
values
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('90000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002'),
  ('90000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003'),
  ('90000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001'),
  ('90000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001');

insert into public.workspaces (id, name, slug)
values
  ('20000000-0000-0000-0000-000000000001', 'Mobile Test', 'mobile-test'),
  ('20000000-0000-0000-0000-000000000002', 'Other Test', 'other-test');

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'viewer'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'owner');

insert into public.projects (id, workspace_id, name, slug, created_by)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'Encrypted Book', 'encrypted-book', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
   'Other Book', 'other-book', '10000000-0000-0000-0000-000000000003');

set local role authenticated;
select pg_temp.authenticate_as('10000000-0000-0000-0000-000000000001');

-- The app role has no direct table path; all access must carry an explicit,
-- active requesting device through a checked RPC.
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.mobile_snapshot_manifests', 'SELECT'),
  'authenticated must not select snapshot metadata directly'
);
select pg_temp.assert_true(
  not has_table_privilege(
    'authenticated', 'public.mobile_device_session_bindings', 'SELECT'
  ),
  'authenticated must not inspect device Auth-session binding history directly'
);
select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated', 'public.mobile_custom_access_token_hook(jsonb)', 'EXECUTE'
  ),
  'clients must not execute the Auth token hook'
);
select pg_temp.assert_true(
  has_function_privilege(
    'supabase_auth_admin', 'public.mobile_custom_access_token_hook(jsonb)', 'EXECUTE'
  ),
  'only the Supabase Auth hook role must execute the token hook'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.mobile_outbox_envelopes', 'INSERT'),
  'authenticated must not insert outbox rows directly'
);
select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.mobile_assert_project_device(uuid,uuid,public.workspace_role)',
    'EXECUTE'
  ),
  'internal authorization helper must not be executable by clients'
);
select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.mobile_rotate_project_key_with_envelopes(uuid,uuid,integer,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.mobile_rotate_project_key_with_envelopes(uuid,uuid,integer,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.mobile_begin_project_key_rotation(uuid,uuid,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.mobile_put_project_key_envelope(uuid,uuid,uuid,integer,uuid,uuid,public.mobile_envelope_algorithm,bytea,text)',
    'EXECUTE'
  ),
  'authenticated clients must rotate only through the atomic RPC'
);
select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.mobile_rotate_device_key(uuid,uuid,public.mobile_device_key_algorithm,bytea)',
    'EXECUTE'
  ),
  'device-key rotation must remain owner-only until atomic project resealing exists'
);
select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.mobile_list_project_snapshot_cleanup_paths(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.mobile_list_project_snapshot_cleanup_paths(uuid,uuid)',
    'EXECUTE'
  ),
  'only authenticated callers may reach the owner-checked cleanup manifest RPC'
);

-- Register two owner-controlled devices. Repeating an identical registration
-- is idempotent and conflicting key material is rejected.
select public.mobile_register_device(
  '40000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'desktop', 'Primary desktop', 'x25519-v1', decode(repeat('11', 32), 'hex')
);
select public.mobile_register_device(
  '40000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'desktop', 'Primary desktop', 'x25519-v1', decode(repeat('11', 32), 'hex')
);

do $$
begin
  begin
    perform public.mobile_register_device(
      '40000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'desktop', 'Primary desktop', 'x25519-v1', decode(repeat('12', 32), 'hex')
    );
    raise exception 'expected idempotency conflict';
  exception
    when sqlstate '22000' then null;
  end;
end;
$$;

-- A second device for the same user must bind to a distinct Auth session.
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001', null,
  '90000000-0000-0000-0000-000000000002'
);
select public.mobile_register_device(
  '40000000-0000-0000-0000-000000000002',
  '41000000-0000-0000-0000-000000000002',
  'ios', 'Owner phone', 'x25519-v1', decode(repeat('22', 32), 'hex')
);
do $$
begin
  begin
    perform public.mobile_register_device(
      '40000000-0000-0000-0000-000000000099',
      '41000000-0000-0000-0000-000000000099',
      'ios', 'Rebind attempt', 'x25519-v1', decode(repeat('99', 32), 'hex')
    );
    raise exception 'Auth session rebinding unexpectedly succeeded';
  exception
    when sqlstate '22000' then null;
  end;
end;
$$;

-- Normal sign-out/sign-in creates a new Auth session. Exact same-user device
-- and key proof may move the binding; any mismatch must leave it unchanged.
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001', null,
  '90000000-0000-0000-0000-000000000005'
);
select public.mobile_register_device(
  '40000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'desktop', 'Primary desktop', 'x25519-v1', decode(repeat('11', 32), 'hex')
);
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001', null,
  '90000000-0000-0000-0000-000000000006'
);
do $$
begin
  begin
    perform public.mobile_register_device(
      '40000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'desktop', 'Mismatched label', 'x25519-v1', decode(repeat('11', 32), 'hex')
    );
    raise exception 'mismatched device rebind unexpectedly succeeded';
  exception
    when sqlstate '22000' then null;
  end;
end;
$$;

select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000002', null,
  '90000000-0000-0000-0000-000000000003'
);
do $$
begin
  begin
    perform public.mobile_register_device(
      '40000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'desktop', 'Primary desktop', 'x25519-v1', decode(repeat('11', 32), 'hex')
    );
    raise exception 'cross-user device takeover unexpectedly succeeded';
  exception
    when sqlstate '22000' then
      if to_regprocedure('public.mobile_account_is_frozen(uuid)') is not null then raise; end if;
    when sqlstate '42501' then
      if to_regprocedure('public.mobile_account_is_frozen(uuid)') is null then raise; end if;
  end;
end;
$$;

reset role;
select pg_temp.assert_true(
  (select user_id = '10000000-0000-0000-0000-000000000001'::uuid
    and auth_session_id = '90000000-0000-0000-0000-000000000005'::uuid
    and current_key_id = '41000000-0000-0000-0000-000000000001'::uuid
    and device_label = 'Primary desktop'
   from public.mobile_devices where id = '40000000-0000-0000-0000-000000000001'),
  'cross-user denial must preserve the original account, Auth session, key and label'
);
set local role supabase_auth_admin;
select pg_temp.assert_true(
  (public.mobile_custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-000000000001',
    'claims', jsonb_build_object('session_id', '90000000-0000-0000-0000-000000000001')
  )) #> '{claims,device_id}') is null,
  'old Auth session must lose its device claim after exact rebinding'
);
select pg_temp.assert_true(
  (public.mobile_custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-000000000001',
    'claims', jsonb_build_object('session_id', '90000000-0000-0000-0000-000000000005')
  )) #>> '{claims,device_id}') = '40000000-0000-0000-0000-000000000001'
  and (public.mobile_custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-000000000001',
    'claims', jsonb_build_object('session_id', '90000000-0000-0000-0000-000000000006')
  )) #> '{claims,device_id}') is null,
  'only the exactly proven new Auth session may receive the desktop device claim'
);
select pg_temp.assert_true(
  (public.mobile_custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-000000000001',
    'claims', jsonb_build_object('session_id', '90000000-0000-0000-0000-000000000002')
  )) #>> '{claims,device_id}') = '40000000-0000-0000-0000-000000000002',
  'second Auth session must receive only its phone device claim'
);
reset role;
set local role authenticated;

select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);

select public.mobile_enroll_project_device(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001'
);
select pg_temp.assert_true(
  not public.authorize_realtime_session(
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001'
  ),
  'stale pre-rebind Auth session must fail Realtime authorization'
);
do $$
begin
  begin
    perform public.mobile_register_device(
      '40000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'desktop', 'Primary desktop', 'x25519-v1', decode(repeat('11', 32), 'hex')
    );
    raise exception 'stale pre-rebind Auth session reclaimed the device';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select public.mobile_enroll_project_device(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002'
);
select pg_temp.assert_true(
  public.authorize_realtime_session(
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001'
  ),
  'Realtime gateway must authorize the JWT-bound active project device'
);
select pg_temp.assert_true(
  not public.authorize_realtime_session(
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002'
  ),
  'Realtime gateway must reject a device different from the signed claim'
);
select pg_temp.assert_true(
  not public.authorize_realtime_session(
    '30000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000001'
  ),
  'Realtime gateway must reject a cross-workspace project'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.mobile_list_project_devices(
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001'
  )),
  'project editor must discover active member device public keys'
);

select pg_temp.assert_true(
  (select key_version = 1 from public.mobile_rotate_project_key_with_envelopes(
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', 0, 'initial-enrollment',
    jsonb_build_array(
      jsonb_build_object(
        'envelope_id', '50000000-0000-0000-0000-000000000001',
        'recipient_device_id', '40000000-0000-0000-0000-000000000001',
        'recipient_key_id', '41000000-0000-0000-0000-000000000001',
        'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
        'sealed_project_key_hex', repeat('a1', 80),
        'sealed_project_key_sha256', encode(digest(decode(repeat('a1', 80), 'hex'), 'sha256'), 'hex')
      ),
      jsonb_build_object(
        'envelope_id', '50000000-0000-0000-0000-000000000002',
        'recipient_device_id', '40000000-0000-0000-0000-000000000002',
        'recipient_key_id', '41000000-0000-0000-0000-000000000002',
        'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
        'sealed_project_key_hex', repeat('a2', 80),
        'sealed_project_key_sha256', encode(digest(decode(repeat('a2', 80), 'hex'), 'sha256'), 'hex')
      )
    )
  )),
  'atomic rotation must publish the first key version and every active recipient envelope'
);

-- The first version insert and first envelope insert occur before the second
-- envelope collides with an immutable v1 envelope id. The exception must roll
-- all of them back rather than leaving a retired v1 or partial v2.
do $$
begin
  begin
    perform public.mobile_rotate_project_key_with_envelopes(
      '40000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001', 1, 'adversarial-retry',
      jsonb_build_array(
        jsonb_build_object(
          'envelope_id', '50000000-0000-0000-0000-000000000011',
          'recipient_device_id', '40000000-0000-0000-0000-000000000001',
          'recipient_key_id', '41000000-0000-0000-0000-000000000001',
          'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
          'sealed_project_key_hex', repeat('b1', 80),
          'sealed_project_key_sha256', encode(digest(decode(repeat('b1', 80), 'hex'), 'sha256'), 'hex')
        ),
        jsonb_build_object(
          'envelope_id', '50000000-0000-0000-0000-000000000002',
          'recipient_device_id', '40000000-0000-0000-0000-000000000002',
          'recipient_key_id', '41000000-0000-0000-0000-000000000002',
          'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
          'sealed_project_key_hex', repeat('b2', 80),
          'sealed_project_key_sha256', encode(digest(decode(repeat('b2', 80), 'hex'), 'sha256'), 'hex')
        )
      )
    );
    raise exception 'invalid atomic rotation unexpectedly succeeded';
  exception
    when sqlstate '22000' then null;
  end;
end;
$$;
reset role;
select pg_temp.assert_true(
  not exists (
    select 1 from public.mobile_project_key_versions
    where project_id = '30000000-0000-0000-0000-000000000001' and key_version = 2
  )
  and exists (
    select 1 from public.mobile_project_key_versions
    where project_id = '30000000-0000-0000-0000-000000000001'
      and key_version = 1 and retired_at is null
  )
  and not exists (
    select 1 from public.mobile_project_key_envelopes
    where id = '50000000-0000-0000-0000-000000000011'
  ),
  'invalid envelope must roll back the version retirement, new version, and prior envelope inserts'
);
set local role authenticated;
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select public.mobile_publish_snapshot(
  '40000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 'revision-0001', 1, 1,
  'mobile-encrypted-sync',
  'projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin',
  4096, repeat('b', 64),
  'aes-256-gcm-v1', decode(repeat('03', 12), 'hex'),
  decode(repeat('c1', 96), 'hex'), encode(digest(decode(repeat('c1', 96), 'hex'), 'sha256'), 'hex')
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.mobile_list_project_snapshot_cleanup_paths(
     '40000000-0000-0000-0000-000000000001',
     '30000000-0000-0000-0000-000000000001'
   ) cleanup
   where cleanup.object_bucket = 'mobile-encrypted-sync'
     and cleanup.object_path = 'projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin'
     and cleanup.object_sha256 = repeat('b', 64)
     and cleanup.object_byte_length = 4096),
  'project owner cleanup RPC must return the exact authorized Storage object'
);
-- Exact replay succeeds without creating another row.
select public.mobile_publish_snapshot(
  '40000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 'revision-0001', 1, 1,
  'mobile-encrypted-sync',
  'projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin',
  4096, repeat('b', 64),
  'aes-256-gcm-v1', decode(repeat('03', 12), 'hex'),
  decode(repeat('c1', 96), 'hex'), encode(digest(decode(repeat('c1', 96), 'hex'), 'sha256'), 'hex')
);

-- A valid user token cannot impersonate another one of that user's devices.
do $$
begin
  begin
    perform public.mobile_list_snapshot_manifests(
      '40000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001', 20
    );
    raise exception 'mismatched device claim unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.mobile_list_snapshot_manifests(
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001', 20
  )),
  'enrolled device with an envelope must list one snapshot'
);
select public.mobile_ack_snapshot(
  '40000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000001', 'verified'
);

select public.mobile_append_outbox(
  '40000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 1, 'revision-0001',
  'capture_note', '2026-08-30T19:00:00Z', 'aes-256-gcm-v1',
  decode(repeat('04', 12), 'hex'), decode(repeat('d1', 128), 'hex'),
  encode(digest(decode(repeat('d1', 128), 'hex'), 'sha256'), 'hex')
);
select public.mobile_append_outbox(
  '40000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 1, 'revision-0001',
  'capture_note', '2026-08-30T19:00:00Z', 'aes-256-gcm-v1',
  decode(repeat('04', 12), 'hex'), decode(repeat('d1', 128), 'hex'),
  encode(digest(decode(repeat('d1', 128), 'hex'), 'sha256'), 'hex')
);
do $$
begin
  begin
    perform public.mobile_append_outbox(
      '40000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001', 1, 'revision-0001',
      'capture_note', '2026-08-30T19:00:00Z', 'aes-256-gcm-v1',
      decode(repeat('04', 12), 'hex'), decode(repeat('ee', 128), 'hex'),
      encode(digest(decode(repeat('ee', 128), 'hex'), 'sha256'), 'hex')
    );
    raise exception 'conflicting outbox replay unexpectedly succeeded';
  exception
    when sqlstate '22000' then null;
  end;
end;
$$;
select public.mobile_append_outbox(
  '40000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001', 1, 'revision-0001',
  'capture_note', '2026-08-30T19:00:01Z', 'aes-256-gcm-v1',
  decode(repeat('05', 12), 'hex'), decode(repeat('d2', 128), 'hex'),
  encode(digest(decode(repeat('d2', 128), 'hex'), 'sha256'), 'hex')
);
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.mobile_list_outbox(
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', null, null, 20
  )),
  'desktop device must observe two outbox envelopes after one idempotent replay'
);
select pg_temp.assert_true(
  (
    select operation_id = '70000000-0000-0000-0000-000000000002'
    from public.mobile_list_outbox(
      '40000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      now(), '70000000-0000-0000-0000-000000000001', 1
    )
  ),
  'composite cursor must not skip an operation that shares its received timestamp'
);
select public.mobile_ack_outbox(
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', 'imported'
);

-- A viewer can enroll and read only after an editor authorizes the device, but
-- cannot publish snapshots or append project outbox operations.
select pg_temp.authenticate_as('10000000-0000-0000-0000-000000000002');
select public.mobile_register_device(
  '40000000-0000-0000-0000-000000000003',
  '41000000-0000-0000-0000-000000000003',
  'android', 'Viewer phone', 'x25519-v1', decode(repeat('33', 32), 'hex')
);
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select public.mobile_enroll_project_device(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003'
);
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000003'
);
do $$
begin
  begin
    perform public.mobile_list_project_snapshot_cleanup_paths(
      '40000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000001'
    );
    raise exception 'viewer cleanup manifest access unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
do $$
begin
  begin
    perform public.mobile_append_outbox(
      '40000000-0000-0000-0000-000000000003',
      '70000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000001', 1, 'revision-0001',
      'capture_note', now(), 'aes-256-gcm-v1', decode(repeat('05', 12), 'hex'),
      decode(repeat('d3', 32), 'hex'), encode(digest(decode(repeat('d3', 32), 'hex'), 'sha256'), 'hex')
    );
    raise exception 'viewer write unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- A nonmember cannot authorize against this project even with a valid device.
select pg_temp.authenticate_as('10000000-0000-0000-0000-000000000003');
select public.mobile_register_device(
  '40000000-0000-0000-0000-000000000004',
  '41000000-0000-0000-0000-000000000004',
  'desktop', 'Outsider desktop', 'x25519-v1', decode(repeat('44', 32), 'hex')
);
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000003',
  '40000000-0000-0000-0000-000000000004'
);
do $$
begin
  begin
    perform public.mobile_list_snapshot_manifests(
      '40000000-0000-0000-0000-000000000004',
      '30000000-0000-0000-0000-000000000001', 20
    );
    raise exception 'cross-workspace read unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- Project-device revocation is immediate and fail closed for every content RPC.
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select public.mobile_revoke_project_device(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002', 'device-lost'
);
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002'
);
do $$
begin
  begin
    perform public.mobile_list_snapshot_manifests(
      '40000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001', 20
    );
    raise exception 'revoked project device unexpectedly read snapshots';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
reset role;
select pg_temp.assert_true(
  (select retired_at is not null
   from public.mobile_project_key_versions
   where project_id = '30000000-0000-0000-0000-000000000001' and key_version = 1),
  'project-device revocation must retire the active project key immediately'
);
set local role authenticated;
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select pg_temp.assert_true(
  (select key_version = 2 from public.mobile_rotate_project_key_with_envelopes(
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', 1, 'post-revocation',
    jsonb_build_array(
      jsonb_build_object(
        'envelope_id', '50000000-0000-0000-0000-000000000021',
        'recipient_device_id', '40000000-0000-0000-0000-000000000001',
        'recipient_key_id', '41000000-0000-0000-0000-000000000001',
        'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
        'sealed_project_key_hex', repeat('c1', 80),
        'sealed_project_key_sha256', encode(digest(decode(repeat('c1', 80), 'hex'), 'sha256'), 'hex')
      ),
      jsonb_build_object(
        'envelope_id', '50000000-0000-0000-0000-000000000023',
        'recipient_device_id', '40000000-0000-0000-0000-000000000003',
        'recipient_key_id', '41000000-0000-0000-0000-000000000003',
        'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
        'sealed_project_key_hex', repeat('c3', 80),
        'sealed_project_key_sha256', encode(digest(decode(repeat('c3', 80), 'hex'), 'sha256'), 'hex')
      )
    )
  )),
  'device revocation must force the next project key version'
);
do $$
begin
  begin
    perform public.mobile_rotate_project_key_with_envelopes(
      '40000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001', 2, 'revoked-recipient-attempt',
      jsonb_build_array(
        jsonb_build_object(
          'envelope_id', '50000000-0000-0000-0000-000000000031',
          'recipient_device_id', '40000000-0000-0000-0000-000000000001',
          'recipient_key_id', '41000000-0000-0000-0000-000000000001',
          'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
          'sealed_project_key_hex', repeat('d1', 80),
          'sealed_project_key_sha256', encode(digest(decode(repeat('d1', 80), 'hex'), 'sha256'), 'hex')
        ),
        jsonb_build_object(
          'envelope_id', '50000000-0000-0000-0000-000000000032',
          'recipient_device_id', '40000000-0000-0000-0000-000000000002',
          'recipient_key_id', '41000000-0000-0000-0000-000000000002',
          'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
          'sealed_project_key_hex', repeat('d2', 80),
          'sealed_project_key_sha256', encode(digest(decode(repeat('d2', 80), 'hex'), 'sha256'), 'hex')
        ),
        jsonb_build_object(
          'envelope_id', '50000000-0000-0000-0000-000000000033',
          'recipient_device_id', '40000000-0000-0000-0000-000000000003',
          'recipient_key_id', '41000000-0000-0000-0000-000000000003',
          'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1',
          'sealed_project_key_hex', repeat('d3', 80),
          'sealed_project_key_sha256', encode(digest(decode(repeat('d3', 80), 'hex'), 'sha256'), 'hex')
        )
      )
    );
    raise exception 'revoked device unexpectedly received a rotated key envelope';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select public.mobile_revoke_device(
  '40000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002', 'device-lost'
);
reset role;
set local role supabase_auth_admin;
select pg_temp.assert_true(
  (public.mobile_custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-000000000001',
    'claims', jsonb_build_object(
      'session_id', '90000000-0000-0000-0000-000000000002',
      'device_id', '40000000-0000-0000-0000-000000000002'
    )
  )) #> '{claims,device_id}') is null,
  'revocation must remove a stale device claim on the next token refresh'
);
reset role;

-- Ciphertext-bearing rows are append-only even for a privileged maintenance
-- role; retention/deletion remains possible, but ciphertext cannot be replaced.
reset role;
do $$
begin
  begin
    update public.mobile_outbox_envelopes
       set ciphertext = decode(repeat('ff', 16), 'hex')
     where operation_id = '70000000-0000-0000-0000-000000000001';
    raise exception 'ciphertext update unexpectedly succeeded';
  exception
    when sqlstate '55000' then null;
  end;
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 1 from public.mobile_snapshot_acknowledgements
   where device_id = '40000000-0000-0000-0000-000000000002'
     and snapshot_id = '60000000-0000-0000-0000-000000000001'),
  'snapshot acknowledgement must be durable and unique'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.mobile_outbox_acknowledgements
   where device_id = '40000000-0000-0000-0000-000000000001'
     and operation_id = '70000000-0000-0000-0000-000000000001'),
  'outbox acknowledgement must be durable and unique'
);

set local role authenticated;
select pg_temp.authenticate_as(
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);
select pg_temp.assert_true(
  public.mobile_storage_snapshot_path_authorized(
    'projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin',
    'editor'
  )
  and not public.mobile_storage_snapshot_path_authorized(
    'projects/30000000-0000-0000-0000-000000000001/snapshots/not-a-uuid.bin',
    'viewer'
  )
  and not public.mobile_storage_snapshot_path_authorized(
    'projects/30000000-0000-0000-0000-000000000002/snapshots/60000000-0000-0000-0000-000000000002.bin',
    'viewer'
  ),
  'Storage path authorization must require an exact path and active session-bound project role'
);
reset role;

do $$
begin
  perform pg_temp.assert_true(
    exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.mobile_snapshot_manifests'::regclass
        and c.contype = 'c'
        and pg_catalog.pg_get_constraintdef(c.oid) ~ 'object_byte_length >= 40'
        and pg_catalog.pg_get_constraintdef(c.oid) ~ 'object_byte_length <= 67108864'
    ),
    'snapshot metadata must use the same 64 MiB uploaded-object bound as Storage and mobile'
  );
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Skipping Storage bucket/policy assertions outside the Supabase Storage stack';
    return;
  end if;
  perform pg_temp.assert_true(
    (select not public
      and file_size_limit = 67108864
      and allowed_mime_types = array[
        'text/plain', 'text/plain;charset=utf-8', 'application/octet-stream'
      ]::text[]
     from storage.buckets where id = 'mobile-encrypted-sync'),
    'encrypted sync bucket must be private and bounded to opaque ciphertext uploads'
  );
  perform pg_temp.assert_true(
    (select count(*) = 3 from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in (
         'mobile_encrypted_sync_viewer_select',
         'mobile_encrypted_sync_editor_insert',
         'mobile_encrypted_sync_editor_delete'
       )
       and cmd in ('SELECT', 'INSERT', 'DELETE')
       and roles = array['authenticated']::name[]),
    'Storage must expose only authenticated select, insert, and delete policies for this bucket'
  );
  perform pg_temp.assert_true(
    not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'mobile_encrypted_sync_update'
    ),
    'encrypted snapshot objects must not allow update/upsert'
  );
end;
$$;

rollback;
