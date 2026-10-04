-- Private Supabase Storage surface for encrypted mobile snapshots.
-- Snapshot objects are opaque ciphertext transported either as the desktop's
-- base64 text/plain payload or as application/octet-stream bytes. Storage API
-- calls must use the user's session-bound JWT; no runtime service role is
-- required or granted by this migration. The 64 MiB bucket cap matches mobile
-- preflight validation and must remain below the deployment's global limit.

create or replace function public.mobile_storage_snapshot_path_authorized(
  p_object_name text,
  p_min_role public.workspace_role
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_id uuid;
begin
  if p_object_name is null or p_object_name !~
    '^projects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/snapshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$'
  then
    return false;
  end if;
  v_project_id := split_part(p_object_name, '/', 2)::uuid;
  return public.mobile_has_project_role(v_project_id, p_min_role)
    and public.mobile_has_active_project_device(v_project_id);
exception when invalid_text_representation then
  return false;
end;
$$;

revoke execute on function public.mobile_storage_snapshot_path_authorized(text, public.workspace_role)
  from public, anon;
grant execute on function public.mobile_storage_snapshot_path_authorized(text, public.workspace_role)
  to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage schema is unavailable; bucket and storage.objects policies were not installed. Run supabase db reset in the Supabase stack to verify them.';
    return;
  end if;

  execute $sql$
    insert into storage.buckets (
      id, name, public, file_size_limit, allowed_mime_types
    ) values (
      'mobile-encrypted-sync', 'mobile-encrypted-sync', false,
      67108864,
      array[
        'text/plain', 'text/plain;charset=utf-8', 'application/octet-stream'
      ]::text[]
    )
    on conflict (id) do update set
      name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types
  $sql$;

  execute 'drop policy if exists mobile_encrypted_sync_viewer_select on storage.objects';
  execute 'drop policy if exists mobile_encrypted_sync_editor_insert on storage.objects';
  execute 'drop policy if exists mobile_encrypted_sync_editor_delete on storage.objects';
  execute 'drop policy if exists mobile_encrypted_sync_update on storage.objects';

  execute $policy$
    create policy mobile_encrypted_sync_viewer_select
    on storage.objects for select to authenticated
    using (
      bucket_id = 'mobile-encrypted-sync'
      and public.mobile_storage_snapshot_path_authorized(
        name, 'viewer'::public.workspace_role
      )
    )
  $policy$;
  execute $policy$
    create policy mobile_encrypted_sync_editor_insert
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'mobile-encrypted-sync'
      and public.mobile_storage_snapshot_path_authorized(
        name, 'editor'::public.workspace_role
      )
    )
  $policy$;
  execute $policy$
    create policy mobile_encrypted_sync_editor_delete
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'mobile-encrypted-sync'
      and public.mobile_storage_snapshot_path_authorized(
        name, 'editor'::public.workspace_role
      )
    )
  $policy$;
end;
$$;

comment on function public.mobile_storage_snapshot_path_authorized(text, public.workspace_role) is
  'Session-bound authorization for exact encrypted snapshot Storage paths.';
