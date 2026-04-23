create or replace function public.workspace_bootstrap(
  p_name text default 'Personal Workspace',
  p_slug text default 'personal-workspace'
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  ws public.workspaces;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Authenticated user required';
  end if;

  insert into public.workspaces (name, slug)
  values (
    coalesce(nullif(trim(p_name), ''), 'Personal Workspace'),
    public.slugify(coalesce(nullif(trim(p_slug), ''), 'personal-workspace'))
  )
  on conflict (slug) do update
    set updated_at = now()
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, current_user_id, 'owner')
  on conflict (workspace_id, user_id) do update
    set role = 'owner', updated_at = now();

  return ws;
end;
$$;

grant execute on function public.workspace_bootstrap(text, text) to authenticated;
