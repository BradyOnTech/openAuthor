-- Transactional regressions using the disposable shared-quota identities.
begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'assertion failed: %', p_message;
  end if;
end;
$$;

create function pg_temp.assert_denied(p_statement text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'assertion failed: %', p_message;
end;
$$;

insert into storage.objects(bucket_id, name)
values ('mobile-encrypted-sync', 'projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","session_id":"90000000-0000-0000-0000-000000000001","device_id":"40000000-0000-0000-0000-000000000001"}', true);
select pg_temp.assert_true(
  public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'live enrolled owner is authorized'
);
select pg_temp.assert_true((select count(*) = 1 from storage.objects), 'live session can select its encrypted object metadata');

-- Device binding survives GoTrue sign-out. The deleted session must still deny
-- an otherwise correctly signed, not-yet-expired token at the database seam.
reset role;
delete from auth.sessions where id = '90000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_true(
  not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'deleted Auth session must deny ongoing Realtime authorization'
);
select pg_temp.assert_true((select count(*) = 0 from storage.objects), 'deleted Auth session loses Storage SELECT access');
select pg_temp.assert_denied(
  $$insert into storage.objects(bucket_id, name) values ('mobile-encrypted-sync', 'projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000002.bin')$$,
  'deleted Auth session must deny Storage INSERT'
);
select pg_temp.assert_denied(
  $$select public.mobile_list_project_devices('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')$$,
  'deleted Auth session must deny encrypted-sync RPCs'
);
select pg_temp.assert_denied(
  $$select public.mobile_consume_realtime_rate_limit('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 5, 60000)$$,
  'deleted Auth session must deny quota consumption'
);
select pg_temp.assert_denied(
  $$select public.mobile_register_device('40000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'desktop', 'Desktop', 'x25519-v1', decode(repeat('11', 32), 'hex'))$$,
  'deleted Auth session must deny exact device re-registration'
);
reset role;
set local role supabase_auth_admin;
select pg_temp.assert_true(
  (public.mobile_custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-000000000001',
    'claims', jsonb_build_object('session_id', '90000000-0000-0000-0000-000000000001', 'device_id', '40000000-0000-0000-0000-000000000001')
  )) #> '{claims,device_id}') is null,
  'deleted Auth session must lose its device claim in the hook'
);
reset role;
insert into auth.sessions(id, user_id, not_after)
values ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', clock_timestamp() - interval '1 second');
set local role authenticated;
select pg_temp.assert_true(
  not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'expired timeboxed Auth session must deny ongoing authorization'
);
reset role;
update auth.sessions set not_after = clock_timestamp() + interval '1 hour'
where id = '90000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_true(
  public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'unexpired timeboxed Auth session is authorized'
);
reset role;
update auth.sessions set user_id = '10000000-0000-0000-0000-000000000002'
where id = '90000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_true(
  not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'Auth session must belong to the signed subject'
);
reset role;
update auth.sessions set user_id = '10000000-0000-0000-0000-000000000001', not_after = null
where id = '90000000-0000-0000-0000-000000000001';
delete from public.workspace_members
where workspace_id = '20000000-0000-0000-0000-000000000001' and user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_true(
  not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001')
  and not public.mobile_has_active_project_device('30000000-0000-0000-0000-000000000001')
  and not public.mobile_storage_snapshot_path_authorized('projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin', 'viewer'),
  'workspace removal must deny Realtime and Storage despite retained enrollment'
);
reset role;
insert into public.workspace_members(workspace_id, user_id, role)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner');
update public.projects set status = 'archived' where id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_true(
  not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001')
  and not public.mobile_storage_snapshot_path_authorized('projects/30000000-0000-0000-0000-000000000001/snapshots/60000000-0000-0000-0000-000000000001.bin', 'viewer'),
  'archived book must deny voice and encrypted-object access'
);
select pg_temp.assert_denied(
  $$select public.mobile_list_project_devices('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')$$,
  'archived book must deny device RPCs'
);
reset role;
update public.projects set status = 'active' where id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","session_id":"malformed","device_id":"40000000-0000-0000-0000-000000000001"}', true);
select pg_temp.assert_true(
  not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'malformed Auth session denies without a cast error'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","device_id":"40000000-0000-0000-0000-000000000001"}', true);
select pg_temp.assert_true(
  not public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'missing Auth session denies'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","session_id":"90000000-0000-0000-0000-000000000001","device_id":"40000000-0000-0000-0000-000000000001"}', true);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.mobile_has_live_auth_session()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mobile_get_project_key_state(uuid,uuid)', 'EXECUTE'),
  'live-session helper stays private and key-state RPC is authenticated'
);
select pg_temp.assert_true(
  public.mobile_get_project_key_state('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')
    = '{"project_id":"30000000-0000-0000-0000-000000000001","latest_key_version":0,"active_key_version":null}'::jsonb,
  'unencrypted book exposes no current project key'
);
select public.mobile_rotate_project_key_with_envelopes(
  '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0, 'initial-enrollment',
  jsonb_build_array(
    jsonb_build_object('envelope_id', '50000000-0000-0000-0000-000000000001', 'recipient_device_id', '40000000-0000-0000-0000-000000000001', 'recipient_key_id', '41000000-0000-0000-0000-000000000001', 'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1', 'sealed_project_key_hex', repeat('a1', 80), 'sealed_project_key_sha256', encode(digest(decode(repeat('a1', 80), 'hex'), 'sha256'), 'hex')),
    jsonb_build_object('envelope_id', '50000000-0000-0000-0000-000000000002', 'recipient_device_id', '40000000-0000-0000-0000-000000000002', 'recipient_key_id', '41000000-0000-0000-0000-000000000002', 'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1', 'sealed_project_key_hex', repeat('a2', 80), 'sealed_project_key_sha256', encode(digest(decode(repeat('a2', 80), 'hex'), 'sha256'), 'hex'))
  )
);
select pg_temp.assert_true(
  public.mobile_get_project_key_state('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')
    = '{"project_id":"30000000-0000-0000-0000-000000000001","latest_key_version":1,"active_key_version":1}'::jsonb,
  'atomic rotation exposes the current version'
);
select public.mobile_revoke_project_device('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'device-lost');
select pg_temp.assert_true(
  public.mobile_get_project_key_state('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')
    = '{"project_id":"30000000-0000-0000-0000-000000000001","latest_key_version":1,"active_key_version":null}'::jsonb,
  'revocation retains historical maximum but exposes no usable current key'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.mobile_get_project_key_envelopes('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')),
  'historical envelope remains readable and cannot establish current-key readiness'
);
select public.mobile_rotate_project_key_with_envelopes(
  '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1, 'lost-device',
  jsonb_build_array(jsonb_build_object('envelope_id', '50000000-0000-0000-0000-000000000003', 'recipient_device_id', '40000000-0000-0000-0000-000000000001', 'recipient_key_id', '41000000-0000-0000-0000-000000000001', 'algorithm', 'x25519-xsalsa20-poly1305-sealedbox-v1', 'sealed_project_key_hex', repeat('a3', 80), 'sealed_project_key_sha256', encode(digest(decode(repeat('a3', 80), 'hex'), 'sha256'), 'hex')))
);
select pg_temp.assert_true(
  public.mobile_get_project_key_state('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')
    = '{"project_id":"30000000-0000-0000-0000-000000000001","latest_key_version":2,"active_key_version":2}'::jsonb,
  'reviewed rotation restores a new active version'
);
select pg_temp.assert_denied(
  $$select public.mobile_get_project_key_state('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001')$$,
  'key state requires the signed requesting device'
);
reset role;
update public.workspace_members set role = 'viewer'
where workspace_id = '20000000-0000-0000-0000-000000000001' and user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_true(
  public.authorize_realtime_session('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  'current viewer retains allowed reading and voice authority'
);
select pg_temp.assert_denied(
  $$select public.mobile_get_project_key_state('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001')$$,
  'publishing-key state requires current editor authority'
);

rollback;
