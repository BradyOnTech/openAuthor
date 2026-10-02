-- A globally unique display slug is not proof of workspace membership.
-- Preserve existing roles; new namespaces are scoped to the authenticated author.
begin;
create or replace function public.workspace_bootstrap(
  p_name text default 'Personal Workspace',
  p_slug text default 'personal-workspace'
)
returns public.workspaces language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_base text := public.slugify(coalesce(nullif(trim(p_slug),''),'personal-workspace'));
  v_slug text;
  v_workspace public.workspaces;
begin
  if v_user is null or not public.mobile_has_live_auth_session() then
    raise exception using errcode = '42501', message = 'Live authenticated session required';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'Workspace bootstrap requires READ COMMITTED';
  end if;
  v_slug := v_base || '-' || v_user::text;
  perform pg_advisory_xact_lock(hashtextextended('openauthor-workspace-bootstrap:' || v_user::text || ':' || v_base,0));
  if not public.mobile_has_live_auth_session() then
    raise exception using errcode = '42501', message = 'Live authenticated session required';
  end if;
  -- Reopening a legacy or already scoped workspace does not change its name or
  -- the caller's role. Editor/viewer memberships are never promoted here.
  select w.* into v_workspace from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id and m.user_id = v_user
  where w.slug in (v_base,v_slug)
  order by (w.slug = v_base) desc limit 1;
  if found then return v_workspace; end if;

  insert into public.workspaces(name,slug)
    values (coalesce(nullif(trim(p_name),''),'Personal Workspace'),v_slug)
    on conflict (slug) do nothing returning * into v_workspace;
  if not found then
    -- A legacy/admin-created collision may not be claimed by a nonmember.
    raise exception using errcode = '42501', message = 'Workspace bootstrap identity is unavailable';
  end if;
  insert into public.workspace_members(workspace_id,user_id,role)
    values (v_workspace.id,v_user,'owner');
  return v_workspace;
end;
$$;
revoke execute on function public.workspace_bootstrap(text,text) from public,anon,authenticated,service_role;
grant execute on function public.workspace_bootstrap(text,text) to authenticated;
commit;
