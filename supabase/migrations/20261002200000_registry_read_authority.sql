-- Registry membership policies must not query the same RLS-protected table.
-- This predicate answers only for the currently authenticated, live account.
begin;

create function public.registry_has_workspace_membership(p_workspace_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and public.mobile_has_live_auth_session()
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
    )
$$;
revoke execute on function public.registry_has_workspace_membership(uuid) from public, anon, authenticated, service_role;
grant execute on function public.registry_has_workspace_membership(uuid) to authenticated;

drop policy workspaces_member_select on public.workspaces;
create policy workspaces_member_select on public.workspaces
for select to authenticated
using (public.registry_has_workspace_membership(id));

drop policy workspace_members_member_select on public.workspace_members;
create policy workspace_members_member_select on public.workspace_members
for select to authenticated
using (public.registry_has_workspace_membership(workspace_id));

drop policy projects_member_select on public.projects;
create policy projects_member_select on public.projects
for select to authenticated
using (public.registry_has_workspace_membership(workspace_id));

drop policy project_activity_member_select on public.project_activity;
create policy project_activity_member_select on public.project_activity
for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = project_activity.project_id
    and public.registry_has_workspace_membership(p.workspace_id)
));

drop policy workspace_user_state_owner_select on public.workspace_user_state;
create policy workspace_user_state_owner_select on public.workspace_user_state
for select to authenticated
using (user_id = auth.uid() and public.registry_has_workspace_membership(workspace_id));

drop policy workspace_user_state_owner_modify on public.workspace_user_state;
create policy workspace_user_state_owner_modify on public.workspace_user_state
for all to authenticated
using (user_id = auth.uid() and public.registry_has_workspace_membership(workspace_id))
with check (user_id = auth.uid() and public.registry_has_workspace_membership(workspace_id));

comment on function public.registry_has_workspace_membership(uuid) is
  'Nonrecursive registry RLS predicate for auth.uid() and its live unfrozen Auth session only. Does not accept another user or change membership.';
commit;
