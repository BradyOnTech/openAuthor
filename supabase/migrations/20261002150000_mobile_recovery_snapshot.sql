-- Recovery keys are proven locally against authenticated book ciphertext. This
-- seam exposes only one current committed ciphertext manifest and installs a
-- self-only sealed envelope without weakening current device/version checks.
begin;

create function public.mobile_get_recovery_snapshot(
  p_requesting_device_id uuid, p_project_id uuid, p_expected_key_version integer
)
returns public.mobile_snapshot_manifests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.mobile_snapshot_manifests;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if p_expected_key_version is null or not exists (
    select 1 from public.mobile_project_key_versions
    where project_id = p_project_id and key_version = p_expected_key_version
      and retired_at is null
  ) then
    raise exception using errcode = '40001', message = 'Current project key version changed';
  end if;
  select * into v_row from public.mobile_snapshot_manifests
    where project_id = p_project_id and key_version = p_expected_key_version
    order by created_at desc, snapshot_id desc limit 1;
  if not found then return null; end if;
  return v_row;
end;
$$;

create function public.mobile_recover_project_key_envelope(
  p_requesting_device_id uuid,
  p_project_id uuid,
  p_expected_key_version integer,
  p_expected_device_key_id uuid,
  p_envelope_id uuid,
  p_sealed_key text
)
returns public.mobile_project_key_envelopes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.mobile_project_key_envelopes; v_key bytea;
begin
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if p_expected_key_version is null or p_expected_device_key_id is null
     or p_envelope_id is null or p_sealed_key is null
     or p_sealed_key !~ '^[0-9a-f]{160}$' then
    raise exception using errcode = '22023', message = 'Exact recovery envelope identity required';
  end if;
  -- Use atomic rotation's project -> enrollment -> device -> key ordering.
  -- Current-key retirement and revocation updates conflict with these locks.
  perform 1 from public.projects where id = p_project_id for update;
  perform 1 from public.mobile_project_devices
    where project_id = p_project_id and device_id = p_requesting_device_id for update;
  perform 1 from public.mobile_devices where id = p_requesting_device_id for update;
  perform 1 from public.mobile_device_keys where id = p_expected_device_key_id for update;
  perform 1 from public.mobile_project_key_versions
    where project_id = p_project_id and key_version = p_expected_key_version for update;
  -- Preflight authorization may have changed while waiting on rotation.
  perform public.mobile_assert_project_device(p_requesting_device_id, p_project_id, 'editor');
  if not exists (
    select 1 from public.mobile_devices d
    join public.mobile_device_keys dk on dk.device_id = d.id and dk.id = d.current_key_id
    where d.id = p_requesting_device_id and dk.id = p_expected_device_key_id
      and dk.algorithm = 'x25519-v1' and dk.retired_at is null and dk.revoked_at is null
  ) or not exists (
    select 1 from public.mobile_project_key_versions
    where project_id = p_project_id and key_version = p_expected_key_version
      and retired_at is null
  ) then
    raise exception using errcode = '40001', message = 'Recovery device or project key changed';
  end if;
  v_key := decode(p_sealed_key, 'hex');
  insert into public.mobile_project_key_envelopes (
    id, project_id, key_version, recipient_device_id, recipient_key_id,
    sender_device_id, algorithm, sealed_project_key, sealed_project_key_sha256
  ) values (
    p_envelope_id, p_project_id, p_expected_key_version, p_requesting_device_id,
    p_expected_device_key_id, p_requesting_device_id,
    'x25519-xsalsa20-poly1305-sealedbox-v1', v_key, encode(digest(v_key, 'sha256'), 'hex')
  ) on conflict (id) do nothing;
  select * into v_row from public.mobile_project_key_envelopes where id = p_envelope_id;
  if v_row.project_id is distinct from p_project_id
     or v_row.key_version is distinct from p_expected_key_version
     or v_row.recipient_device_id is distinct from p_requesting_device_id
     or v_row.recipient_key_id is distinct from p_expected_device_key_id
     or v_row.sender_device_id is distinct from p_requesting_device_id
     or v_row.sealed_project_key is distinct from v_key then
    raise exception using errcode = '22000', message = 'Recovery envelope idempotency conflict';
  end if;
  return v_row;
end;
$$;

revoke execute on function public.mobile_get_recovery_snapshot(uuid,uuid,integer) from public, anon;
revoke execute on function public.mobile_recover_project_key_envelope(uuid,uuid,integer,uuid,uuid,text) from public, anon;
grant execute on function public.mobile_get_recovery_snapshot(uuid,uuid,integer) to authenticated;
grant execute on function public.mobile_recover_project_key_envelope(uuid,uuid,integer,uuid,uuid,text) to authenticated;

comment on function public.mobile_get_recovery_snapshot(uuid,uuid,integer) is
  'Current enrolled editor recovery ciphertext only. Does not prove a candidate key; clients must authenticate both manifest and exact snapshot before self-envelope installation.';
commit;
